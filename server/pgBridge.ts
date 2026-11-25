import { Pool } from 'pg';

let pool: Pool | null = null;
let cachedUrl: string | null = null;

function getPool(): Pool | null {
  const dbUrl = process.env.DATABASE_URL?.trim();
  if (!dbUrl) return null;
  if (!pool || cachedUrl !== dbUrl) {
    pool = new Pool({
      connectionString: dbUrl,
      ssl: dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1') ? false : { rejectUnauthorized: false },
      max: 5,
      connectionTimeoutMillis: 4500,
    });
    cachedUrl = dbUrl;
  }
  return pool;
}

export interface PostgresHealthStatus {
  configured: boolean;
  connected: boolean;
  database: string | null;
  version: string | null;
  latencyMs: number | null;
  error: string | null;
}

export async function checkPostgresHealth(): Promise<PostgresHealthStatus> {
  const activePool = getPool();
  if (!activePool) {
    return {
      configured: false,
      connected: false,
      database: null,
      version: null,
      latencyMs: null,
      error: null,
    };
  }

  const start = Date.now();
  try {
    const res = await activePool.query('SELECT current_database() AS db, version() AS ver');
    const row = res.rows[0] as { db?: string; ver?: string } | undefined;
    return {
      configured: true,
      connected: true,
      database: row?.db ?? null,
      version: row?.ver ? row.ver.split(' ').slice(0, 2).join(' ') : null,
      latencyMs: Date.now() - start,
      error: null,
    };
  } catch (err) {
    return {
      configured: true,
      connected: false,
      database: null,
      version: null,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : 'Postgres connection failed',
    };
  }
}

export async function queryPostgresReadOnly(sql: string): Promise<{
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
}> {
  const activePool = getPool();
  if (!activePool) {
    throw new Error('DATABASE_URL is not configured.');
  }
  const client = await activePool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const result = await client.query(sql);
    await client.query('COMMIT');
    const columns = result.fields.map((f) => f.name);
    return {
      columns,
      rows: result.rows as Array<Record<string, unknown>>,
      rowCount: result.rowCount ?? result.rows.length,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function listPostgresTables(): Promise<Array<{ table: string; rows: number; columns: string[] }>> {
  const activePool = getPool();
  if (!activePool) return [];
  const res = await activePool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `);
  const tables: Array<{ table: string; rows: number; columns: string[] }> = [];
  for (const row of res.rows as Array<{ table_name: string }>) {
    const colRes = await activePool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
      [row.table_name]
    );
    tables.push({
      table: row.table_name,
      rows: 0,
      columns: (colRes.rows as Array<{ column_name: string }>).map((c) => c.column_name),
    });
  }
  return tables;
}

export async function bootstrapPostgresSchema(): Promise<{
  createdTables: string[];
  database: string | null;
}> {
  const activePool = getPool();
  if (!activePool) {
    throw new Error('DATABASE_URL is not configured in Settings > Secrets.');
  }

  const client = await activePool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_login_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        category TEXT NOT NULL,
        permission_scope TEXT NOT NULL,
        db_isolation_label TEXT NOT NULL,
        status TEXT NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        deadline TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        title TEXT NOT NULL,
        model TEXT NOT NULL,
        status TEXT NOT NULL,
        completed_tasks INTEGER NOT NULL DEFAULT 0,
        failed_tasks INTEGER NOT NULL DEFAULT 0,
        avg_latency_ms INTEGER NOT NULL DEFAULT 0,
        last_active_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        assigned_agent_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        action_type TEXT NOT NULL,
        risk_level TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        output_report TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        requested_by_agent_id TEXT NOT NULL,
        action_type TEXT NOT NULL,
        risk_level TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        payload_preview TEXT NOT NULL,
        status TEXT NOT NULL,
        decided_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        decided_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        resource TEXT NOT NULL,
        outcome TEXT NOT NULL,
        ip TEXT NOT NULL,
        details TEXT NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS agent_memory (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query('COMMIT');
    const dbRes = await client.query('SELECT current_database() AS db');
    return {
      createdTables: ['users', 'projects', 'agents', 'tasks', 'approvals', 'audit_logs', 'agent_memory'],
      database: (dbRes.rows[0] as { db?: string })?.db ?? null,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}


import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectSqlStatement } from './sqlGuard.ts';

test('read-only queries stay allowed, including literals that look dangerous', () => {
  for (const sql of [
    'SELECT id, name FROM agents;',
    "SELECT * FROM tasks WHERE note = 'please DELETE this later'",
    "SELECT * FROM tasks WHERE note = 'a; DROP TABLE users'",
    'SELECT * FROM users -- trailing comment',
    'EXPLAIN SELECT 1',
    'SHOW search_path',
    'TABLE agents',
  ]) {
    const res = inspectSqlStatement(sql);
    assert.equal(res.allowedDirectExecution, true, `expected allowed: ${sql}`);
    assert.equal(res.classification, 'read_only', `expected read_only: ${sql}`);
  }
});

test('EXPLAIN ANALYZE cannot execute writes without approval', () => {
  const analyze = inspectSqlStatement('EXPLAIN ANALYZE DELETE FROM tasks');
  assert.equal(analyze.allowedDirectExecution, false);
  assert.equal(analyze.classification, 'migration_or_dml');

  const analyzeSelect = inspectSqlStatement('EXPLAIN (ANALYZE, BUFFERS) SELECT 1');
  assert.equal(analyzeSelect.allowedDirectExecution, false);
});

test('data-moving SELECT and writable CTEs require approval', () => {
  const intoClause = inspectSqlStatement('SELECT * INTO backup_users FROM users');
  assert.equal(intoClause.allowedDirectExecution, false);
  assert.equal(intoClause.classification, 'migration_or_dml');

  const tempInto = inspectSqlStatement('SELECT * INTO TEMP snapshot FROM tasks');
  assert.equal(tempInto.allowedDirectExecution, false);

  const cte = inspectSqlStatement('WITH gone AS (DELETE FROM tasks RETURNING *) SELECT * FROM gone');
  assert.equal(cte.allowedDirectExecution, false);
  assert.equal(cte.classification, 'migration_or_dml');
});

test('server-control and filesystem functions are blocked outright', () => {
  for (const sql of [
    'SELECT pg_sleep(10)',
    "SELECT pg_read_file('/etc/passwd')",
    "SELECT lo_import('/etc/shadow')",
    "SELECT dblink('host=evil', 'SELECT 1')",
    'SELECT pg_terminate_backend(1234)',
    "SELECT set_config('role', 'postgres', false)",
  ]) {
    const res = inspectSqlStatement(sql);
    assert.equal(res.allowedDirectExecution, false, `expected blocked: ${sql}`);
    assert.equal(res.classification, 'destructive_blocked', `expected destructive: ${sql}`);
  }
});

test('session and server-control verbs are blocked', () => {
  for (const sql of [
    'SET ROLE postgres',
    'RESET ALL',
    'CALL dangerous_proc()',
    'DO $$ BEGIN PERFORM 1; END $$',
    "COPY users TO PROGRAM 'id'",
    'LOCK TABLE users',
    'DISCARD ALL',
    'PREPARE p AS SELECT 1',
    'REINDEX TABLE users',
  ]) {
    const res = inspectSqlStatement(sql);
    assert.equal(res.allowedDirectExecution, false, `expected blocked: ${sql}`);
  }
});

test('stacked statements and keyword/comment tricks are rejected', () => {
  const stacked = inspectSqlStatement('SELECT * FROM agents; DROP TABLE users;');
  assert.equal(stacked.allowedDirectExecution, false);
  assert.equal(stacked.verb, 'MULTI_STATEMENT');

  const commentTrick = inspectSqlStatement('SEL/**/ECT 1');
  assert.equal(commentTrick.allowedDirectExecution, false);

  const empty = inspectSqlStatement('   ');
  assert.equal(empty.classification, 'invalid');
  assert.equal(empty.allowedDirectExecution, false);
});

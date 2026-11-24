export type SqlClassification = 'read_only' | 'migration_or_dml' | 'destructive_blocked' | 'invalid';

export interface SqlInspectionResult {
  classification: SqlClassification;
  allowedDirectExecution: boolean;
  requiresOwnerApproval: boolean;
  verb: string;
  reason: string;
  normalizedSql: string;
}

/**
 * Remove SQL comments. Block comments are replaced with a space (not removed)
 * so that a comment wedged inside a keyword cannot be glued back together.
 */
function stripSqlComments(sql: string): string {
  let out = '';
  let i = 0;
  const len = sql.length;
  let inSingle = false;
  let inDouble = false;

  while (i < len) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (inSingle || inDouble) {
      out += ch;
      if (ch === (inSingle ? "'" : '"')) {
        if (next === ch) {
          // Escaped quote ('' or "")
          out += next;
          i += 2;
          continue;
        }
        inSingle = false;
        inDouble = false;
      }
      i += 1;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '-' && next === '-') {
      while (i < len && sql[i] !== '\n') i += 1;
      out += ' ';
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < len && !(sql[i] === '*' && sql[i + 1] === '/')) i += 1;
      i += 2;
      out += ' ';
      continue;
    }
    out += ch;
    i += 1;
  }

  // Order of comments/whitespace removal is irrelevant to semantics here;
  // collapsing whitespace keeps keyword regexes simple.
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Replace single-quoted literals and dollar-quoted bodies with a placeholder so
 * keyword scans do not false-positive on user data (e.g. a note containing the
 * word "DELETE") and cannot be bypassed by hiding keywords inside literals.
 */
function maskLiterals(sql: string): string {
  let out = '';
  let i = 0;
  const len = sql.length;
  while (i < len) {
    const ch = sql[i];
    if (ch === "'") {
      i += 1;
      while (i < len) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i += 1;
          break;
        }
        i += 1;
      }
      out += "'?'";
      continue;
    }
    if (ch === '$') {
      const tagMatch = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (tagMatch) {
        const tag = tagMatch[0];
        const end = sql.indexOf(tag, i + tag.length);
        i = end === -1 ? len : end + tag.length;
        out += "'?'";
        continue;
      }
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** Verbs that must never run through the read-only console, even with approval. */
const BLOCKED_VERBS = new Set([
  'DROP',
  'TRUNCATE',
  'GRANT',
  'REVOKE',
  'COPY',
  'VACUUM',
  'RESET',
  'CALL',
  'DO',
  'SET',
  'PREPARE',
  'EXECUTE',
  'DEALLOCATE',
  'LOCK',
  'LISTEN',
  'NOTIFY',
  'UNLISTEN',
  'DISCARD',
  'CLUSTER',
  'REINDEX',
  'REFRESH',
  'COMMENT',
  'SECURITY',
  'REASSIGN',
  'IMPORT',
]);

/** Functions that read/write the server filesystem, spawn work, or change state. */
const DANGEROUS_FUNCTION_PATTERN =
  /\b(pg_sleep|pg_sleep_for|pg_sleep_until|pg_read_file|pg_read_binary_file|pg_ls_dir|pg_stat_file|pg_logdir_ls|lo_import|lo_export|lo_create|lo_unlink|dblink|dblink_exec|dblink_connect|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_rotate_logfile|pg_switch_wal|pg_create_restore_point|pg_promote|pg_drop_replication_slot|pg_create_physical_replication_slot|pg_logical_emit_message|set_config|pg_advisory_lock|pg_advisory_xact_lock|pg_try_advisory_lock|pg_export_snapshot|query_to_xml|query_to_xmlschema|current_setting|pg_catalog\.pg_authid)\s*(\(|,|$)/i;

const WRITE_KEYWORD_PATTERN = /\b(INSERT|UPDATE|DELETE|ALTER|CREATE|MERGE|GRANT|REVOKE|REPLACE|UPSERT)\b/i;
const DDL_DESTRUCTIVE_PATTERN = /\b(DROP\s+(TABLE|DATABASE|SCHEMA|ROLE|USER|INDEX|VIEW|MATERIALIZED|TYPE|EXTENSION|FUNCTION)|TRUNCATE(\s+TABLE)?)\b/i;

function result(
  partial: Omit<SqlInspectionResult, 'normalizedSql'>,
  normalizedSql: string
): SqlInspectionResult {
  return { ...partial, normalizedSql };
}

export function inspectSqlStatement(rawSql: string): SqlInspectionResult {
  const normalizedSql = stripSqlComments(String(rawSql ?? ''));
  if (!normalizedSql) {
    return result(
      {
        classification: 'invalid',
        allowedDirectExecution: false,
        requiresOwnerApproval: false,
        verb: '',
        reason: 'SQL statement cannot be empty.',
      },
      ''
    );
  }

  const withoutTrailingSemi = normalizedSql.replace(/;+\s*$/, '');

  // Split on top-level semicolons (literals are masked for the scan only).
  const masked = maskLiterals(withoutTrailingSemi);
  if (masked.includes(';')) {
    return result(
      {
        classification: 'destructive_blocked',
        allowedDirectExecution: false,
        requiresOwnerApproval: false,
        verb: 'MULTI_STATEMENT',
        reason: 'Multi-statement SQL batching is blocked for safety. Execute one statement at a time.',
      },
      withoutTrailingSemi
    );
  }

  const firstTokenMatch = masked.match(/^([a-zA-Z_]+)/);
  const verb = (firstTokenMatch?.[1] || '').toUpperCase();

  if (!verb) {
    return result(
      {
        classification: 'invalid',
        allowedDirectExecution: false,
        requiresOwnerApproval: false,
        verb: '',
        reason: 'Unable to parse SQL command verb.',
      },
      withoutTrailingSemi
    );
  }

  if (DANGEROUS_FUNCTION_PATTERN.test(masked)) {
    const fn = masked.match(DANGEROUS_FUNCTION_PATTERN)?.[1] ?? 'privileged function';
    return result(
      {
        classification: 'destructive_blocked',
        allowedDirectExecution: false,
        requiresOwnerApproval: true,
        verb,
        reason: `Call to "${fn}" is blocked: filesystem, replication, or server-control functions are never allowed from the console.`,
      },
      withoutTrailingSemi
    );
  }

  if (BLOCKED_VERBS.has(verb) || DDL_DESTRUCTIVE_PATTERN.test(masked)) {
    return result(
      {
        classification: 'destructive_blocked',
        allowedDirectExecution: false,
        requiresOwnerApproval: true,
        verb,
        reason: `Destructive or server-control command "${verb}" is blocked from direct execution and requires an approved recovery workflow.`,
      },
      withoutTrailingSemi
    );
  }

  if (verb === 'EXPLAIN') {
    // EXPLAIN ANALYZE actually executes the plan, including writes. ANALYZE can
    // appear as a bare keyword or inside the option list: EXPLAIN (ANALYZE, ...).
    const explainParts = /^\s*EXPLAIN\s*(?:\(([^)]*)\))?\s*([A-Za-z_]*)/i.exec(masked);
    const explainOptions = explainParts?.[1] ?? '';
    const nextKeyword = (explainParts?.[2] ?? '').toUpperCase();
    const isAnalyze = /\bANALYZE\b/i.test(explainOptions) || nextKeyword === 'ANALYZE';
    if (isAnalyze) {
      return result(
        {
          classification: 'migration_or_dml',
          allowedDirectExecution: false,
          requiresOwnerApproval: true,
          verb,
          reason: 'EXPLAIN ANALYZE executes the statement, so it needs Owner approval like the statement itself.',
        },
        withoutTrailingSemi
      );
    }
    if (WRITE_KEYWORD_PATTERN.test(masked)) {
      return result(
        {
          classification: 'migration_or_dml',
          allowedDirectExecution: false,
          requiresOwnerApproval: true,
          verb,
          reason: 'EXPLAIN targets a write statement and requires Owner approval.',
        },
        withoutTrailingSemi
      );
    }
    return result(
      {
        classification: 'read_only',
        allowedDirectExecution: true,
        requiresOwnerApproval: false,
        verb,
        reason: 'EXPLAIN (without ANALYZE) is read-only and approved for inspection.',
      },
      withoutTrailingSemi
    );
  }

  const readOnlyVerbs = new Set(['SELECT', 'WITH', 'SHOW', 'TABLE', 'VALUES']);
  if (readOnlyVerbs.has(verb)) {
    if (/\bINTO\s+(TEMP(ORARY)?\s+)?(TABLE\s+)?[A-Za-z_"']/i.test(masked)) {
      return result(
        {
          classification: 'migration_or_dml',
          allowedDirectExecution: false,
          requiresOwnerApproval: true,
          verb,
          reason: 'SELECT ... INTO writes data to a new table and requires Owner approval.',
        },
        withoutTrailingSemi
      );
    }
    // Guard against writable CTEs like WITH deleted AS (DELETE ...) SELECT ...
    if (WRITE_KEYWORD_PATTERN.test(masked)) {
      return result(
        {
          classification: 'migration_or_dml',
          allowedDirectExecution: false,
          requiresOwnerApproval: true,
          verb,
          reason: 'Statement contains write operations inside a CTE and requires Owner approval.',
        },
        withoutTrailingSemi
      );
    }
    return result(
      {
        classification: 'read_only',
        allowedDirectExecution: true,
        requiresOwnerApproval: false,
        verb,
        reason: 'Safe read-only query approved for immediate inspection.',
      },
      withoutTrailingSemi
    );
  }

  const migrationOrDmlVerbs = new Set(['INSERT', 'UPDATE', 'DELETE', 'ALTER', 'CREATE', 'MERGE']);
  if (migrationOrDmlVerbs.has(verb)) {
    return result(
      {
        classification: 'migration_or_dml',
        allowedDirectExecution: false,
        requiresOwnerApproval: true,
        verb,
        reason: `State-changing command "${verb}" must be queued as a Database Migration approval request.`,
      },
      withoutTrailingSemi
    );
  }

  if (verb === 'ANALYZE') {
    return result(
      {
        classification: 'migration_or_dml',
        allowedDirectExecution: false,
        requiresOwnerApproval: true,
        verb,
        reason: 'ANALYZE rewrites planner statistics and requires Owner approval.',
      },
      withoutTrailingSemi
    );
  }

  return result(
    {
      classification: 'invalid',
      allowedDirectExecution: false,
      requiresOwnerApproval: false,
      verb,
      reason: `Unsupported SQL command "${verb}".`,
    },
    withoutTrailingSemi
  );
}

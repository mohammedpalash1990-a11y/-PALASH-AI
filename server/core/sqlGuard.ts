export type SqlClassification = 'read_only' | 'migration_or_dml' | 'destructive_blocked' | 'invalid';

export interface SqlInspectionResult {
  classification: SqlClassification;
  allowedDirectExecution: boolean;
  requiresOwnerApproval: boolean;
  verb: string;
  reason: string;
  normalizedSql: string;
}

function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function inspectSqlStatement(rawSql: string): SqlInspectionResult {
  const normalizedSql = stripSqlComments(rawSql);
  if (!normalizedSql) {
    return {
      classification: 'invalid',
      allowedDirectExecution: false,
      requiresOwnerApproval: false,
      verb: '',
      reason: 'SQL statement cannot be empty.',
      normalizedSql: '',
    };
  }

  // Strip a single trailing semicolon, reject stacked statements
  const withoutTrailingSemi = normalizedSql.replace(/;+\s*$/, '');
  if (withoutTrailingSemi.includes(';')) {
    return {
      classification: 'destructive_blocked',
      allowedDirectExecution: false,
      requiresOwnerApproval: false,
      verb: 'MULTI_STATEMENT',
      reason: 'Multi-statement SQL batching is blocked for safety. Execute one statement at a time.',
      normalizedSql: withoutTrailingSemi,
    };
  }

  const firstTokenMatch = withoutTrailingSemi.match(/^([a-zA-Z_]+)/);
  const verb = (firstTokenMatch?.[1] || '').toUpperCase();

  if (!verb) {
    return {
      classification: 'invalid',
      allowedDirectExecution: false,
      requiresOwnerApproval: false,
      verb: '',
      reason: 'Unable to parse SQL command verb.',
      normalizedSql: withoutTrailingSemi,
    };
  }

  const destructiveVerbs = new Set(['DROP', 'TRUNCATE', 'GRANT', 'REVOKE', 'COPY', 'VACUUM', 'RESET']);
  if (destructiveVerbs.has(verb) || /\b(DROP\s+TABLE|DROP\s+DATABASE|TRUNCATE\s+TABLE)\b/i.test(withoutTrailingSemi)) {
    return {
      classification: 'destructive_blocked',
      allowedDirectExecution: false,
      requiresOwnerApproval: true,
      verb,
      reason: `Destructive command "${verb}" is blocked from direct execution and requires an approved recovery workflow.`,
      normalizedSql: withoutTrailingSemi,
    };
  }

  const readOnlyVerbs = new Set(['SELECT', 'WITH', 'EXPLAIN', 'SHOW']);
  if (readOnlyVerbs.has(verb)) {
    // Guard against writable CTEs like WITH deleted AS (DELETE ...) SELECT ...
    if (/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b/i.test(withoutTrailingSemi)) {
      return {
        classification: 'migration_or_dml',
        allowedDirectExecution: false,
        requiresOwnerApproval: true,
        verb,
        reason: 'Statement contains write operations inside a CTE and requires Owner approval.',
        normalizedSql: withoutTrailingSemi,
      };
    }
    return {
      classification: 'read_only',
      allowedDirectExecution: true,
      requiresOwnerApproval: false,
      verb,
      reason: 'Safe read-only query approved for immediate inspection.',
      normalizedSql: withoutTrailingSemi,
    };
  }

  const migrationOrDmlVerbs = new Set(['INSERT', 'UPDATE', 'DELETE', 'ALTER', 'CREATE']);
  if (migrationOrDmlVerbs.has(verb)) {
    return {
      classification: 'migration_or_dml',
      allowedDirectExecution: false,
      requiresOwnerApproval: true,
      verb,
      reason: `State-changing command "${verb}" must be queued as a Database Migration approval request.`,
      normalizedSql: withoutTrailingSemi,
    };
  }

  return {
    classification: 'invalid',
    allowedDirectExecution: false,
    requiresOwnerApproval: false,
    verb,
    reason: `Unsupported SQL command "${verb}".`,
    normalizedSql: withoutTrailingSemi,
  };
}

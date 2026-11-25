import crypto from 'node:crypto';
import type { ActionType, ApprovalRequirement } from './types.ts';

const DEFAULT_TOKEN_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

export function hashPassword(password: string, existingSalt?: string): string {
  const salt = existingSalt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  if (derivedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(derivedBuf, expectedBuf);
}

export interface AuthTokenPayload {
  sub: string;
  email: string;
  role: 'owner' | 'auditor';
  iat: number;
  exp: number;
}

export function createAuthToken(
  payload: Omit<AuthTokenPayload, 'iat' | 'exp'>,
  secret: string,
  ttlMs: number = DEFAULT_TOKEN_TTL_MS
): string {
  const now = Date.now();
  const fullPayload: AuthTokenPayload = {
    ...payload,
    iat: now,
    exp: now + ttlMs,
  };
  const encodedHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const encodedBody = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const signingInput = `${encodedHeader}.${encodedBody}`;
  const signature = crypto.createHmac('sha256', secret).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

export function verifyAuthToken(token: string, secret: string): AuthTokenPayload | null {
  const segments = token.split('.');
  if (segments.length !== 3) return null;
  const [encodedHeader, encodedBody, providedSig] = segments;
  if (!encodedHeader || !encodedBody || !providedSig) return null;

  const signingInput = `${encodedHeader}.${encodedBody}`;
  const expectedSig = crypto.createHmac('sha256', secret).update(signingInput).digest('base64url');
  const providedBuf = Buffer.from(providedSig);
  const expectedBuf = Buffer.from(expectedSig);
  if (providedBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(providedBuf, expectedBuf)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(encodedBody, 'base64url').toString('utf8')) as AuthTokenPayload;
    if (!parsed.sub || !parsed.email || typeof parsed.exp !== 'number') return null;
    if (Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

export interface ApprovalPolicyRule {
  actionType: ActionType;
  label: string;
  requirement: ApprovalRequirement;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  requiresHumanApproval: boolean;
  description: string;
}

export const APPROVAL_POLICY_MATRIX: Record<ActionType, ApprovalPolicyRule> = {
  research: {
    actionType: 'research',
    label: 'General Research',
    requirement: 'none',
    riskLevel: 'low',
    requiresHumanApproval: false,
    description: 'Information gathering and read-only exploration without external mutation.',
  },
  planning: {
    actionType: 'planning',
    label: 'Task Planning',
    requirement: 'none',
    riskLevel: 'low',
    requiresHumanApproval: false,
    description: 'Chief Agent decomposition, milestone structuring, and scheduling.',
  },
  code_analysis: {
    actionType: 'code_analysis',
    label: 'Code Analysis',
    requirement: 'none',
    riskLevel: 'low',
    requiresHumanApproval: false,
    description: 'Static inspection, bug detection, and security auditing without modifying files.',
  },
  test_execution: {
    actionType: 'test_execution',
    label: 'Test Execution',
    requirement: 'auto_sandbox',
    riskLevel: 'low',
    requiresHumanApproval: false,
    description: 'Automated test suites, lint, and build verification in isolated environment.',
  },
  branch_code_change: {
    actionType: 'branch_code_change',
    label: 'New Branch Code Changes',
    requirement: 'restricted_branch',
    riskLevel: 'medium',
    requiresHumanApproval: true,
    description: 'Code edits on an isolated feature branch; requires scoped permission before merge.',
  },
  production_deploy: {
    actionType: 'production_deploy',
    label: 'Production Deployment',
    requirement: 'mandatory',
    riskLevel: 'critical',
    requiresHumanApproval: true,
    description: 'Mandatory Owner approval before deploying to any live environment.',
  },
  database_migration: {
    actionType: 'database_migration',
    label: 'Database Migration',
    requirement: 'mandatory',
    riskLevel: 'critical',
    requiresHumanApproval: true,
    description: 'Mandatory Owner approval before altering schemas or executing migrations.',
  },
  database_deletion: {
    actionType: 'database_deletion',
    label: 'Database Deletion',
    requirement: 'mandatory',
    riskLevel: 'critical',
    requiresHumanApproval: true,
    description: 'Mandatory Owner approval; existing databases cannot be dropped automatically.',
  },
  payment_purchase: {
    actionType: 'payment_purchase',
    label: 'Payment or Purchase',
    requirement: 'mandatory',
    riskLevel: 'critical',
    requiresHumanApproval: true,
    description: 'Mandatory Owner approval; no paid subscriptions or purchases allowed autonomously.',
  },
  external_message: {
    actionType: 'external_message',
    label: 'WhatsApp / Email Dispatch',
    requirement: 'mandatory',
    riskLevel: 'high',
    requiresHumanApproval: true,
    description: 'Mandatory Owner approval before sending external messages to customers or partners.',
  },
};

export function evaluateActionPolicy(
  actionType: ActionType,
  emergencyStopActive: boolean
): {
  allowedImmediately: boolean;
  requiresApproval: boolean;
  blockedByEmergencyStop: boolean;
  rule: ApprovalPolicyRule;
} {
  const rule = APPROVAL_POLICY_MATRIX[actionType];
  if (emergencyStopActive) {
    return {
      allowedImmediately: false,
      requiresApproval: rule.requiresHumanApproval,
      blockedByEmergencyStop: true,
      rule,
    };
  }
  return {
    allowedImmediately: !rule.requiresHumanApproval,
    requiresApproval: rule.requiresHumanApproval,
    blockedByEmergencyStop: false,
    rule,
  };
}

export interface PromptInjectionCheck {
  safe: boolean;
  flaggedPatterns: string[];
  sanitizedText: string;
}

const INJECTION_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: 'instruction-override', regex: /ignore\s+(all\s+)?(previous|prior|system)\s+instructions/i },
  { label: 'approval-bypass', regex: /bypass\s+(human\s+)?approval|skip\s+approval\s+gate/i },
  { label: 'secret-exfiltration', regex: /(print|reveal|dump|exfiltrate|send)\s+.*(jwt_secret|admin_password|gemini_api_key|database_url|\.env)/i },
  { label: 'destructive-sql', regex: /\b(drop\s+database|drop\s+table|truncate\s+table|rm\s+-rf\s+\/)\b/i },
  { label: 'role-escalation', regex: /you\s+are\s+now\s+(root|unrestricted|jailbroken|dan)/i },
];

export function inspectPromptSafety(input: string): PromptInjectionCheck {
  const flaggedPatterns: string[] = [];
  for (const item of INJECTION_PATTERNS) {
    if (item.regex.test(input)) {
      flaggedPatterns.push(item.label);
    }
  }
  return {
    safe: flaggedPatterns.length === 0,
    flaggedPatterns,
    sanitizedText: input.trim(),
  };
}

export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests = 120, windowMs = 60_000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  check(key: string, now: number = Date.now()): {
    allowed: boolean;
    remaining: number;
    resetInMs: number;
  } {
    const cutoff = now - this.windowMs;
    const timestamps = (this.hits.get(key) || []).filter((t) => t > cutoff);
    if (timestamps.length >= this.maxRequests) {
      const oldest = timestamps[0] ?? now;
      this.hits.set(key, timestamps);
      return {
        allowed: false,
        remaining: 0,
        resetInMs: Math.max(0, oldest + this.windowMs - now),
      };
    }
    timestamps.push(now);
    this.hits.set(key, timestamps);
    return {
      allowed: true,
      remaining: Math.max(0, this.maxRequests - timestamps.length),
      resetInMs: this.windowMs,
    };
  }
}

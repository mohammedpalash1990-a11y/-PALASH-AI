/**
 * End-to-end API tests. The app is started on an ephemeral port against a
 * throwaway data directory, so these exercise real HTTP routes rather than
 * isolated helpers.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';

const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'palash-api-test-'));
process.env.PALASH_DATA_DIR = tempDataDir;
process.env.JWT_SECRET = 'test-signing-secret-with-more-than-32-chars';
process.env.NODE_ENV = 'test';
delete process.env.ADMIN_EMAIL;
delete process.env.ADMIN_PASSWORD;

let server: Server;
let baseUrl = '';
let ownerToken = '';

interface JsonResponse {
  status: number;
  body: any;
}

async function call(
  method: string,
  urlPath: string,
  body?: unknown,
  token?: string,
  extraHeaders: Record<string, string> = {}
): Promise<JsonResponse> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

before(async () => {
  const { createApp } = await import('../server.ts');
  const app = await createApp();
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('failed to bind test server');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(() => {
  server?.close();
  fs.rmSync(tempDataDir, { recursive: true, force: true });
});

test('health endpoint reports the seeded state without requiring auth', async () => {
  const res = await call('GET', '/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'healthy');
  assert.equal(res.body.agentsCount, 7);
  assert.equal(res.body.database.tablesCount, 7);
});

test('auth status does not leak an unconfigured owner email', async () => {
  const res = await call('GET', '/api/auth/status');
  assert.equal(res.status, 200);
  assert.equal(res.body.needsSetup, true);
  assert.equal(res.body.suggestedEmail, '');
});

test('protected routes reject anonymous callers', async () => {
  for (const route of ['/api/overview', '/api/tasks', '/api/projects', '/api/approvals', '/api/audit-logs']) {
    const res = await call('GET', route);
    assert.equal(res.status, 401, `expected 401 for ${route}`);
  }
  const badToken = await call('GET', '/api/overview', undefined, 'not-a-real-token');
  assert.equal(badToken.status, 401);
});

test('first-run setup creates the owner and cannot be repeated', async () => {
  const shortPassword = await call('POST', '/api/auth/setup', {
    email: 'owner@test.local',
    password: 'short',
  });
  assert.equal(shortPassword.status, 400);

  const created = await call('POST', '/api/auth/setup', {
    email: 'owner@test.local',
    password: 'CorrectHorseBattery1',
    name: 'Test Owner',
  });
  assert.equal(created.status, 201);
  assert.ok(created.body.token);
  assert.equal(created.body.user.role, 'owner');
  ownerToken = created.body.token;

  const again = await call('POST', '/api/auth/setup', {
    email: 'intruder@test.local',
    password: 'AnotherPassword1',
  });
  assert.equal(again.status, 409);
});

test('login rejects bad credentials and accepts the stored hash', async () => {
  const wrong = await call('POST', '/api/auth/login', {
    email: 'owner@test.local',
    password: 'WrongPassword1',
  });
  assert.equal(wrong.status, 401);

  const ok = await call('POST', '/api/auth/login', {
    email: 'owner@test.local',
    password: 'CorrectHorseBattery1',
  });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);
});

test('task creation validates agent and action enums instead of crashing', async () => {
  const unknownAction = await call(
    'POST',
    '/api/tasks',
    { title: 'x', actionType: 'launch_nukes' },
    ownerToken
  );
  assert.equal(unknownAction.status, 400);
  assert.match(String(unknownAction.body.error), /Unknown actionType/);

  const unknownAgent = await call(
    'POST',
    '/api/tasks',
    { title: 'x', assignedAgentId: 'ghost-agent' },
    ownerToken
  );
  assert.equal(unknownAgent.status, 400);
  assert.match(String(unknownAgent.body.error), /Unknown agent/);

  const valid = await call(
    'POST',
    '/api/tasks',
    { title: 'Index the orders table', actionType: 'research', assignedAgentId: 'software-engineer' },
    ownerToken
  );
  assert.equal(valid.status, 201);
  assert.equal(valid.body.task.status, 'queued');
});

test('high-risk tasks land in the approval queue and cannot execute early', async () => {
  const created = await call(
    'POST',
    '/api/tasks',
    {
      title: 'Ship checkout to production',
      actionType: 'production_deploy',
      assignedAgentId: 'software-engineer',
    },
    ownerToken
  );
  assert.equal(created.status, 201);
  assert.equal(created.body.task.status, 'awaiting_approval');
  assert.ok(created.body.approval);
  const taskId = created.body.task.id;
  const approvalId = created.body.approval.id;

  const early = await call('POST', `/api/tasks/${taskId}/execute`, {}, ownerToken);
  assert.equal(early.status, 409);

  const rejected = await call(
    'POST',
    `/api/approvals/${approvalId}/decide`,
    { decision: 'rejected', note: 'not yet' },
    ownerToken
  );
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.approval.status, 'rejected');
  assert.equal(rejected.body.task.status, 'cancelled');

  const afterReject = await call('POST', `/api/tasks/${taskId}/execute`, {}, ownerToken);
  assert.notEqual(afterReject.status, 200);
});

test('approval decision is idempotent-safe: a decided approval cannot be re-decided', async () => {
  const created = await call(
    'POST',
    '/api/tasks',
    { title: 'Migrate ledger', actionType: 'database_migration' },
    ownerToken
  );
  const approvalId = created.body.approval.id;

  const first = await call(
    'POST',
    `/api/approvals/${approvalId}/decide`,
    { decision: 'approved' },
    ownerToken
  );
  assert.equal(first.status, 200);
  assert.equal(first.body.task.status, 'queued');

  const second = await call(
    'POST',
    `/api/approvals/${approvalId}/decide`,
    { decision: 'rejected' },
    ownerToken
  );
  assert.equal(second.status, 409);

  const invalid = await call(
    'POST',
    `/api/approvals/${approvalId}/decide`,
    { decision: 'maybe' },
    ownerToken
  );
  assert.equal(invalid.status, 400);
});

test('emergency stop blocks new work until operations resume', async () => {
  const stop = await call(
    'POST',
    '/api/system/emergency-stop',
    { active: true, reason: 'test halt' },
    ownerToken
  );
  assert.equal(stop.status, 200);
  assert.equal(stop.body.emergencyStop, true);

  const blocked = await call('POST', '/api/tasks', { title: 'should not start' }, ownerToken);
  assert.equal(blocked.status, 423);

  const health = await call('GET', '/api/health');
  assert.equal(health.body.status, 'halted');

  const resume = await call(
    'POST',
    '/api/system/emergency-stop',
    { active: false, reason: 'test resume' },
    ownerToken
  );
  assert.equal(resume.status, 200);
  assert.equal(resume.body.emergencyStop, false);

  const allowed = await call('POST', '/api/tasks', { title: 'allowed again' }, ownerToken);
  assert.equal(allowed.status, 201);
});

test('SQL console blocks writes and never returns password hashes', async () => {
  const destructive = await call('POST', '/api/database/query', { sql: 'DROP TABLE users' }, ownerToken);
  assert.equal(destructive.status, 403);

  const stacked = await call(
    'POST',
    '/api/database/query',
    { sql: 'SELECT 1; DELETE FROM users' },
    ownerToken
  );
  assert.equal(stacked.status, 403);

  const readUsers = await call(
    'POST',
    '/api/database/query',
    { sql: 'SELECT * FROM users', target: 'local' },
    ownerToken
  );
  assert.equal(readUsers.status, 200);
  const serialized = JSON.stringify(readUsers.body);
  assert.ok(!serialized.includes('passwordHash'));
});

test('backups write a real verifiable file that can be restored', async () => {
  const created = await call('POST', '/api/system/backup', {}, ownerToken);
  assert.equal(created.status, 201);
  assert.equal(created.body.verified, true);
  assert.ok(created.body.sizeBytes > 0);
  assert.match(created.body.sha256, /^[a-f0-9]{64}$/);

  const backupFile = path.join(tempDataDir, 'backups', created.body.file);
  assert.ok(fs.existsSync(backupFile), 'backup file should exist on disk');

  const listed = await call('GET', '/api/system/backups', undefined, ownerToken);
  assert.equal(listed.status, 200);
  assert.ok(listed.body.backups.some((b: { id: string }) => b.id === created.body.file));

  const withoutConfirm = await call(
    'POST',
    `/api/system/backups/${created.body.file}/restore`,
    {},
    ownerToken
  );
  assert.equal(withoutConfirm.status, 400);

  const restored = await call(
    'POST',
    `/api/system/backups/${created.body.file}/restore`,
    { confirm: true },
    ownerToken
  );
  assert.equal(restored.status, 200);
  assert.equal(restored.body.restored, true);

  const traversal = await call(
    'POST',
    '/api/system/backups/..%2F..%2Fpalash-state.json/restore',
    { confirm: true },
    ownerToken
  );
  assert.equal(traversal.status, 400);
});

test('credential endpoints are throttled per IP', async () => {
  // Distinct forwarded address so the shared limiter key is fresh.
  const spoofedIp = { 'x-forwarded-for': '203.0.113.42' };
  let sawThrottle = false;
  for (let i = 0; i < 12; i++) {
    const res = await call(
      'POST',
      '/api/auth/login',
      { email: 'owner@test.local', password: `wrong-${i}` },
      undefined,
      spoofedIp
    );
    if (res.status === 429) {
      sawThrottle = true;
      assert.ok(res.body.retryAfterMs > 0);
      break;
    }
    assert.equal(res.status, 401);
  }
  assert.equal(sawThrottle, true, 'repeated failed logins should eventually be throttled');
});

test('unknown API routes return JSON 404 rather than HTML', async () => {
  const res = await call('GET', '/api/does-not-exist', undefined, ownerToken);
  assert.equal(res.status, 404);
  assert.ok(res.body && typeof res.body === 'object');
});

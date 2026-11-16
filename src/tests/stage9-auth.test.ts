import assert from 'node:assert/strict';
import { authRateLimit, clearSessionCookie, cookieToken, createAuthMiddleware, hashPassword, setSessionCookie, verifyPassword } from '../server/auth';
import { agentScope, runScope, taskReadScope, taskWriteScope } from '../server/ownership';

async function run() {
  const password = 'long-enough-example-password';
  const encoded = await hashPassword(password);
  assert.match(encoded, /^scrypt\$32768\$8\$1\$/);
  assert.notEqual(encoded, password);
  assert.equal(await verifyPassword(password, encoded), true);
  assert.equal(await verifyPassword('incorrect-password', encoded), false);

  const cookieResponse: any = { setHeader: (_key: string, value: string) => { cookieResponse.value = value; } };
  setSessionCookie(cookieResponse, 'opaque-session-value');
  assert.match(cookieResponse.value, /HttpOnly/);
  assert.match(cookieResponse.value, /SameSite=Strict/);
  assert.match(cookieResponse.value, /Path=\//);
  const cookieRequest: any = { headers: { cookie: cookieResponse.value.split(';')[0] } };
  assert.equal(cookieToken(cookieRequest), 'opaque-session-value');
  clearSessionCookie(cookieResponse);
  assert.match(cookieResponse.value, /Max-Age=0/);

  const user = { id: 'user-a', email: 'a@example.test', role: 'USER' as const };
  const otherUser = { id: 'user-b', email: 'b@example.test', role: 'USER' as const };
  const admin = { id: 'admin', email: 'admin@example.test', role: 'ADMIN' as const };
  assert.deepEqual(agentScope(user), { ownerId: 'user-a' });
  assert.deepEqual(agentScope(otherUser), { ownerId: 'user-b' });
  assert.notDeepEqual(agentScope(user), agentScope(otherUser));
  assert.deepEqual(runScope(user), { ownerId: 'user-a' });
  assert.deepEqual(runScope(otherUser), { ownerId: 'user-b' });
  assert.deepEqual(taskReadScope(user), { OR: [{ ownerId: 'user-a' }, { isShared: true }] });
  assert.deepEqual(taskReadScope(otherUser), { OR: [{ ownerId: 'user-b' }, { isShared: true }] });
  assert.deepEqual(taskWriteScope(user), { ownerId: 'user-a' });
  assert.deepEqual(agentScope(admin), {});
  assert.deepEqual(taskReadScope(admin), {});

  const middleware = createAuthMiddleware([]);
  const response: any = { status(code: number) { this.code = code; return this; }, json(body: unknown) { this.body = body; return this; } };
  let continued = false;
  await middleware({ method: 'GET', path: '/agents', headers: {}, socket: { remoteAddress: '127.0.0.1' } } as any, response, (() => { continued = true; }) as any);
  assert.equal(response.code, 401);
  assert.equal(continued, false);

  const originResponse: any = { status(code: number) { this.code = code; return this; }, json(body: unknown) { this.body = body; return this; } };
  await middleware({ method: 'POST', path: '/auth/login', headers: {}, socket: { remoteAddress: '127.0.0.1' } } as any, originResponse, (() => {}) as any);
  assert.equal(originResponse.code, 403);

  const rateLimit = authRateLimit();
  let blocked = false;
  for (let index = 0; index < 11; index++) {
    const result: any = { setHeader() {}, status(code: number) { if (code === 429) blocked = true; return this; }, json() { return this; } };
    rateLimit({ socket: { remoteAddress: 'test-auth-ip' } } as any, result, (() => {}) as any);
  }
  assert.equal(blocked, true);
  console.log('Stage 9 authentication and ownership tests: PASS');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });

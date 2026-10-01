import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { io as connectSocket } from 'socket.io-client';
import { query } from '../../server/db/connection.js';
import { AuthService } from '../../server/services/AuthService.js';
import { MfaService, __mfaTest } from '../../server/services/MfaService.js';
import { createProductionGameServer } from '../../server/production.js';

const auth = new AuthService();
const fixtureIds = [];
const usernames = [];
const testIp = `198.19.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 254) + 1}`;
const login = input => auth.login({ ...input, ipAddress: testIp });
const hash = value => createHash('sha256').update(value).digest('hex');
function registration() {
  const username = `auth_${randomUUID().replaceAll('-', '').slice(0, 18)}`;
  usernames.push(username);
  return { username, email: `${username}@example.test`, displayName: 'Auth Test', password: 'Testing-secure-2026' };
}
async function createAccount() {
  const input = registration();
  const result = await auth.register(input);
  fixtureIds.push(result.user.id);
  return { input, ...result };
}
after(async () => {
  await query('DELETE FROM admin_audit_logs WHERE admin_id=ANY($1::uuid[]) OR target_id=ANY($1::uuid[])', [fixtureIds]);
  for (const table of ['admin_mfa_credentials', 'auth_sessions', 'account_tokens', 'wallet_transactions', 'wallets']) {
    await query(`DELETE FROM ${table} WHERE user_id=ANY($1::uuid[])`, [fixtureIds]);
  }
  await query('DELETE FROM users WHERE id=ANY($1::uuid[])', [fixtureIds]);
  await query('DELETE FROM auth_login_rate_limits WHERE key_hash=ANY($1::text[])', [[hash(`ip:${testIp}`), ...usernames.flatMap(name => [hash(`account:${name}`), hash(`account:${name}@example.test`)])]]);
});

test('concurrent registration creates one player, one wallet and one welcome grant', async () => {
  const input = registration();
  const attempts = await Promise.allSettled([auth.register({ ...input, role: 'admin' }), auth.register(input)]);
  const succeeded = attempts.filter(item => item.status === 'fulfilled');
  assert.equal(succeeded.length, 1);
  const result = succeeded[0].value;
  fixtureIds.push(result.user.id);
  assert.equal(result.user.role, 'player');
  assert.equal(result.wallet.balance, 100000);
  const stored = (await query('SELECT password_hash FROM users WHERE id=$1', [result.user.id])).rows[0];
  assert.match(stored.password_hash, /^\$argon2id\$/);
  assert.equal((await query('SELECT id FROM wallet_transactions WHERE user_id=$1', [result.user.id])).rowCount, 1);
  const session = (await query('SELECT token_hash,csrf_token_hash FROM auth_sessions WHERE user_id=$1', [result.user.id])).rows[0];
  assert.equal(session.token_hash, hash(result.sessionToken));
  assert.equal(session.csrf_token_hash, hash(result.csrfToken));
  assert.equal(Object.hasOwn(result.user, 'password_hash'), false);
});

test('CSRF, logout, password change, idle expiration and durable login throttling', async () => {
  const account = await createAccount();
  await assert.rejects(auth.verifySession(account.sessionToken, { requireCsrf: true, csrfToken: 'x'.repeat(43) }), { code: 'AUTH_CSRF_INVALID' });
  assert.equal((await auth.verifySession(account.sessionToken, { requireCsrf: true, csrfToken: account.csrfToken })).userId, account.user.id);
  const second = await login({ identifier: account.input.email, password: account.input.password });
  await auth.logout(account.sessionToken);
  await assert.rejects(auth.verifySession(account.sessionToken), { code: 'AUTH_SESSION_INVALID' });
  await auth.changePassword({ userId: account.user.id, currentPassword: account.input.password, newPassword: 'Changed-secure-2026' });
  await assert.rejects(auth.verifySession(second.sessionToken), { code: 'AUTH_SESSION_INVALID' });
  const third = await login({ identifier: account.input.username, password: 'Changed-secure-2026' });
  await query("UPDATE auth_sessions SET idle_expires_at=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE id=$1", [third.session.id]);
  await assert.rejects(auth.verifySession(third.sessionToken), { code: 'AUTH_SESSION_EXPIRED' });
  for (let attempt = 0; attempt < 5; attempt++) {
    await assert.rejects(login({ identifier: account.input.username, password: 'incorrect' }), error => ['AUTH_INVALID_CREDENTIALS', 'AUTH_LOGIN_RATE_LIMITED'].includes(error.code));
  }
  await assert.rejects(new AuthService().login({ identifier: account.input.username, password: 'Changed-secure-2026', ipAddress: testIp }), { code: 'AUTH_LOGIN_RATE_LIMITED' });
});

test('verification and password reset tokens are hashed, one-time and revoke old sessions', async () => {
  const account = await createAccount();
  let verification;
  await auth.requestEmailVerification({ userId: account.user.id, sendEmail: data => { verification = data; } });
  assert.equal(verification.to, account.input.email);
  assert.equal((await query('SELECT token_hash FROM account_tokens WHERE user_id=$1', [account.user.id])).rows[0].token_hash, hash(verification.token));
  await auth.verifyEmail({ token: verification.token });
  await assert.rejects(auth.verifyEmail({ token: verification.token }), { code: 'AUTH_RESET_TOKEN_INVALID' });
  let reset;
  assert.deepEqual(await auth.requestPasswordReset({ email: account.input.email, sendPasswordReset: data => { reset = data; } }), { accepted: true });
  await auth.resetPassword({ token: reset.token, newPassword: 'Recovered-secure-2026' });
  await assert.rejects(auth.resetPassword({ token: reset.token, newPassword: 'Recovered-secure-2026' }), { code: 'AUTH_RESET_TOKEN_INVALID' });
  await assert.rejects(auth.verifySession(account.sessionToken), { code: 'AUTH_SESSION_INVALID' });
  assert.equal((await login({ identifier: account.input.email, password: 'Recovered-secure-2026' })).user.id, account.user.id);
  assert.deepEqual(await auth.requestPasswordReset({ email: 'unknown@example.test' }), { accepted: true });
});

test('MFA matches RFC 6238, encrypts secrets, prevents replay and limits failures', async () => {
  const secret = __mfaTest.base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(__mfaTest.totp(secret, 59000), '287082');
  const account = await createAccount();
  await query("UPDATE users SET role='admin' WHERE id=$1", [account.user.id]);
  const mfa = new MfaService();
  await assert.rejects(mfa.requireVerifiedAdmin({ userId: account.user.id, sessionId: account.session.id }), { code: 'MFA_SETUP_REQUIRED' });
  const setup = await mfa.beginSetup({ userId: account.user.id });
  const stored = (await query('SELECT encrypted_secret FROM admin_mfa_credentials WHERE user_id=$1', [account.user.id])).rows[0];
  assert.notEqual(stored.encrypted_secret, setup.secret);
  const code = __mfaTest.totp(setup.secret);
  await mfa.verifySetup({ userId: account.user.id, sessionId: account.session.id, code });
  assert.equal((await mfa.requireVerifiedAdmin({ userId: account.user.id, sessionId: account.session.id })).verified, true);
  await assert.rejects(mfa.beginSetup({ userId: account.user.id }), { code: 'MFA_ALREADY_CONFIGURED' });
  await assert.rejects(mfa.verify({ userId: account.user.id, sessionId: account.session.id, code }), { code: 'MFA_CODE_INVALID' });
  for (let i = 0; i < 4; i++) await assert.rejects(mfa.verify({ userId: account.user.id, sessionId: account.session.id, code: 'invalid' }), { code: 'MFA_CODE_INVALID' });
  await assert.rejects(mfa.verify({ userId: account.user.id, sessionId: account.session.id, code }), { code: 'MFA_RATE_LIMITED' });
});

test('HTTP and Socket.IO enforce cookies, CSRF, Origin, admin MFA and logout', async () => {
  const server = await createProductionGameServer({ persistence: {
    recoverInterruptedGames: async () => {},
    getPlayerProfile: async userId => ({ ...(await auth.getProfile(userId)).user, balance: 100000, stats: {} }),
  }, mailer: async () => {} });
  const address = await server.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${address.port}`;
  let socket;
  try {
    const input = registration();
    const response = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(input) });
    assert.equal(response.status, 201);
    const { data } = await response.json();
    fixtureIds.push(data.user.id);
    const cookieHeaders = response.headers.getSetCookie();
    assert.match(cookieHeaders[0], /HttpOnly/);
    const cookie = cookieHeaders.map(value => value.split(';')[0]).join('; ');
    const headers = { Cookie: cookie, 'Content-Type': 'application/json', Origin: base };
    assert.equal((await fetch(`${base}/api/me`, { headers: { Cookie: 'bc_session=invalid' } })).status, 401);
    assert.equal((await fetch(`${base}/api/admin/overview`, { headers })).status, 403);
    const cleanupBody=JSON.stringify({retentionDays:30,categories:{rooms:true}});
    assert.equal((await fetch(`${base}/api/admin/cleanup/preview`, {method:'POST',headers:{...headers,'X-CSRF-Token':data.csrfToken},body:cleanupBody})).status,403);
    assert.equal((await fetch(`${base}/api/auth/logout`, { method: 'POST', headers, body: '{}' })).status, 403);
    assert.equal((await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { ...headers, 'X-CSRF-Token': data.csrfToken, Origin: 'https://foreign.example' }, body: '{}' })).status, 403);
    await query("UPDATE users SET role='admin' WHERE id=$1", [data.user.id]);
    const adminRejected = await fetch(`${base}/api/admin/overview`, { headers });
    assert.equal((await adminRejected.json()).error.code, 'MFA_SETUP_REQUIRED');
    const cleanupMfa=await fetch(`${base}/api/admin/cleanup/preview`, {method:'POST',headers:{...headers,'X-CSRF-Token':data.csrfToken},body:cleanupBody});
    assert.equal((await cleanupMfa.json()).error.code,'MFA_SETUP_REQUIRED');
    const secureHeaders = { ...headers, 'X-CSRF-Token': data.csrfToken };
    const setupResponse = await fetch(`${base}/api/auth/mfa/setup`, { method: 'POST', headers: secureHeaders, body: '{}' });
    const setup = (await setupResponse.json()).data;
    assert.equal(setupResponse.status, 200);
    const verified = await fetch(`${base}/api/auth/mfa/verify-setup`, { method: 'POST', headers: secureHeaders, body: JSON.stringify({ code: __mfaTest.totp(setup.secret) }) });
    assert.equal(verified.status, 200);
    assert.equal((await fetch(`${base}/api/admin/overview`, { headers })).status, 200);
    assert.equal((await fetch(`${base}/api/admin/cleanup/preview`, {method:'POST',headers,body:cleanupBody})).status,403);
    const cleanupPreview=await fetch(`${base}/api/admin/cleanup/preview`,{method:'POST',headers:secureHeaders,body:cleanupBody});
    assert.equal(cleanupPreview.status,200);
    const previewData=(await cleanupPreview.json()).data;
    const noConfirmation=await fetch(`${base}/api/admin/cleanup`,{method:'POST',headers:secureHeaders,body:JSON.stringify({previewToken:previewData.previewToken,confirmation:'NO',reason:'HTTP cleanup guard',requestId:randomUUID()})});
    assert.equal((await noConfirmation.json()).error.code,'CONFIRMATION_REQUIRED');
    const target = await createAccount();
    const grant = { amount: 1234, reason: 'HTTP integration grant', requestId: randomUUID() };
    for (let retry = 0; retry < 2; retry++) {
      const granted = await fetch(`${base}/api/admin/users/${target.user.id}/grants`, { method: 'POST', headers: secureHeaders, body: JSON.stringify(grant) });
      assert.equal(granted.status, 200);
      assert.equal((await granted.json()).data.balanceAfter, 101234);
    }
    const self = await fetch(`${base}/api/me?userId=${target.user.id}`, { headers });
    assert.equal((await self.json()).data.id, data.user.id);
    socket = connectSocket(base, { transports: ['websocket'], extraHeaders: { Cookie: cookie, Origin: base }, reconnection: false });
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    const disconnected = new Promise(resolve => socket.once('disconnect', resolve));
    const logout = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { ...headers, 'X-CSRF-Token': data.csrfToken }, body: '{}' });
    assert.equal(logout.status, 200);
    await disconnected;
    assert.equal((await fetch(`${base}/api/auth/me`, { headers })).status, 401);
  } finally {
    socket?.disconnect();
    await server.close();
  }
});

import { createPersistentGameServer } from './persistent.js';
import { AuthError, AuthService } from './services/AuthService.js';
import { AdminService, AdminServiceError } from './services/AdminService.js';
import { GamePersistenceService } from './services/GamePersistenceService.js';
import { MfaError, MfaService } from './services/MfaService.js';
import { createAccountMailer } from './email.js';
import { DatabaseCleanupService } from './services/DatabaseCleanupService.js';

const SESSION_COOKIE = 'bc_session';
const CSRF_COOKIE = 'bc_csrf';
const JSON_LIMIT = 16 * 1024;

function cookies(header = '') {
  const values = {};
  for (const item of header.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0) continue;
    const name = item.slice(0, separator).trim();
    try { values[name] = decodeURIComponent(item.slice(separator + 1).trim()); } catch { /* ignore malformed cookie */ }
  }
  return values;
}

function cookie(name, value, { httpOnly = false, expires = null, clear = false } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax'];
  if (httpOnly) parts.push('HttpOnly');
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  if (clear) parts.push('Max-Age=0', 'Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  else if (expires) parts.push(`Expires=${new Date(expires).toUTCString()}`);
  return parts.join('; ');
}

function setSessionCookies(res, result) {
  res.setHeader('Set-Cookie', [
    cookie(SESSION_COOKIE, result.sessionToken, {
      httpOnly: true,
      expires: result.session?.absoluteExpiresAt,
    }),
    cookie(CSRF_COOKIE, result.csrfToken, {
      expires: result.session?.absoluteExpiresAt,
    }),
  ]);
}

function clearSessionCookies(res) {
  res.setHeader('Set-Cookie', [
    cookie(SESSION_COOKIE, '', { httpOnly: true, clear: true }),
    cookie(CSRF_COOKIE, '', { clear: true }),
  ]);
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function requestIp(req) {
  return req.socket?.remoteAddress || null;
}

function assertSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  let originHost;
  try { originHost = new URL(origin).host; } catch { throw new HttpError('INVALID_ORIGIN', 'Nguồn yêu cầu không hợp lệ.', 403); }
  const configured = new Set((process.env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean));
  const developmentOrigins = process.env.NODE_ENV === 'production'
    ? new Set()
    : new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);
  if (originHost !== req.headers.host && !configured.has(origin) && !developmentOrigins.has(origin)) {
    throw new HttpError('INVALID_ORIGIN', 'Nguồn yêu cầu không được phép.', 403);
  }
}

async function readJson(req) {
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > JSON_LIMIT) throw new HttpError('PAYLOAD_TOO_LARGE', 'Dữ liệu gửi lên quá lớn.', 413);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > JSON_LIMIT) throw new HttpError('PAYLOAD_TOO_LARGE', 'Dữ liệu gửi lên quá lớn.', 413);
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
    return value;
  } catch {
    throw new HttpError('INVALID_JSON', 'Nội dung JSON không hợp lệ.', 400);
  }
}

function page(url, defaultLimit = 20) {
  const limit = Number(url.searchParams.get('limit'));
  const offset = Number(url.searchParams.get('offset'));
  return {
    limit: Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 100) : defaultLimit,
    offset: Number.isSafeInteger(offset) && offset >= 0 ? offset : 0,
  };
}

class HttpError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'HttpError';
    this.code = code;
    this.status = status;
  }
}

function requestId(body) {
  if (typeof body.requestId !== 'string' || !/^[A-Za-z0-9:_-]{8,100}$/.test(body.requestId)) {
    throw new HttpError('INVALID_REQUEST_ID', 'Mã yêu cầu phải có từ 8 đến 100 ký tự hợp lệ.', 400);
  }
  return body.requestId;
}

function reason(body) {
  if (typeof body.reason !== 'string' || body.reason.trim().length < 3 || body.reason.trim().length > 255) {
    throw new HttpError('INVALID_REASON', 'Lý do phải có từ 3 đến 255 ký tự.', 400);
  }
  return body.reason.trim();
}

function errorStatus(error) {
  if (Number.isInteger(error?.status)) return error.status;
  const code = error?.code;
  if (code === 'AUTH_REQUIRED') return 401;
  if (['ADMIN_REQUIRED', 'ACCOUNT_DISABLED', 'CSRF_INVALID', 'INVALID_ORIGIN'].includes(code)) return 403;
  if (code?.endsWith('_NOT_FOUND')) return 404;
  if (['DUPLICATE_USERNAME', 'DUPLICATE_EMAIL', 'REQUEST_CONFLICT', 'ROUND_ALREADY_SETTLED'].includes(code)) return 409;
  if (code === 'RATE_LIMITED') return 429;
  return error instanceof HttpError || error instanceof AuthError ||
    error instanceof AdminServiceError || error instanceof MfaError ? 400 : 500;
}

function safeError(res, error) {
  const status = errorStatus(error);
  if (status === 500) console.error('Authenticated API failed:', error);
  sendJson(res, status, {
    error: {
      code: status === 500 ? 'INTERNAL_ERROR' : (error.code || 'REQUEST_FAILED'),
      message: status === 500 ? 'Có lỗi máy chủ. Vui lòng thử lại.' : error.message,
    },
  });
}

function createHttpHandler({ authService, adminService, mfaService, persistence, mailer }) {
  const cleanupService = new DatabaseCleanupService();
  function disconnectSessions(runtime, userId, sessionId = null) {
    for (const socket of runtime.io.sockets.sockets.values()) {
      const identity = socket.data.identity;
      if (identity?.userId === userId && (!sessionId || identity.session?.id === sessionId)) socket.disconnect(true);
    }
  }
  async function identity(req, { csrf = false, admin = false } = {}) {
    const jar = cookies(req.headers.cookie);
    const rawToken = jar[SESSION_COOKIE];
    if (!rawToken) throw new HttpError('AUTH_REQUIRED', 'Bạn cần đăng nhập.', 401);
    let csrfToken;
    if (csrf) {
      assertSameOrigin(req);
      csrfToken = req.headers['x-csrf-token'];
      if (!csrfToken || csrfToken !== jar[CSRF_COOKIE]) {
        throw new HttpError('CSRF_INVALID', 'Mã bảo vệ yêu cầu không hợp lệ.', 403);
      }
    }
    const verified = await authService.verifySession(rawToken, { csrfToken, requireCsrf: csrf });
    if (admin && verified.role !== 'admin') throw new HttpError('ADMIN_REQUIRED', 'Chỉ quản trị viên được phép.', 403);
    if (admin) await mfaService.requireVerifiedAdmin({ userId: verified.userId, sessionId: verified.session.id });
    return { ...verified, rawToken };
  }

  return async function handleHttp(req, res, url, runtime, roomLocked = false) {
    if (!url.pathname.startsWith('/api/auth/') &&
        !url.pathname.startsWith('/api/admin/') &&
        url.pathname !== '/api/me/profile') return false;

    // Admin changes and game timers share the same per-room queue, keeping
    // committed database changes and the state broadcast in one ordered turn.
    if (!roomLocked && url.pathname.startsWith('/api/admin/') && req.method !== 'GET') {
      const match = /^\/api\/admin\/(users|rooms|rounds)\/([0-9a-f-]+)/.exec(url.pathname);
      const room = match && [...runtime.game.rooms.values()].find(entry =>
        match[1] === 'rooms' ? entry.persistenceId === match[2]
          : match[1] === 'rounds' ? entry.roundId === match[2]
            : [...entry.players.values()].some(player => player.userId === match[2]));
      if (room) {
        try { await identity(req, { csrf: true, admin: true }); }
        catch (error) { safeError(res, error); return true; }
        return runtime.game.withRoomOperation(room, () => handleHttp(req, res, url, runtime, true));
      }
    }

    try {
      const method = req.method || 'GET';
      if (url.pathname === '/api/auth/register' && method === 'POST') {
        assertSameOrigin(req);
        const body = await readJson(req);
        const result = await authService.register({
          username: body.username,
          email: body.email,
          password: body.password,
          displayName: body.displayName,
          avatarKey: body.avatarKey,
          ipAddress: requestIp(req),
          userAgent: req.headers['user-agent'],
        });
        setSessionCookies(res, result);
        sendJson(res, 201, { data: { user: result.user, wallet: result.wallet, csrfToken: result.csrfToken } });
        return true;
      }
      if (url.pathname === '/api/auth/login' && method === 'POST') {
        assertSameOrigin(req);
        const body = await readJson(req);
        const result = await authService.login({
          identifier: body.username ?? body.identifier,
          password: body.password,
          ipAddress: requestIp(req),
          userAgent: req.headers['user-agent'],
        });
        setSessionCookies(res, result);
        sendJson(res, 200, { data: { user: result.user, wallet: result.wallet, csrfToken: result.csrfToken } });
        return true;
      }
      if (url.pathname === '/api/auth/me' && method === 'GET') {
        const jar = cookies(req.headers.cookie);
        const session = await identity(req);
        const profile = await persistence.getPlayerProfile(session.userId);
        const mfa = await mfaService.status({ userId: session.userId, sessionId: session.session.id });
        sendJson(res, 200, {
          data: {
            user: { ...session.user, balance: profile.balance, stats: profile.stats },
            csrfToken: jar[CSRF_COOKIE] || null,
            mfa,
          },
        });
        return true;
      }
      if (url.pathname === '/api/auth/mfa/status' && method === 'GET') {
        const session = await identity(req);
        sendJson(res, 200, {
          data: await mfaService.status({ userId: session.userId, sessionId: session.session.id }),
        });
        return true;
      }
      if (url.pathname === '/api/auth/mfa/setup' && method === 'POST') {
        const session = await identity(req, { csrf: true });
        if (session.role !== 'admin') throw new HttpError('ADMIN_REQUIRED', 'Chỉ quản trị viên được phép.', 403);
        const current = await mfaService.status({ userId: session.userId, sessionId: session.session.id });
        if (current.configured) {
          await mfaService.requireVerifiedAdmin({ userId: session.userId, sessionId: session.session.id });
        }
        sendJson(res, 200, { data: await mfaService.beginSetup({ userId: session.userId }) });
        return true;
      }
      if (url.pathname === '/api/auth/mfa/verify-setup' && method === 'POST') {
        const session = await identity(req, { csrf: true });
        const body = await readJson(req);
        sendJson(res, 200, {
          data: await mfaService.verifySetup({
            userId: session.userId,
            sessionId: session.session.id,
            code: body.code,
          }),
        });
        return true;
      }
      if (url.pathname === '/api/auth/mfa/verify' && method === 'POST') {
        const session = await identity(req, { csrf: true });
        const body = await readJson(req);
        sendJson(res, 200, {
          data: await mfaService.verify({
            userId: session.userId,
            sessionId: session.session.id,
            code: body.code,
          }),
        });
        return true;
      }
      if (url.pathname === '/api/auth/logout' && method === 'POST') {
        const session = await identity(req, { csrf: true });
        await authService.logout(session.rawToken);
        disconnectSessions(runtime, session.userId, session.session.id);
        clearSessionCookies(res);
        sendJson(res, 200, { data: { revoked: true } });
        return true;
      }
      if (url.pathname === '/api/auth/logout-all' && method === 'POST') {
        const session = await identity(req, { csrf: true });
        const result = await authService.logoutAll(session.userId);
        disconnectSessions(runtime, session.userId);
        clearSessionCookies(res);
        sendJson(res, 200, { data: result });
        return true;
      }
      if (url.pathname === '/api/auth/change-password' && method === 'POST') {
        const session = await identity(req, { csrf: true });
        const body = await readJson(req);
        const result = await authService.changePassword({
          userId: session.userId,
          currentPassword: body.currentPassword,
          newPassword: body.newPassword,
        });
        disconnectSessions(runtime, session.userId);
        clearSessionCookies(res);
        sendJson(res, 200, { data: result });
        return true;
      }
      if (url.pathname === '/api/auth/password-reset/request' && method === 'POST') {
        assertSameOrigin(req);
        if (!mailer) throw new HttpError('EMAIL_NOT_CONFIGURED', 'Chức năng email chưa được cấu hình trên máy chủ.', 503);
        const body = await readJson(req);
        const result = await authService.requestPasswordReset({
          email: body.email,
          ipAddress: requestIp(req),
          sendPasswordReset: data => mailer({ ...data, type: 'password_reset' }),
        });
        sendJson(res, 202, { data: result });
        return true;
      }
      if (url.pathname === '/api/auth/email-verification/request' && method === 'POST') {
        const session = await identity(req, { csrf: true });
        if (!mailer) throw new HttpError('EMAIL_NOT_CONFIGURED', 'Chức năng email chưa được cấu hình trên máy chủ.', 503);
        sendJson(res, 202, { data: await authService.requestEmailVerification({ userId: session.userId, sendEmail: mailer }) });
        return true;
      }
      if (url.pathname === '/api/auth/email-verification/confirm' && method === 'POST') {
        assertSameOrigin(req);
        const body = await readJson(req);
        sendJson(res, 200, { data: await authService.verifyEmail({ token: body.token }) });
        return true;
      }
      if (url.pathname === '/api/auth/password-reset/confirm' && method === 'POST') {
        assertSameOrigin(req);
        const body = await readJson(req);
        const result = await authService.resetPassword({ token: body.token, newPassword: body.newPassword });
        disconnectSessions(runtime, result.user.id);
        clearSessionCookies(res);
        sendJson(res, 200, { data: result });
        return true;
      }
      if (url.pathname === '/api/me/profile' && method === 'PATCH') {
        const session = await identity(req, { csrf: true });
        const body = await readJson(req);
        const result = await authService.updateProfile(session.userId, {
          displayName: body.displayName,
          avatarKey: body.avatarKey,
        });
        await runtime.game.refreshPlayerProfile(session.userId);
        sendJson(res, 200, { data: result });
        return true;
      }

      if (!url.pathname.startsWith('/api/admin/')) {
        throw new HttpError('NOT_FOUND', 'Không tìm thấy API.', 404);
      }

      const adminIdentity = await identity(req, {
        admin: true,
        csrf: !['GET', 'HEAD'].includes(method),
      });
      const actorId = adminIdentity.userId;

      if (url.pathname === '/api/admin/cleanup/preview' && method === 'POST') {
        const body = await readJson(req);
        const data = await cleanupService.preview({ ...body, actorId, excludedRoomIds: [...runtime.game.rooms.keys()] });
        sendJson(res, 200, { data });
        return true;
      }
      if (url.pathname === '/api/admin/cleanup' && method === 'POST') {
        const body = await readJson(req);
        const data = await cleanupService.execute({ actorId, previewToken: body.previewToken, confirmation: body.confirmation,
          requestId: requestId(body), reason: reason(body), ipAddress: requestIp(req), excludedRoomIds: [...runtime.game.rooms.keys()] });
        sendJson(res, 200, { data });
        return true;
      }

      if (url.pathname === '/api/admin/overview' && method === 'GET') {
        const overview = await adminService.getOverview({ actorId });
        const livePlayers = [...runtime.game.rooms.values()].reduce(
          (sum, room) => sum + [...room.players.values()].filter(player => player.connected).length,
          0
        );
        sendJson(res, 200, {
          data: {
            ...overview,
            live: {
              rooms: runtime.game.rooms.size,
              players: livePlayers,
              observedAt: new Date().toISOString(),
            },
          },
        });
        return true;
      }
      if (url.pathname === '/api/admin/users' && method === 'GET') {
        const result = await adminService.listUsers({
          actorId,
          search: url.searchParams.get('search') || '',
          status: url.searchParams.get('status') || null,
          ...page(url),
        });
        sendJson(res, 200, { data: result });
        return true;
      }
      const userMatch = /^\/api\/admin\/users\/([0-9a-f-]+)$/.exec(url.pathname);
      if (userMatch && method === 'GET') {
        sendJson(res, 200, { data: await adminService.getUser({ actorId, userId: userMatch[1] }) });
        return true;
      }
      const userAction = /^\/api\/admin\/users\/([0-9a-f-]+)\/(grants|ban|unban)$/.exec(url.pathname);
      if (userAction && method === 'POST') {
        const body = await readJson(req);
        const common = { actorId, userId: userAction[1], requestId: requestId(body), reason: reason(body), ipAddress: requestIp(req) };
        const result = userAction[2] === 'grants'
          ? await adminService.grantCoins({ ...common, amount: body.amount })
          : userAction[2] === 'ban'
            ? await adminService.banUser({ ...common, bannedUntil: body.bannedUntil || null })
            : await adminService.unbanUser(common);
        if (userAction[2] === 'ban' && !result.isDuplicate) {
          runtime.game.applyAdminUserRemoval(userAction[1], null, result.membership);
          disconnectSessions(runtime, userAction[1]);
        }
        if (userAction[2] === 'grants') await runtime.game.refreshPlayerProfile(userAction[1]);
        sendJson(res, 200, { data: result });
        return true;
      }
      if (userMatch && method === 'DELETE') {
        const body = await readJson(req);
        const result = await adminService.softDeleteUser({
          actorId,
          userId: userMatch[1],
          requestId: requestId(body),
          reason: reason(body),
          ipAddress: requestIp(req),
        });
        if (!result.isDuplicate) runtime.game.applyAdminUserRemoval(userMatch[1], null, result.membership);
        disconnectSessions(runtime, userMatch[1]);
        sendJson(res, 200, { data: result });
        return true;
      }
      if (url.pathname === '/api/admin/rooms' && method === 'GET') {
        sendJson(res, 200, { data: await adminService.listRooms({ actorId, ...page(url, 50) }) });
        return true;
      }
      const roomStatus = /^\/api\/admin\/rooms\/([0-9a-f-]+)\/status$/.exec(url.pathname);
      if (roomStatus && method === 'POST') {
        const body = await readJson(req);
        const common = { actorId, roomId: roomStatus[1], requestId: requestId(body), reason: reason(body), ipAddress: requestIp(req) };
        let result;
        if (body.status === 'paused') result = await adminService.pauseRoom(common);
        else if (body.status === 'active') result = await adminService.resumeRoom(common);
        else if (body.status === 'closed') result = await adminService.closeRoom(common);
        else throw new HttpError('INVALID_ROOM_STATUS', 'Trạng thái phòng không hợp lệ.');
        if (!result.isDuplicate) {
          runtime.game.applyAdminRoomStatus(roomStatus[1], body.status);
          const room = [...runtime.game.rooms.values()].find(entry => entry.persistenceId === roomStatus[1]);
          if (body.status === 'active' && room?.phase === 'waiting' && runtime.game.autoStart) await runtime.game.openRound(room);
        }
        sendJson(res, 200, { data: result });
        return true;
      }
      const kickMatch = /^\/api\/admin\/rooms\/([0-9a-f-]+)\/members\/([0-9a-f-]+)\/kick$/.exec(url.pathname);
      if (kickMatch && method === 'POST') {
        const body = await readJson(req);
        const result = await adminService.kickMember({
          actorId,
          roomId: kickMatch[1],
          userId: kickMatch[2],
          requestId: requestId(body),
          reason: reason(body),
          ipAddress: requestIp(req),
        });
        if (!result.isDuplicate) runtime.game.applyAdminUserRemoval(kickMatch[2], kickMatch[1], result);
        sendJson(res, 200, { data: result });
        return true;
      }
      const overrideMatch = /^\/api\/admin\/rounds\/([0-9a-f-]+)\/override$/.exec(url.pathname);
      if (overrideMatch && method === 'POST') {
        const body = await readJson(req);
        const common = { actorId, roomId: body.roomId, roundId: overrideMatch[1], requestId: requestId(body), reason: reason(body), ipAddress: requestIp(req) };
        const result = body.dice === null
          ? await adminService.clearRoundResult(common)
          : await adminService.scheduleRoundResult({ ...common, dice: body.dice });
        if (!result.isDuplicate) runtime.game.applyAdminRoundOverride(overrideMatch[1], body.dice);
        sendJson(res, 200, { data: result });
        return true;
      }
      const roomControl = /^\/api\/admin\/rooms\/([0-9a-f-]+)\/(lock|betting-duration)$/.exec(url.pathname);
      if (roomControl && method === 'POST') {
        const body = await readJson(req);
        const common = { actorId, roomId: roomControl[1], requestId: requestId(body), reason: reason(body), ipAddress: requestIp(req) };
        const result = roomControl[2] === 'lock'
          ? await adminService.setRoomLock({ ...common, locked: body.locked })
          : await adminService.setBettingDuration({ ...common, durationSeconds: body.durationSeconds });
        if (!result.isDuplicate) {
          if (roomControl[2] === 'lock') runtime.game.applyAdminRoomLock(roomControl[1], result.locked);
          else runtime.game.applyAdminBettingDuration(roomControl[1], result.durationSeconds);
        }
        sendJson(res, 200, { data: result });
        return true;
      }
      const cancelMatch = /^\/api\/admin\/rounds\/([0-9a-f-]+)\/cancel$/.exec(url.pathname);
      if (cancelMatch && method === 'POST') {
        const body = await readJson(req);
        const result = await adminService.cancelCurrentRound({ actorId, roomId: body.roomId, roundId: cancelMatch[1], requestId: requestId(body), reason: reason(body), ipAddress: requestIp(req) });
        await runtime.game.applyAdminRoundCancellation(cancelMatch[1]);
        sendJson(res, 200, { data: result });
        return true;
      }
      if (url.pathname === '/api/admin/audit-logs' && method === 'GET') {
        const result = await adminService.listAuditLogs({
          actorId,
          action: url.searchParams.get('action') || null,
          ...page(url, 50),
        });
        sendJson(res, 200, { data: result });
        return true;
      }

      throw new HttpError('NOT_FOUND', 'Không tìm thấy API.', 404);
    } catch (error) {
      safeError(res, error);
      return true;
    }
  };
}

export async function createProductionGameServer(options = {}) {
  const authService = options.authService ?? new AuthService();
  const adminService = options.adminService ?? new AdminService();
  const mfaService = options.mfaService ?? new MfaService();
  const persistence = options.persistence ?? new GamePersistenceService();
  const mailer = options.mailer ?? createAccountMailer();
  const httpHandler = createHttpHandler({ authService, adminService, mfaService, persistence, mailer });

  const rawTokenFromSocket = socket => cookies(socket.request?.headers?.cookie)[SESSION_COOKIE];
  const authenticateSocket = async socket => {
    const rawToken = rawTokenFromSocket(socket);
    if (!rawToken) return null;
    return authService.verifySession(rawToken);
  };
  const authorizeSocketCommand = async (socket, _event, _payload, currentIdentity) => {
    const rawToken = rawTokenFromSocket(socket);
    if (!rawToken) return null;
    let verified;
    try { verified = await authService.verifySession(rawToken); }
    catch (error) { if (error instanceof AuthError && error.status < 500) return null; throw error; }
    return currentIdentity?.userId && currentIdentity.userId !== verified.userId ? null : verified;
  };
  const authenticateHttp = async req => {
    const rawToken = cookies(req.headers.cookie)[SESSION_COOKIE];
    try { return rawToken ? await authService.verifySession(rawToken) : null; }
    catch (error) { if (error instanceof AuthError && error.status < 500) return null; throw error; }
  };

  return createPersistentGameServer({
    ...options,
    persistence,
    authenticateSocket,
    authorizeSocketCommand,
    authenticateHttp,
    handleHttp: httpHandler,
  });
}

export { CSRF_COOKIE, SESSION_COOKIE };

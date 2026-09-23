import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { GameService } from './game.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const events = ['room:create', 'room:join', 'room:resume', 'room:sync', 'room:leave',
  'round:open', 'bet:add', 'bet:clear', 'round:shake', 'room:reset',
  'host:pause', 'host:lock', 'host:grant', 'host:kick', 'host:transfer', 'host:cancel', 'host:result',
  'host:betting-duration'];
const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg',
  '.webmanifest': 'application/manifest+json',
};

function isPrivateDevelopmentOrigin(origin) {
  try {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.port !== '5173') return false;
    const hostname = url.hostname.toLowerCase();
    if (['localhost', '127.0.0.1', '[::1]'].includes(hostname) || hostname.endsWith('.local')) return true;
    const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
    if (!match) return false;
    const octets = match.slice(1).map(Number);
    if (octets.some(value => value > 255)) return false;
    return octets[0] === 10 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 169 && octets[1] === 254);
  } catch {
    return false;
  }
}

export function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function validateConfig(config) {
  if (!config || !Number.isSafeInteger(config.initialBalance) || config.initialBalance <= 0 ||
      !Array.isArray(config.chips) || config.chips.length === 0 ||
      !config.chips.every(chip => Number.isSafeInteger(chip) && chip > 0) ||
      !Array.isArray(config.symbols) || config.symbols.length !== 6 ||
      !config.symbols.every(symbol => typeof symbol.id === 'string' && /^[a-z][a-z0-9_-]{0,23}$/.test(symbol.id)) ||
      new Set(config.symbols.map(symbol => symbol.id)).size !== 6) {
    throw new Error('Invalid game configuration.');
  }
}

export async function createGameServer(options = {}) {
  const config = structuredClone(options.config ?? JSON.parse(await readFile(resolve(projectRoot, 'game-config.json'), 'utf8')));
  validateConfig(config);
  const distRoot = resolve(options.distDir ?? resolve(projectRoot, 'dist'));
  let game;
  const httpServer = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/api/config') return sendJson(res, 200, config);
      if (req.method === 'GET' && url.pathname === '/api/state') {
        return sendJson(res, 200, { balance: config.initialBalance, history: [] });
      }
      if (req.method === 'GET' && url.pathname === '/api/health') {
        return sendJson(res, 200, { ok: true, rooms: game.rooms.size, players: game.sessions.size });
      }
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found' });
      if (!['GET', 'HEAD'].includes(req.method)) return sendJson(res, 404, { error: 'Not found' });

      const pathname = decodeURIComponent(url.pathname);
      const candidate = resolve(distRoot, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!candidate.startsWith(`${distRoot}${sep}`) || !mimeTypes[extname(candidate)]) {
        return sendJson(res, 404, { error: 'Not found' });
      }
      const actualRoot = await realpath(distRoot);
      const actualFile = await realpath(candidate);
      if (!actualFile.startsWith(`${actualRoot}${sep}`)) return sendJson(res, 404, { error: 'Not found' });
      const content = await readFile(actualFile);
      res.writeHead(200, { 'Content-Type': mimeTypes[extname(candidate)], 'Content-Length': content.length, 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      const status = error instanceof URIError ? 400 : ['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code) ? 404 : 500;
      if (status === 500) console.error('HTTP request failed:', error);
      if (!res.headersSent) sendJson(res, status, { error: status === 404 ? 'Not found' : status === 400 ? 'Bad request' : 'Server error' });
      else res.end();
    }
  });

  const hasConfiguredOrigins = options.allowedOrigins !== undefined || Boolean(process.env.ALLOWED_ORIGINS);
  const allowPrivateDevelopmentOrigins = process.env.NODE_ENV !== 'production' && !hasConfiguredOrigins;
  const allowedOrigins = new Set(options.allowedOrigins ?? (process.env.ALLOWED_ORIGINS ||
    (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5173,http://127.0.0.1:5173')).split(',').filter(Boolean));
  const io = new Server(httpServer, {
    maxHttpBufferSize: 16 * 1024,
    allowRequest(req, done) {
      const origin = req.headers.origin;
      let allowed = !origin || allowedOrigins.has(origin);
      try {
        if (origin && new URL(origin).host === req.headers.host) allowed = true;
        if (!allowed && allowPrivateDevelopmentOrigins) allowed = isPrivateDevelopmentOrigin(origin);
      } catch { allowed = false; }
      done(null, allowed);
    },
  });

  game = new GameService(config, {
    ...options,
    onState: (socketId, state) => io.to(socketId).emit('room:state', state),
    onKick: socketId => io.to(socketId).emit('room:kicked'),
    onReplace: socketId => {
      const oldSocket = io.sockets.sockets.get(socketId);
      oldSocket?.emit('session:replaced');
      oldSocket?.disconnect(true);
    },
  });

  io.on('connection', socket => {
    let windowStart = Date.now();
    let eventCount = 0;
    for (const event of events) {
      socket.on(event, (payload, acknowledge) => {
        if (typeof acknowledge !== 'function') return;
        if (Date.now() - windowStart >= 10_000) {
          windowStart = Date.now();
          eventCount = 0;
        }
        eventCount += 1;
        if (eventCount > (options.maxEventsPerWindow ?? 100)) {
          acknowledge({ ok: false, error: { code: 'RATE_LIMIT', message: 'Bạn thao tác quá nhanh. Vui lòng chờ một chút.' } });
          return;
        }
        acknowledge(game.handle(socket.id, event, payload));
      });
    }

    socket.on('client_throw_item', (payload, acknowledge) => {
      try {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
          if (typeof acknowledge === 'function') acknowledge({ ok: false, error: 'Dữ liệu không hợp lệ.' });
          return;
        }

        const membership = game.memberships.get(socket.id);
        const roomCode = payload.roomId || payload.roomCode || membership?.code;
        if (!roomCode) {
          if (typeof acknowledge === 'function') acknowledge({ ok: false, error: 'Bạn chưa tham gia phòng.' });
          return;
        }

        const room = game.rooms.get(roomCode);
        if (!room) {
          if (typeof acknowledge === 'function') acknowledge({ ok: false, error: 'Không tìm thấy phòng.' });
          return;
        }

        const allowedItems = ['egg', 'tomato', 'flower'];
        const itemType = allowedItems.includes(payload.itemType) ? payload.itemType : 'egg';

        const eventData = {
          fromId: payload.fromId || membership?.playerId || socket.id,
          toId: payload.toId || null,
          itemType,
          startPos: {
            x: Number(payload.startPos?.x) || 0,
            y: Number(payload.startPos?.y) || 0,
          },
          endPos: {
            x: Number(payload.endPos?.x) || 0,
            y: Number(payload.endPos?.y) || 0,
          },
          roomId: roomCode,
          timestamp: Date.now(),
        };

        for (const player of room.players.values()) {
          if (player.connected && player.socketId) {
            io.to(player.socketId).emit('server_item_thrown', eventData);
          }
        }

        if (typeof acknowledge === 'function') {
          acknowledge({ ok: true, data: eventData });
        }
      } catch (error) {
        console.error('Lỗi client_throw_item:', error);
        if (typeof acknowledge === 'function') acknowledge({ ok: false, error: 'Có lỗi xảy ra khi ném vật phẩm.' });
      }
    });

    socket.on('disconnect', () => game.disconnect(socket.id));
  });

  return {
    httpServer, io, game,
    listen(port = 0, host = '0.0.0.0') {
      return new Promise((resolveListen, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, () => {
          httpServer.off('error', reject);
          resolveListen(httpServer.address());
        });
      });
    },
    async close() {
      game.close();
      await new Promise(resolveClose => io.close(resolveClose));
      if (httpServer.listening) await new Promise(resolveClose => httpServer.close(resolveClose));
    },
  };
}

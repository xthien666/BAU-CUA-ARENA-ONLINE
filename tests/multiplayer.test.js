import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { io } from 'socket.io-client';
import { createGameServer } from '../server.js';

const config = JSON.parse(await readFile(new URL('../game-config.json', import.meta.url), 'utf8'));

async function setup(t, options = {}) {
  const app = await createGameServer({ autoStart: false, revealMs: 35, hostGraceMs: 60, ...options });
  const address = await app.listen(0, '127.0.0.1');
  const url = `http://127.0.0.1:${address.port}`;
  const clients = [];
  t.after(async () => { clients.forEach(client => client.disconnect()); await app.close(); });
  async function connect() {
    const socket = io(url, { transports: ['websocket'], reconnection: false, forceNew: true });
    clients.push(socket);
    socket.on('room:state', state => { socket.snapshot = state; });
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    return socket;
  }
  return { app, url, connect };
}

function command(socket, event, payload = {}) {
  if (['round:open', 'room:reset'].includes(event) && payload && payload.gameId === undefined) {
    payload = { ...payload, gameId: socket.snapshot?.gameId };
  }
  return new Promise((resolve, reject) => {
    socket.timeout(3000).emit(event, payload, (error, reply) => error ? reject(error) : resolve(reply));
  });
}

async function success(socket, event, payload = {}) {
  const reply = await command(socket, event, payload);
  assert.equal(reply.ok, true, `${event}: ${JSON.stringify(reply.error)}`);
  return reply;
}

const mutation = extra => ({ requestId: randomUUID(), ...extra });

async function waitUntil(predicate) {
  const deadline = Date.now() + 4000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'State did not converge within four seconds');
    await delay(10);
  }
}

test('20 connected players share one authoritative round; a 21st cannot join', { timeout: 15000 }, async t => {
  let draw = 0;
  const { connect } = await setup(t, { randomIntFn: () => draw++ % 6 });
  const host = await connect();
  const created = await success(host, 'room:create', { name: 'Chủ phòng' });
  const code = created.state.code;
  const players = [host, ...await Promise.all(Array.from({ length: 19 }, () => connect()))];
  const joined = await Promise.all(players.slice(1).map((socket, index) => success(socket, 'room:join', { code, name: `Người chơi ${index + 1}` })));
  const extra = await connect();
  const full = await command(extra, 'room:join', { code, name: 'Người thứ 21' });
  assert.equal(full.ok, false);
  assert.equal(full.error.code, 'ROOM_FULL');
  await waitUntil(() => players.every(socket => socket.snapshot?.players.length === 20));
  const opened = await success(host, 'round:open', mutation({ roundNumber: 0 }));
  const roundId = opened.state.roundId;
  const symbols = ['bau', 'cua', 'tom', 'ca', 'ga', 'nai'];
  const started = performance.now();
  await Promise.all(players.map((socket, index) => success(socket, 'bet:add', mutation({ roundId, symbol: symbols[index % 6], amount: 50 }))));
  t.diagnostic(`20 concurrent bet acknowledgments: ${Math.round(performance.now() - started)} ms locally`);
  assert.equal((await command(players[1], 'round:shake', mutation({ roundId }))).ok, false);
  await success(host, 'round:shake', mutation({ roundId }));
  await waitUntil(() => players.every(socket => socket.snapshot?.phase === 'result'));
  const final = host.snapshot;
  assert.equal(final.history.length, 1);
  assert.equal(final.history[0].totalBet, 1000);
  for (const [index, socket] of players.entries()) {
    assert.deepEqual(socket.snapshot.dice, final.dice);
    const matches = final.dice.filter(symbol => symbol === symbols[index % 6]).length;
    const expectedReturn = matches ? 50 * (matches + 1) : 0;
    assert.equal(socket.snapshot.you.balance, config.initialBalance - 50 + expectedReturn);
    assert.equal(socket.snapshot.you.stats.gamesPlayed, 1);
    assert.equal(socket.snapshot.you.lastResult.totalReturn, expectedReturn);
    assert.ok(socket.snapshot.players.every(player => !Object.hasOwn(player, 'token') && !Object.hasOwn(player, 'bets')));
    assert.ok(!JSON.stringify(socket.snapshot).includes(created.session.token));
    assert.ok(joined.every(reply => !JSON.stringify(socket.snapshot).includes(reply.session.token)));
  }
  const sync = await success(host, 'room:sync');
  assert.equal(sync.session.token, created.session.token);
});

test('server rejects forged amounts, over-balance, duplicate and stale mutations', async t => {
  const { connect } = await setup(t);
  const host = await connect();
  await success(host, 'room:create', { name: 'Kiểm tra' });
  const { state } = await success(host, 'round:open', mutation({ roundNumber: 0 }));
  const roundId = state.roundId;
  for (const payload of [null, {}, { symbol: '__proto__', amount: 10 }, { symbol: 'bau', amount: -10 }, { symbol: 'cua', amount: 1.5 }, { symbol: 'tom', amount: '50' }, { symbol: 'ca', amount: 1000000 }]) {
    const result = await command(host, 'bet:add', payload === null ? null : mutation({ roundId, ...payload }));
    assert.equal(result.ok, false);
  }
  const halfBalance = Math.floor(config.initialBalance / 2);
  const bet = mutation({ roundId, symbol: 'cua', amount: halfBalance });
  await success(host, 'bet:add', bet);
  const duplicate = await success(host, 'bet:add', bet);
  assert.equal(duplicate.state.you.bets.cua, halfBalance);
  await success(host, 'bet:add', mutation({ roundId, symbol: 'tom', amount: config.initialBalance - halfBalance }));
  assert.equal((await command(host, 'bet:add', mutation({ roundId, symbol: 'ca', amount: 10 }))).ok, false);
  const before = await success(host, 'room:sync');
  assert.equal(before.state.you.balance, 0);
  assert.equal((await command(host, 'room:leave')).ok, false);
  const shake = mutation({ roundId });
  await success(host, 'round:shake', shake);
  await success(host, 'round:shake', shake);
  assert.equal((await command(host, 'bet:clear', mutation({ roundId }))).ok, false);
  await waitUntil(() => host.snapshot.phase === 'result');
  assert.equal(host.snapshot.history.length, 1);
  await success(host, 'round:open', mutation({ roundNumber: 1 }));
  assert.equal((await command(host, 'bet:add', mutation({ roundId, symbol: 'cua', amount: 10 }))).ok, false);
  assert.equal((await success(host, 'room:sync')).state.you.bets.cua, 0);
});

test('late join waits, rooms stay separate, resume preserves identity and accepted bets', async t => {
  const { connect } = await setup(t);
  const host = await connect();
  const room = await success(host, 'room:create', { name: 'Chủ A' });
  const guest = await connect();
  const identity = await success(guest, 'room:join', { name: 'Khách A', code: room.state.code });
  const otherHost = await connect();
  const other = await success(otherHost, 'room:create', { name: 'Chủ B' });
  const open = await success(host, 'round:open', mutation({ roundNumber: 0 }));
  const roundId = open.state.roundId;
  await success(guest, 'bet:add', mutation({ roundId, symbol: 'bau', amount: 100 }));
  const late = await connect();
  const lateState = await success(late, 'room:join', { name: 'Vào trễ', code: room.state.code });
  assert.equal(lateState.state.you.eligible, false);
  assert.equal((await command(late, 'bet:add', mutation({ roundId, symbol: 'bau', amount: 10 }))).ok, false);
  const forged = await connect();
  assert.equal((await command(forged, 'room:resume', { token: 'fake-private-token' })).ok, false);
  const resumed = await connect();
  const restored = await success(resumed, 'room:resume', { token: identity.session.token });
  assert.equal(restored.session.playerId, identity.session.playerId);
  assert.equal(restored.state.you.bets.bau, 100);
  await waitUntil(() => !guest.connected);
  assert.equal(resumed.snapshot.players.find(player => player.id === identity.session.playerId).connected, true);
  resumed.disconnect();
  await success(host, 'round:shake', mutation({ roundId }));
  await waitUntil(() => host.snapshot.phase === 'result');
  const back = await connect();
  const after = await success(back, 'room:resume', { token: identity.session.token });
  assert.equal(after.state.you.stats.gamesPlayed, 1);
  assert.equal(after.state.you.lastResult.totalBet, 100);
  const untouched = await success(otherHost, 'room:sync');
  assert.equal(untouched.state.code, other.state.code);
  assert.equal(untouched.state.phase, 'waiting');
  assert.equal(untouched.state.history.length, 0);
  host.disconnect();
  await waitUntil(() => back.snapshot.hostId !== room.session.playerId);
  const currentHost = back.snapshot.hostId === after.session.playerId ? back : late;
  const reset = await success(currentHost, 'room:reset', mutation({ roundNumber: 1 }));
  assert.equal(reset.state.phase, 'waiting');
  assert.equal(reset.state.history.length, 0);
  assert.ok(reset.state.players.every(player => player.balance === config.initialBalance));
  assert.notEqual(reset.state.gameId, room.state.gameId);
  const stale = await command(currentHost, 'round:open', mutation({ gameId: room.state.gameId, roundNumber: 0 }));
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, 'STALE_ROUND');
});

test('HTTP API remains JSON; source and archive files are not publicly served', async t => {
  const { url } = await setup(t);
  for (const path of ['/api/config', '/api/state', '/api/health']) {
    const response = await fetch(url + path);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.ok(await response.json());
  }
  const music = await fetch(url + '/assets/audio/tet-background.mp3', { method: 'HEAD' });
  assert.equal(music.status, 200);
  assert.equal(music.headers.get('content-type'), 'audio/mpeg');
  assert.ok(Number(music.headers.get('content-length')) > 0);
  const unknown = await fetch(url + '/api/unknown');
  assert.equal(unknown.status, 404);
  assert.deepEqual(await unknown.json(), { error: 'Not found' });
  for (const path of ['/server.js', '/package.json', '/docs/archive/PROJECT_CONTEXT.md', '/.env']) {
    const response = await fetch(url + path);
    assert.equal(response.status, 404, path);
  }
});

test('20 sockets auto-settle without host actions; host commands and kick are wired over Socket.IO', async t => {
  const { connect } = await setup(t, { autoStart: true, bettingMs: 1200, resultMs: 1000 });
  const host = await connect();
  const created = await success(host, 'room:create', { name: 'Auto host' });
  const guests = await Promise.all(Array.from({ length: 19 }, () => connect()));
  const joins = await Promise.all(guests.map((socket, index) => success(socket, 'room:join', { name: `Auto ${index}`, code: created.state.code })));
  const stamp = { gameId: created.state.gameId, roundNumber: 1 };
  assert.equal((await command(guests[0], 'host:grant', mutation({ ...stamp, playerId: joins[0].session.playerId, amount: 50 }))).error.code, 'HOST_ONLY');
  await success(host, 'host:grant', mutation({ ...stamp, playerId: joins[0].session.playerId, amount: 50 }));
  await Promise.all([host, ...guests].map(socket => success(socket, 'bet:add', mutation({ roundId: created.state.roundId, symbol: 'cua', amount: 37 }))));
  await waitUntil(() => [host, ...guests].every(socket => socket.snapshot?.phase === 'result'));
  assert.equal(host.snapshot.history[0].totalBet, 20 * 37);
  assert.ok(guests.every(socket => JSON.stringify(socket.snapshot.dice) === JSON.stringify(host.snapshot.dice)));
  const kicked = new Promise(resolve => guests[0].once('room:kicked', resolve));
  await success(host, 'host:kick', mutation({ ...stamp, playerId: joins[0].session.playerId }));
  await kicked;
  assert.equal((await command(guests[0], 'room:sync')).error.code, 'NOT_IN_ROOM');
});

test('players can throw interactive items (egg, tomato, flower) to each other in the same room', async t => {
  const { connect } = await setup(t, { autoStart: false });
  const host = await connect();
  const guest = await connect();

  const created = await success(host, 'room:create', { name: 'Người Ném' });
  const joined = await success(guest, 'room:join', { name: 'Người Nhận', code: created.state.code });

  const guestReceivedPromise = new Promise(resolve => {
    guest.once('server_item_thrown', data => resolve(data));
  });
  const hostReceivedPromise = new Promise(resolve => {
    host.once('server_item_thrown', data => resolve(data));
  });

  const throwPayload = {
    fromId: created.session.playerId,
    toId: joined.session.playerId,
    itemType: 'tomato',
    startPos: { x: 100, y: 200 },
    endPos: { x: 300, y: 400 },
    roomId: created.state.code,
  };

  const ack = await new Promise(resolve => {
    host.emit('client_throw_item', throwPayload, reply => resolve(reply));
  });

  assert.equal(ack.ok, true);

  const [guestEvent, hostEvent] = await Promise.all([guestReceivedPromise, hostReceivedPromise]);
  assert.equal(guestEvent.itemType, 'tomato');
  assert.equal(guestEvent.fromId, created.session.playerId);
  assert.equal(guestEvent.toId, joined.session.playerId);
  assert.equal(guestEvent.startPos.x, 100);
  assert.equal(guestEvent.startPos.y, 200);
  assert.equal(guestEvent.endPos.x, 300);
  assert.equal(guestEvent.endPos.y, 400);
  assert.equal(guestEvent.roomId, created.state.code);

  assert.equal(hostEvent.itemType, 'tomato');
  assert.equal(hostEvent.fromId, created.session.playerId);
});


import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { GameService, calculateReturn, totalBets } from '../server/game.js';

const config = JSON.parse(await readFile(new URL('../game-config.json', import.meta.url), 'utf8'));

test('payout includes stake for 1/2/3 matches; zero matches loses only the stake', () => {
  for (let count = 0; count <= 3; count += 1) {
    const dice = Array(3).fill('bau').map((id, index) => index < count ? 'cua' : id);
    assert.equal(calculateReturn({ cua: 50 }, dice), count === 0 ? 0 : 50 * (count + 1));
  }
  assert.equal(calculateReturn({ cua: 50, tom: 100, nai: 50 }, ['cua', 'cua', 'tom']), 350);
  assert.equal(totalBets({ cua: 50, tom: 100, nai: 50 }), 200);
});

function gameFor(t, options = {}) {
  const game = new GameService(config, { autoStart: false, revealMs: 10, ...options });
  t.after(() => game.close());
  return game;
}

function ok(game, socketId, event, payload = {}) {
  const reply = game.handle(socketId, event, payload);
  assert.equal(reply.ok, true, JSON.stringify(reply.error));
  return reply;
}

test('dedupe retains accepted IDs beyond 200 edits; exhausted cache never reapplies a bet', () => {
  const game = new GameService(config, { autoStart: false });
  try {
    const created = ok(game, 'host', 'room:create', { name: 'Chủ phòng' });
    const opened = ok(game, 'host', 'round:open', { requestId: 'open', gameId: created.state.gameId, roundNumber: 0 });
    const roundId = opened.state.roundId;
    const first = { requestId: 'first', roundId, symbol: 'cua', amount: 10 };
    ok(game, 'host', 'bet:add', first);
    for (let index = 0; index < 210; index += 1) ok(game, 'host', 'bet:clear', { requestId: `clear-${index}`, roundId });
    assert.equal(ok(game, 'host', 'bet:add', first).state.you.bets.cua, 0);
    for (let index = 210; index < 998; index += 1) ok(game, 'host', 'bet:clear', { requestId: `clear-${index}`, roundId });
    const limited = game.handle('host', 'bet:add', { requestId: 'after-cap', roundId, symbol: 'cua', amount: 10 });
    assert.equal(limited.ok, false);
    assert.equal(ok(game, 'host', 'bet:add', first).state.you.bets.cua, 0);
    // An empty round can be reset, including when everybody has run out of coins.
    const reset = ok(game, 'host', 'room:reset', { requestId: 'recover', gameId: created.state.gameId, roundNumber: 1 });
    assert.equal(reset.state.phase, 'waiting');
    assert.equal(reset.state.you.balance, config.initialBalance);
  } finally { game.close(); }
});

test('reset rotates gameId so delayed open/reset cannot affect a new game', t => {
  const game = gameFor(t);
  const created = ok(game, 'host', 'room:create', { name: 'Chủ phòng' });
  const oldGameId = created.state.gameId;
  const reset = ok(game, 'host', 'room:reset', { requestId: 'reset', gameId: oldGameId, roundNumber: 0 });
  assert.notEqual(reset.state.gameId, oldGameId);
  for (const event of ['round:open', 'room:reset']) {
    const delayed = game.handle('host', event, { requestId: `delayed-${event}`, gameId: oldGameId, roundNumber: 0 });
    assert.equal(delayed.ok, false);
    assert.equal(delayed.error.code, 'STALE_ROUND');
  }
});

test('all configured symbols/chips work; clear is personal and double settle does nothing', async t => {
  const game = gameFor(t, { randomIntFn: () => 1 });
  const host = ok(game, 'host', 'room:create', { name: 'Chủ phòng' });
  ok(game, 'guest', 'room:join', { name: 'Bạn chơi', code: host.state.code });
  const open = ok(game, 'host', 'round:open', { requestId: 'open', gameId: host.state.gameId, roundNumber: 0 });
  const roundId = open.state.roundId;
  let sequence = 0;
  const extraFunds = Math.max(0, Math.max(...config.chips) - config.initialBalance);
  if (extraFunds > 0) {
    ok(game, 'host', 'host:grant', {
      requestId: 'fund-configured-chips', gameId: open.state.gameId, roundNumber: open.state.roundNumber,
      playerId: game.memberships.get('guest').playerId, amount: extraFunds,
    });
  }
  for (const symbol of config.symbols) {
    for (const amount of config.chips) {
      ok(game, 'guest', 'bet:clear', { requestId: `clear${sequence++}`, roundId });
      assert.equal(ok(game, 'guest', 'bet:add', { requestId: `add${sequence++}`, roundId, symbol: symbol.id, amount }).state.you.bets[symbol.id], amount);
    }
  }
  ok(game, 'host', 'bet:add', { requestId: 'host-bet', roundId, symbol: 'cua', amount: 50 });
  ok(game, 'guest', 'bet:clear', { requestId: 'clear-final', roundId });
  assert.equal(ok(game, 'host', 'room:sync').state.you.bets.cua, 50);
  ok(game, 'host', 'round:shake', { requestId: 'shake', roundId });
  await delay(30);
  const result = ok(game, 'host', 'room:sync').state;
  assert.equal(result.you.balance, config.initialBalance + 150);
  assert.equal(result.you.lastResult.totalReturn, 200);
  assert.equal(result.you.stats.wins, 1);
  assert.equal(ok(game, 'guest', 'room:sync').state.you.stats.gamesPlayed, 0);
  game.settle(game.rooms.get(host.state.code));
  assert.equal(ok(game, 'host', 'room:sync').state.history.length, 1);
  assert.equal(ok(game, 'host', 'room:sync').state.you.balance, config.initialBalance + 150);
});

test('disconnected empty seats expire while accepted bets remain available for settlement', t => {
  const game = gameFor(t, { disconnectTtlMs: 0 });
  const host = ok(game, 'host', 'room:create', { name: 'Chủ phòng' });
  const idle = ok(game, 'idle', 'room:join', { name: 'Không cược', code: host.state.code });
  const betting = ok(game, 'betting', 'room:join', { name: 'Có cược', code: host.state.code });
  const open = ok(game, 'host', 'round:open', { requestId: 'open', gameId: host.state.gameId, roundNumber: 0 });
  ok(game, 'betting', 'bet:add', { requestId: 'bet', roundId: open.state.roundId, symbol: 'cua', amount: 50 });
  game.disconnect('idle');
  game.disconnect('betting');
  game.cleanup();
  assert.equal(game.sessions.has(idle.session.token), false);
  assert.equal(game.sessions.has(betting.session.token), true);
  assert.equal(ok(game, 'host', 'room:sync').state.players.length, 2);
});

test('chat and emotions broadcast messages, enforce rate limit, and maintain history', async t => {
  const chatMessages = [];
  const game = gameFor(t, {
    onChatMessage: (socketId, msg) => chatMessages.push({ socketId, msg }),
  });
  const host = ok(game, 'host', 'room:create', { name: 'Chủ phòng' });
  const guest = ok(game, 'guest', 'room:join', { name: 'Bạn chơi', code: host.state.code });

  // Host sends text message
  const chat1 = ok(game, 'host', 'chat:send', { text: 'Chào mừng anh em vào phòng!' });
  assert.equal(chat1.message.text, 'Chào mừng anh em vào phòng!');
  assert.equal(chat1.message.senderName, 'Chủ phòng');
  assert.equal(chat1.message.isHost, true);
  assert.equal(chat1.message.type, 'text');

  // Both sockets received the chat
  assert.equal(chatMessages.length, 2);
  assert.equal(chatMessages[0].msg.text, 'Chào mừng anh em vào phòng!');

  // Guest sends an emotion
  await delay(260); // Respect 250ms rate limit
  const chat2 = ok(game, 'guest', 'chat:send', { emotion: '🦀' });
  assert.equal(chat2.message.emotion, '🦀');
  assert.equal(chat2.message.type, 'emotion');
  assert.equal(chat2.message.senderName, 'Bạn chơi');
  assert.equal(chat2.message.isHost, false);

  // Rate limit check: rapid send fails
  const rapid = game.handle('guest', 'chat:send', { text: 'Spam tin nhắn' });
  assert.equal(rapid.ok, false);
  assert.equal(rapid.error.code, 'CHAT_RATE_LIMIT');

  // Empty chat fails
  await delay(260);
  const empty = game.handle('guest', 'chat:send', { text: '   ' });
  assert.equal(empty.ok, false);
  assert.equal(empty.error.code, 'INVALID_CHAT');

  // Room snapshot retains history
  const sync = ok(game, 'host', 'room:sync');
  assert.equal(sync.state.messages.length, 2);
  assert.equal(sync.state.messages[0].text, 'Chào mừng anh em vào phòng!');
  assert.equal(sync.state.messages[1].emotion, '🦀');
});


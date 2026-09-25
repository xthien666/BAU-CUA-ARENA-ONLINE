import { test, describe } from 'node:test';
import assert from 'node:assert';
import { UserRepository } from '../../src/repositories/UserRepository.js';
import { SessionRepository } from '../../src/repositories/SessionRepository.js';
import { RoomRepository } from '../../src/repositories/RoomRepository.js';
import { BetRepository } from '../../src/repositories/BetRepository.js';

describe('Complete Repositories Integration Suite', () => {
  const userRepo = new UserRepository();
  const sessionRepo = new SessionRepository();
  const roomRepo = new RoomRepository();
  const betRepo = new BetRepository();

  let hostUser = null;
  let playerUser = null;
  let room = null;
  let round = null;

  test('Should setup users and sessions', async () => {
    hostUser = await userRepo.createUser({
      username: 'host_' + Date.now(),
      email: `host_${Date.now()}@example.com`,
      passwordHash: 'dummy_hash',
      displayName: 'Host Player',
    });
    playerUser = await userRepo.createUser({
      username: 'player_' + Date.now(),
      email: `player_${Date.now()}@example.com`,
      passwordHash: 'dummy_hash',
      displayName: 'Regular Player',
    });

    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000);
    const session = await sessionRepo.createSession(
      playerUser.id,
      'token_hash_' + Date.now(),
      '127.0.0.1',
      'Mozilla/5.0',
      expiresAt
    );
    assert.ok(session.id);
  });

  test('Should create room and manage members', async () => {
    const roomCode = 'R' + Math.floor(1000 + Math.random() * 9000);
    room = await roomRepo.createRoom({
      code: roomCode,
      name: 'Phòng Thử Nghiệm',
      hostId: hostUser.id,
    });
    assert.ok(room.id);
    assert.strictEqual(room.code, roomCode);

    // Player joins room
    await roomRepo.addMember(room.id, playerUser.id, 'player');
    const members = await roomRepo.getRoomMembers(room.id);
    assert.strictEqual(members.length, 2);
  });

  test('Should handle rounds and place bets with deduplication', async () => {
    round = await betRepo.createRound(room.id, 1);
    assert.ok(round.id);
    assert.strictEqual(round.status, 'betting');

    const reqId = 'req_' + Date.now();
    const bet = await betRepo.placeBet({
      roundId: round.id,
      userId: playerUser.id,
      symbol: 'cua',
      amount: 10000,
      requestId: reqId,
    });
    assert.ok(bet.id);
    assert.strictEqual(bet.symbol, 'cua');

    // Duplicate bet attempt should be ignored
    const duplicateBet = await betRepo.placeBet({
      roundId: round.id,
      userId: playerUser.id,
      symbol: 'cua',
      amount: 10000,
      requestId: reqId,
    });
    assert.strictEqual(duplicateBet, null);
  });

  test('Should settle round result', async () => {
    const settledRound = await betRepo.updateRoundResult(round.id, ['cua', 'tom', 'cua']);
    assert.strictEqual(settledRound.status, 'settled');
    assert.deepStrictEqual(settledRound.dice, ['cua', 'tom', 'cua']);
  });
});

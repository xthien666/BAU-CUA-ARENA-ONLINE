import { test, describe } from 'node:test';
import assert from 'node:assert';
import { UserRepository } from '../../src/repositories/UserRepository.js';
import { RoomRepository } from '../../src/repositories/RoomRepository.js';
import { BetRepository } from '../../src/repositories/BetRepository.js';
import { HistoryRepository } from '../../src/repositories/HistoryRepository.js';
import { StatisticsRepository } from '../../src/repositories/StatisticsRepository.js';
import { ProcessedCommandRepository } from '../../src/repositories/ProcessedCommandRepository.js';

describe('A5 & A7: History, Statistics & Processed Commands Test Suite', () => {
  const userRepo = new UserRepository();
  const roomRepo = new RoomRepository();
  const betRepo = new BetRepository();
  const historyRepo = new HistoryRepository();
  const cmdRepo = new ProcessedCommandRepository();

  let user = null;
  let room = null;
  let round = null;

  test('Should record and query processed commands with idempotency', async () => {
    user = await userRepo.createUser({
      username: 'stats_user_' + Date.now(),
      email: `stats_${Date.now()}@example.com`,
      passwordHash: 'hash',
      displayName: 'Stats Player',
    });

    const cmdKey = `cmd_bet_${Date.now()}`;
    const first = await cmdRepo.recordCommand({
      commandKey: cmdKey,
      userId: user.id,
      commandType: 'bet:add',
      resultPayload: { success: true },
    });
    assert.strictEqual(first.isDuplicate, false);

    // Duplicate call
    const second = await cmdRepo.recordCommand({
      commandKey: cmdKey,
      userId: user.id,
      commandType: 'bet:add',
      resultPayload: { success: true },
    });
    assert.strictEqual(second.isDuplicate, true);
  });

  test('Should record player round result and retrieve history with pagination', async () => {
    room = await roomRepo.createRoom({
      code: 'S' + Math.floor(1000 + Math.random() * 9000),
      name: 'Thống kê phòng',
      hostId: user.id,
    });
    round = await betRepo.createRound(room.id, 1);
    await betRepo.updateRoundResult(round.id, ['cua', 'bau', 'cua']);

    await historyRepo.recordPlayerRoundResult({
      roundId: round.id,
      userId: user.id,
      roomId: room.id,
      totalBet: 30000,
      totalReturn: 60000,
      outcome: 'win',
    });

    const history = await historyRepo.getUserRoundHistory(user.id, 10, 0);
    assert.strictEqual(history.length, 1);
    assert.strictEqual(history[0].outcome, 'win');
    assert.strictEqual(parseInt(history[0].total_bet, 10), 30000);
    assert.strictEqual(parseInt(history[0].total_return, 10), 60000);
    assert.strictEqual(parseInt(history[0].net_gain, 10), 30000);
  });

  test('Should calculate user statistics and symbol statistics from completed rounds', async () => {
    const stats = await StatisticsRepository.getUserStatistics(user.id);
    assert.strictEqual(stats.gamesPlayed, 1);
    assert.strictEqual(stats.wins, 1);
    assert.strictEqual(stats.losses, 0);
    assert.strictEqual(stats.totalBet, 30000);
    assert.strictEqual(stats.totalReturned, 60000);
    assert.strictEqual(stats.netProfit, 30000);

    const symbolStats = await StatisticsRepository.getSymbolStatistics(room.id);
    assert.strictEqual(symbolStats.cua, 2);
    assert.strictEqual(symbolStats.bau, 1);
    assert.strictEqual(symbolStats.tom, 0);
  });
});

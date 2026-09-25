import { test, describe } from 'node:test';
import assert from 'node:assert';
import { UserRepository } from '../../src/repositories/UserRepository.js';
import { WalletService, TRANSACTION_TYPES } from '../../src/services/WalletService.js';

describe('WalletService Test Suite (Ledger & Idempotency)', () => {
  const userRepo = new UserRepository();
  let testUser = null;

  test('Should create wallet with welcome grant exactly once', async () => {
    testUser = await userRepo.createUser({
      username: 'service_user_' + Date.now(),
      email: `svc_${Date.now()}@example.com`,
      passwordHash: 'hash',
      displayName: 'Service Test User',
    });

    const wallet = await WalletService.createWalletWithWelcomeGrant(testUser.id, 100000);
    assert.ok(wallet);
    assert.strictEqual(parseInt(wallet.balance, 10), 100000);

    // Call welcome grant second time -> Should not add another 100k
    const wallet2 = await WalletService.createWalletWithWelcomeGrant(testUser.id, 100000);
    assert.strictEqual(parseInt(wallet2.balance, 10), 100000);
  });

  test('Should debit bet and prevent double debit with same idempotency key', async () => {
    const roundId = '00000000-0000-0000-0000-000000000001';
    const requestId = 'req_debit_1';

    // First attempt -> balance goes 100k -> 80k
    const res1 = await WalletService.debitBet({
      userId: testUser.id,
      amount: 20000,
      roundId,
      requestId,
    });
    assert.strictEqual(res1.isDuplicate, false);
    assert.strictEqual(parseInt(res1.wallet.balance, 10), 80000);

    // Retry same request -> balance remains 80k (idempotency response)
    const res2 = await WalletService.debitBet({
      userId: testUser.id,
      amount: 20000,
      roundId,
      requestId,
    });
    assert.strictEqual(res2.isDuplicate, true);
    assert.strictEqual(parseInt(res2.wallet.balance, 10), 80000);
  });

  test('Should refund bet correctly', async () => {
    const roundId = '00000000-0000-0000-0000-000000000001';
    const requestId = 'req_debit_1';

    const res = await WalletService.refundBet({
      userId: testUser.id,
      amount: 20000,
      roundId,
      requestId,
    });
    assert.strictEqual(parseInt(res.wallet.balance, 10), 100000);
  });

  test('Should process round payout correctly', async () => {
    const roundId = '00000000-0000-0000-0000-000000000002';
    const res = await WalletService.payoutRound({
      userId: testUser.id,
      amount: 50000,
      roundId,
    });
    assert.strictEqual(parseInt(res.wallet.balance, 10), 150000);
    assert.strictEqual(res.transaction.transaction_type, TRANSACTION_TYPES.ROUND_PAYOUT);
  });
});

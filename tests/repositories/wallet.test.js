import { test, describe } from 'node:test';
import assert from 'node:assert';
import { UserRepository } from '../../src/repositories/UserRepository.js';
import { WalletRepository } from '../../src/repositories/WalletRepository.js';

describe('WalletRepository Test Suite', () => {
  const userRepo = new UserRepository();
  const walletRepo = new WalletRepository();
  let testUserId = null;
  let testWallet = null;

  test('Should create wallet for new user', async () => {
    const user = await userRepo.createUser({
      username: 'wallet_user_' + Date.now(),
      email: `wallet_${Date.now()}@example.com`,
      passwordHash: 'dummy_hash',
      displayName: 'Wallet User',
    });
    testUserId = user.id;

    testWallet = await walletRepo.createWallet(testUserId, 50000);
    assert.ok(testWallet.id);
    assert.strictEqual(parseInt(testWallet.balance, 10), 50000);
    assert.strictEqual(testWallet.version, 1);
  });

  test('Should deduct balance atomically', async () => {
    const updated = await walletRepo.deductBalance(testUserId, 10000, 'bet_placed', 'Test bet');
    assert.strictEqual(parseInt(updated.balance, 10), 40000);
    assert.strictEqual(updated.version, 2);
  });

  test('Should add balance atomically', async () => {
    const updated = await walletRepo.addBalance(testUserId, 25000, 'bet_won', 'Test win');
    assert.strictEqual(parseInt(updated.balance, 10), 65000);
    assert.strictEqual(updated.version, 3);
  });

  test('Should fail to deduct more than current balance', async () => {
    await assert.rejects(async () => {
      await walletRepo.deductBalance(testUserId, 1000000, 'bet_placed', 'Too high bet');
    }, /Insufficient virtual coins/);
  });

  test('Should retrieve transaction history', async () => {
    const history = await walletRepo.getTransactionHistory(testWallet.id);
    assert.ok(Array.isArray(history));
    assert.strictEqual(history.length >= 2, true);
  });
});

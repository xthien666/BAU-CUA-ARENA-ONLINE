import { getClient } from '../db/connection.js';

export const TRANSACTION_TYPES = {
  WELCOME: 'WELCOME',
  BET_DEBIT: 'BET_DEBIT',
  BET_REFUND: 'BET_REFUND',
  ROUND_PAYOUT: 'ROUND_PAYOUT',
  ADMIN_GRANT: 'ADMIN_GRANT',
  AD_REWARD: 'AD_REWARD',
};

export class WalletService {
  /**
   * Tạo ví + welcome grant đúng 100,000 xu ảo (WELCOME) duy nhất 1 lần.
   * Chống lặp hoàn toàn qua idempotency_key = `welcome:{user_id}`.
   */
  static async createWalletWithWelcomeGrant(userId, initialBalance = 100000, clientOverride = null) {
    const client = clientOverride || (await getClient());
    const shouldRelease = !clientOverride;
    try {
      if (shouldRelease) await client.query('BEGIN');

      // 1. Check or create wallet
      let walletRes = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]);
      let wallet = walletRes.rows[0];

      if (!wallet) {
        const createRes = await client.query(
          'INSERT INTO wallets (user_id, balance, version) VALUES ($1, $2, 1) RETURNING *',
          [userId, initialBalance]
        );
        wallet = createRes.rows[0];
      }

      // 2. Ghi ledger WELCOME với idempotency key
      const idempotencyKey = `welcome:${userId}`;
      const existingTxn = await client.query(
        'SELECT * FROM wallet_transactions WHERE user_id = $1 AND idempotency_key = $2',
        [userId, idempotencyKey]
      );

      if (existingTxn.rows.length === 0) {
        await client.query(
          `INSERT INTO wallet_transactions 
            (wallet_id, user_id, type, transaction_type, amount, balance_before, balance_after, reason, idempotency_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            wallet.id,
            userId,
            'initial_grant',
            TRANSACTION_TYPES.WELCOME,
            initialBalance,
            0,
            initialBalance,
            'Welcome initial virtual coins grant',
            idempotencyKey,
          ]
        );
      }

      if (shouldRelease) await client.query('COMMIT');
      return wallet;
    } catch (error) {
      if (shouldRelease) await client.query('ROLLBACK');
      throw error;
    } finally {
      if (shouldRelease) client.release();
    }
  }

  /**
   * Trừ xu ảo cược (BET_DEBIT) có idempotency protection
   */
  static async debitBet({ userId, amount, roomId, roundId, requestId, reason = 'Bet placed' }, clientOverride = null) {
    return WalletService._executeTransaction({
      userId,
      amount: -Math.abs(amount),
      transactionType: TRANSACTION_TYPES.BET_DEBIT,
      roomId,
      roundId,
      idempotencyKey: `bet_debit:${roundId}:${userId}:${requestId}`,
      reason,
      allowNegative: false,
      clientOverride,
    });
  }

  /**
   * Hoàn xu cược khi ván bị huỷ (BET_REFUND)
   */
  static async refundBet({ userId, amount, roomId, roundId, requestId, reason = 'Round cancelled refund' }, clientOverride = null) {
    return WalletService._executeTransaction({
      userId,
      amount: Math.abs(amount),
      transactionType: TRANSACTION_TYPES.BET_REFUND,
      roomId,
      roundId,
      idempotencyKey: `bet_refund:${roundId}:${userId}:${requestId}`,
      reason,
      allowNegative: true,
      clientOverride,
    });
  }

  /**
   * Trả thưởng ván chơi (ROUND_PAYOUT)
   */
  static async payoutRound({ userId, amount, roomId, roundId, reason = 'Round payout' }, clientOverride = null) {
    return WalletService._executeTransaction({
      userId,
      amount: Math.abs(amount),
      transactionType: TRANSACTION_TYPES.ROUND_PAYOUT,
      roomId,
      roundId,
      idempotencyKey: `round_payout:${roundId}:${userId}`,
      reason,
      allowNegative: true,
      clientOverride,
    });
  }

  /**
   * Admin cấp xu ảo (ADMIN_GRANT)
   */
  static async adminGrant({ userId, amount, actorId, reason = 'Admin grant' }, clientOverride = null) {
    return WalletService._executeTransaction({
      userId,
      amount: BigInt(amount),
      transactionType: TRANSACTION_TYPES.ADMIN_GRANT,
      actorId,
      idempotencyKey: `admin_grant:${userId}:${Date.now()}:${Math.random()}`,
      reason,
      allowNegative: true,
      clientOverride,
    });
  }

  /**
   * Hàm lõi xử lý mọi giao dịch wallet + ledger + idempotency trong 1 DB transaction duy nhất.
   * Đã gọi lại với cùng idempotencyKey => Trả về kết quả giao dịch cũ, KHÔNG thực hiện giao dịch thứ hai.
   */
  static async _executeTransaction({
    userId,
    amount, // BigInt hoặc integer/string (+ hoặc -)
    transactionType,
    actorId = null,
    roomId = null,
    roundId = null,
    rewardSessionId = null,
    idempotencyKey = null,
    reason = null,
    metadata = null,
    allowNegative = false,
    clientOverride = null,
  }) {
    const client = clientOverride || (await getClient());
    const shouldRelease = !clientOverride;

    try {
      if (shouldRelease) await client.query('BEGIN');

      // 1. Kiểm tra idempotency key trước khi làm bất cứ thao tác nào
      if (idempotencyKey) {
        const existing = await client.query(
          'SELECT * FROM wallet_transactions WHERE user_id = $1 AND idempotency_key = $2',
          [userId, idempotencyKey]
        );
        if (existing.rows.length > 0) {
          // Giao dịch này đã thực hiện thành công trước đó => Idempotency return
          const walletRes = await client.query('SELECT * FROM wallets WHERE user_id = $1', [userId]);
          if (shouldRelease) await client.query('COMMIT');
          return {
            wallet: walletRes.rows[0],
            transaction: existing.rows[0],
            isDuplicate: true,
          };
        }
      }

      // 2. Row-lock wallet của user
      const walletRes = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]);
      const wallet = walletRes.rows[0];

      if (!wallet) {
        throw new Error(`Wallet not found for user: ${userId}`);
      }

      const delta = BigInt(amount);
      const balanceBefore = BigInt(wallet.balance);
      const balanceAfter = balanceBefore + delta;

      if (!allowNegative && balanceAfter < 0n) {
        throw new Error(`Insufficient virtual coins balance: ${balanceBefore} < ${Math.abs(Number(delta))}`);
      }

      const newVersion = wallet.version + 1;

      // 3. Update wallet
      const updateRes = await client.query(
        `UPDATE wallets
         SET balance = $1, version = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3 AND version = $4
         RETURNING *`,
        [balanceAfter.toString(), newVersion, wallet.id, wallet.version]
      );

      if (updateRes.rowCount === 0) {
        throw new Error('Concurrency conflict: wallet version mismatch');
      }

      // 4. Insert ledger record
      const txnRes = await client.query(
        `INSERT INTO wallet_transactions
          (wallet_id, user_id, type, transaction_type, amount, balance_before, balance_after,
           actor_id, room_id, round_id, reward_session_id, idempotency_key, reason, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING *`,
        [
          wallet.id,
          userId,
          transactionType.toLowerCase(),
          transactionType,
          delta.toString(),
          balanceBefore.toString(),
          balanceAfter.toString(),
          actorId,
          roomId,
          roundId,
          rewardSessionId,
          idempotencyKey,
          reason,
          metadata ? JSON.stringify(metadata) : null,
        ]
      );

      if (shouldRelease) await client.query('COMMIT');

      return {
        wallet: updateRes.rows[0],
        transaction: txnRes.rows[0],
        isDuplicate: false,
      };
    } catch (error) {
      if (shouldRelease) await client.query('ROLLBACK');
      throw error;
    } finally {
      if (shouldRelease) client.release();
    }
  }
}

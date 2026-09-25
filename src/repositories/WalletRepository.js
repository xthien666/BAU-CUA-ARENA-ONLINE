import { Repository } from '../db/Repository.js';
import { query, getClient } from '../db/connection.js';

export class WalletRepository extends Repository {
  constructor() {
    super('wallets');
  }

  async findByUserId(userId) {
    const res = await query(`SELECT * FROM wallets WHERE user_id = $1`, [userId]);
    return res.rows[0] || null;
  }

  async createWallet(userId, initialBalance = 100000) {
    const res = await query(
      `INSERT INTO wallets (user_id, balance, version) VALUES ($1, $2, 1) RETURNING *`,
      [userId, initialBalance]
    );
    return res.rows[0];
  }

  // Deduct balance with optimistic locking and transaction support (for virtual coins)
  async deductBalance(userId, amount, type = 'bet_placed', reason = null, referenceId = null) {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Get current wallet with row lock
      const walletRes = await client.query(`SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE`, [userId]);
      const wallet = walletRes.rows[0];

      if (!wallet) {
        throw new Error('Wallet not found');
      }

      const currentBalance = BigInt(wallet.balance);
      const deductAmount = BigInt(amount);

      if (currentBalance < deductAmount) {
        throw new Error('Insufficient virtual coins');
      }

      const newBalance = (currentBalance - deductAmount).toString();
      const newVersion = wallet.version + 1;

      // Update wallet balance
      const updateRes = await client.query(
        `UPDATE wallets SET balance = $1, version = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 AND version = $4 RETURNING *`,
        [newBalance, newVersion, wallet.id, wallet.version]
      );

      if (updateRes.rowCount === 0) {
        throw new Error('Concurrency conflict: wallet was updated concurrently');
      }

      // Record transaction
      await client.query(
        `INSERT INTO wallet_transactions (wallet_id, user_id, amount, type, transaction_type, reason, reference_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [wallet.id, userId, (-deductAmount).toString(), type, 'BET_DEBIT', reason, referenceId]
      );

      await client.query('COMMIT');
      return updateRes.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Add balance with transaction support (e.g. winning bet, ad reward, admin grant)
  async addBalance(userId, amount, type = 'bet_won', reason = null, referenceId = null) {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const walletRes = await client.query(`SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE`, [userId]);
      const wallet = walletRes.rows[0];

      if (!wallet) {
        throw new Error('Wallet not found');
      }

      const currentBalance = BigInt(wallet.balance);
      const addAmount = BigInt(amount);

      const newBalance = (currentBalance + addAmount).toString();
      const newVersion = wallet.version + 1;

      const updateRes = await client.query(
        `UPDATE wallets SET balance = $1, version = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 AND version = $4 RETURNING *`,
        [newBalance, newVersion, wallet.id, wallet.version]
      );

      if (updateRes.rowCount === 0) {
        throw new Error('Concurrency conflict: wallet was updated concurrently');
      }

      await client.query(
        `INSERT INTO wallet_transactions (wallet_id, user_id, amount, type, transaction_type, reason, reference_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [wallet.id, userId, addAmount.toString(), type, 'ROUND_PAYOUT', reason, referenceId]
      );

      await client.query('COMMIT');
      return updateRes.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getTransactionHistory(walletId, limit = 20, offset = 0) {
    const res = await query(
      `SELECT * FROM wallet_transactions WHERE wallet_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [walletId, limit, offset]
    );
    return res.rows;
  }
}

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { pool, checkConnection, query } from '../../src/db/connection.js';

describe('Database Connection & Schema Test Suite', () => {
  test('Should connect to PostgreSQL successfully', async () => {
    const status = await checkConnection();
    assert.strictEqual(status.ok, true, `Database connection failed: ${status.error}`);
    assert.strictEqual(typeof status.database, 'string');
  });

  test('Should query all 11 tables from schema', async () => {
    const expectedTables = [
      'users',
      'wallets',
      'wallet_transactions',
      'auth_sessions',
      'account_tokens',
      'rooms',
      'room_members',
      'rounds',
      'bets',
      'ad_reward_sessions',
      'admin_audit_logs'
    ];

    for (const tableName of expectedTables) {
      const res = await query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
        [tableName]
      );
      assert.strictEqual(res.rowCount, 1, `Table ${tableName} should exist in database`);
    }
  });

  test('Should support basic transaction and rollback', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query('SELECT 1 + 1 AS result');
      assert.strictEqual(res.rows[0].result, 2);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});

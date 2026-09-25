import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root
dotenv.config({ path: resolve(__dirname, '../../.env') });

const { Pool } = pg;

// Hỗ trợ cả DATABASE_URL (production) lẫn biến riêng lẻ (local dev)
function buildConfig() {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }

  const isTest = process.env.NODE_ENV === 'test';
  const database = isTest
    ? process.env.DB_NAME_TEST || 'bau_cua_test'
    : process.env.DB_NAME_DEV || 'bau_cua_dev';

  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database,
  };
}

export const pool = new Pool({
  ...buildConfig(),
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[DB Pool Error]: Unexpected error on idle client', err);
});

export async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.DEBUG_SQL === 'true') {
    console.log('[Executed Query]', { text, duration, rows: res.rowCount });
  }
  return res;
}

export async function getClient() {
  const client = await pool.connect();
  return client;
}

export async function checkConnection() {
  try {
    const res = await pool.query('SELECT NOW() as now, current_database() as db');
    return { ok: true, now: res.rows[0].now, database: res.rows[0].db };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export async function closePool() {
  await pool.end();
}

#!/usr/bin/env node
// Migration runner cho Bầu Cua Arena.
// Một lệnh: `npm run db:migrate` — chạy toàn bộ file .sql trong /migrations theo thứ tự tên.
// Mỗi migration chạy trong một transaction riêng và được ghi vào bảng schema_migrations.
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { pool, closePool } from '../src/db/connection.js';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function appliedMigrations(client) {
  const res = await client.query('SELECT filename, checksum FROM schema_migrations ORDER BY filename');
  return new Map(res.rows.map(row => [row.filename, row.checksum]));
}

async function main() {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const applied = await appliedMigrations(client);

    const files = (await readdir(migrationsDir))
      .filter(name => name.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b, 'en'));

    if (files.length === 0) {
      console.log('Không tìm thấy migration nào trong', migrationsDir);
      return;
    }

    let count = 0;
    for (const filename of files) {
      const sql = await readFile(join(migrationsDir, filename), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = applied.get(filename);

      if (previous) {
        if (previous !== checksum) {
          console.warn(`⚠  ${filename} đã chạy nhưng nội dung đã thay đổi so với bản ghi trong schema_migrations.`);
        }
        continue;
      }

      console.log(`→ Đang áp dụng ${filename}`);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [filename, checksum]);
        await client.query('COMMIT');
        count += 1;
      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`✗ ${filename} thất bại: ${error.message}`);
        process.exitCode = 1;
        return;
      }
    }

    console.log(count === 0 ? '✓ Database đã ở phiên bản mới nhất.' : `✓ Đã áp dụng ${count} migration.`);
  } finally {
    client.release();
    await closePool();
  }
}

await main();

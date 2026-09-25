import { test, describe } from 'node:test';
import assert from 'node:assert';
import { AuditLogger } from '../../src/db/AuditLogger.js';
import { UserRepository } from '../../src/repositories/UserRepository.js';

describe('AuditLogger Test Suite', () => {
  const userRepo = new UserRepository();
  let adminUser = null;
  let targetUser = null;

  test('Should log admin action successfully', async () => {
    adminUser = await userRepo.createUser({
      username: 'admin_' + Date.now(),
      email: `admin_${Date.now()}@example.com`,
      passwordHash: 'dummy_hash',
      displayName: 'System Admin',
      role: 'admin',
    });

    targetUser = await userRepo.createUser({
      username: 'target_' + Date.now(),
      email: `target_${Date.now()}@example.com`,
      passwordHash: 'dummy_hash',
      displayName: 'Target Player',
      role: 'player',
    });

    const log = await AuditLogger.logAdminAction({
      adminId: adminUser.id,
      action: 'grant_coins',
      targetType: 'user',
      targetId: targetUser.id,
      reason: 'Sự kiện chào mừng người chơi mới',
      changes: { coinsAdded: 50000 },
      ipAddress: '192.168.1.1',
    });

    assert.ok(log);
    assert.strictEqual(log.action, 'grant_coins');
    assert.strictEqual(log.target_id, targetUser.id);
  });

  test('Should query audit logs with pagination and filter', async () => {
    const logs = await AuditLogger.getLogs({
      adminId: adminUser.id,
      action: 'grant_coins',
      limit: 10,
    });

    assert.ok(Array.isArray(logs));
    assert.strictEqual(logs.length >= 1, true);
    assert.strictEqual(logs[0].admin_username, adminUser.username);
  });
});

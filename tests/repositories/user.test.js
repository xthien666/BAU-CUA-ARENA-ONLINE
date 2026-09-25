import { test, describe } from 'node:test';
import assert from 'node:assert';
import { UserRepository } from '../../src/repositories/UserRepository.js';
import { query } from '../../src/db/connection.js';

describe('UserRepository Test Suite', () => {
  const userRepo = new UserRepository();
  const testUser = {
    username: 'test_player_' + Date.now(),
    email: `player_${Date.now()}@example.com`,
    passwordHash: 'dummy_hash_for_testing',
    displayName: 'Test Player',
  };
  let createdUserId = null;

  test('Should create a new user successfully', async () => {
    const user = await userRepo.createUser(testUser);
    assert.ok(user.id);
    assert.strictEqual(user.username, testUser.username);
    assert.strictEqual(user.email, testUser.email);
    assert.strictEqual(user.display_name, testUser.displayName);
    assert.strictEqual(user.role, 'player');
    assert.strictEqual(user.status, 'active');
    createdUserId = user.id;
  });

  test('Should find user by username (case-insensitive)', async () => {
    const user = await userRepo.findByUsername(testUser.username.toUpperCase());
    assert.ok(user);
    assert.strictEqual(user.id, createdUserId);
  });

  test('Should find user by email (case-insensitive)', async () => {
    const user = await userRepo.findByEmail(testUser.email.toUpperCase());
    assert.ok(user);
    assert.strictEqual(user.id, createdUserId);
  });

  test('Should update user profile', async () => {
    const updated = await userRepo.updateProfile(createdUserId, {
      displayName: 'Updated Player Name',
      avatarKey: 'avatar_dragon',
    });
    assert.strictEqual(updated.display_name, 'Updated Player Name');
    assert.strictEqual(updated.avatar_key, 'avatar_dragon');
  });

  test('Should update user status (e.g. ban)', async () => {
    const updated = await userRepo.updateStatus(createdUserId, 'banned');
    assert.strictEqual(updated.status, 'banned');
  });
});

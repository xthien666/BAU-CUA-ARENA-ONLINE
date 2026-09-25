import { Repository } from '../db/Repository.js';
import { query } from '../db/connection.js';

export class SessionRepository extends Repository {
  constructor() {
    super('auth_sessions');
  }

  async createSession(userId, tokenHash, ipAddress, userAgent, expiresAt) {
    const res = await query(
      `INSERT INTO auth_sessions (user_id, token_hash, ip_address, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, tokenHash, ipAddress, userAgent, expiresAt]
    );
    return res.rows[0];
  }

  async findByTokenHash(tokenHash) {
    const res = await query(
      `SELECT s.*, u.username, u.display_name, u.role, u.status
       FROM auth_sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.token_hash = $1 AND s.expires_at > CURRENT_TIMESTAMP`,
      [tokenHash]
    );
    return res.rows[0] || null;
  }

  async revokeSession(tokenHash) {
    const res = await query(`DELETE FROM auth_sessions WHERE token_hash = $1 RETURNING *`, [tokenHash]);
    return res.rows[0] || null;
  }

  async revokeAllUserSessions(userId) {
    const res = await query(`DELETE FROM auth_sessions WHERE user_id = $1 RETURNING *`, [userId]);
    return res.rows;
  }

  async cleanupExpiredSessions() {
    const res = await query(`DELETE FROM auth_sessions WHERE expires_at <= CURRENT_TIMESTAMP RETURNING *`);
    return res.rowCount;
  }
}

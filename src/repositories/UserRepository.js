import { Repository } from '../db/Repository.js';
import { query } from '../db/connection.js';

export class UserRepository extends Repository {
  constructor() {
    super('users');
  }

  async findByUsername(username) {
    const res = await query(`SELECT * FROM users WHERE LOWER(username) = LOWER($1)`, [username]);
    return res.rows[0] || null;
  }

  async findByEmail(email) {
    const res = await query(`SELECT * FROM users WHERE LOWER(email) = LOWER($1)`, [email]);
    return res.rows[0] || null;
  }

  async createUser({ username, email, passwordHash, displayName, avatarKey = 'avatar_default', role = 'player' }) {
    const res = await query(
      `INSERT INTO users (username, email, password_hash, display_name, avatar_key, role)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [username, email.toLowerCase(), passwordHash, displayName, avatarKey, role]
    );
    return res.rows[0];
  }

  async updateProfile(id, { displayName, avatarKey }) {
    const res = await query(
      `UPDATE users
       SET display_name = COALESCE($2, display_name),
           avatar_key = COALESCE($3, avatar_key),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [id, displayName, avatarKey]
    );
    return res.rows[0] || null;
  }

  async updateStatus(id, status) {
    const res = await query(
      `UPDATE users
       SET status = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [id, status]
    );
    return res.rows[0] || null;
  }
}

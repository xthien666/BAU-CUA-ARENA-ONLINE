import { Repository } from '../db/Repository.js';
import { query, getClient } from '../db/connection.js';

export class BetRepository extends Repository {
  constructor() {
    super('bets');
  }

  async createRound(roomId, roundNumber) {
    const res = await query(
      `INSERT INTO rounds (room_id, round_number, status) VALUES ($1, $2, 'betting') RETURNING *`,
      [roomId, roundNumber]
    );
    return res.rows[0];
  }

  async getCurrentRound(roomId) {
    const res = await query(
      `SELECT * FROM rounds WHERE room_id = $1 ORDER BY round_number DESC LIMIT 1`,
      [roomId]
    );
    return res.rows[0] || null;
  }

  // Place bet with duplicate prevention via requestId
  async placeBet({ roundId, userId, symbol, amount, requestId }) {
    const res = await query(
      `INSERT INTO bets (round_id, user_id, symbol, amount, request_id, status)
       VALUES ($1, $2, $3, $4, $5, 'placed')
       ON CONFLICT (round_id, user_id, symbol, request_id) DO NOTHING
       RETURNING *`,
      [roundId, userId, symbol, amount, requestId]
    );
    return res.rows[0] || null;
  }

  async getRoundBets(roundId) {
    const res = await query(`SELECT * FROM bets WHERE round_id = $1`, [roundId]);
    return res.rows;
  }

  async updateRoundResult(roundId, dice, status = 'settled') {
    const res = await query(
      `UPDATE rounds SET dice = $1, status = $2, settled_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *`,
      [JSON.stringify(dice), status, roundId]
    );
    return res.rows[0];
  }
}

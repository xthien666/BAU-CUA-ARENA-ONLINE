import { Repository } from '../db/Repository.js';
import { query } from '../db/connection.js';

export class HistoryRepository extends Repository {
  constructor() {
    super('player_round_results');
  }

  /**
   * Lưu kết quả tổng kết của 1 người chơi trong 1 round
   */
  async recordPlayerRoundResult({ roundId, userId, roomId, totalBet, totalReturn, outcome }, clientOverride = null) {
    const q = clientOverride ? clientOverride.query.bind(clientOverride) : query;
    const netGain = BigInt(totalReturn) - BigInt(totalBet);

    const res = await q(
      `INSERT INTO player_round_results (round_id, user_id, room_id, total_bet, total_return, net_gain, outcome)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (round_id, user_id) DO UPDATE
       SET total_bet = EXCLUDED.total_bet,
           total_return = EXCLUDED.total_return,
           net_gain = EXCLUDED.net_gain,
           outcome = EXCLUDED.outcome,
           settled_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [roundId, userId, roomId, totalBet.toString(), totalReturn.toString(), netGain.toString(), outcome]
    );
    return res.rows[0];
  }

  /**
   * Lấy lịch sử ván chơi cá nhân với phân trang và ORDER BY settled_at DESC (theo spec A7)
   */
  async getUserRoundHistory(userId, limit = 20, offset = 0) {
    const res = await query(
      `SELECT prr.*, r.round_number, r.dice, rm.name as room_name, rm.code as room_code
       FROM player_round_results prr
       JOIN rounds r ON prr.round_id = r.id
       JOIN rooms rm ON prr.room_id = rm.id
       WHERE prr.user_id = $1
       ORDER BY prr.settled_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return res.rows;
  }
}

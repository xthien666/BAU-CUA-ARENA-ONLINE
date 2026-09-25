import { query } from '../db/connection.js';

export class StatisticsRepository {
  /**
   * Tính toán thống kê người chơi: games_played, wins, losses, break_even, total_bet, total_returned
   */
  static async getUserStatistics(userId) {
    const res = await query(
      `SELECT
        COUNT(*)::INT AS games_played,
        COUNT(CASE WHEN outcome = 'win' THEN 1 END)::INT AS wins,
        COUNT(CASE WHEN outcome = 'loss' THEN 1 END)::INT AS losses,
        COUNT(CASE WHEN outcome = 'draw' THEN 1 END)::INT AS break_even,
        COALESCE(SUM(total_bet), 0)::BIGINT AS total_bet,
        COALESCE(SUM(total_return), 0)::BIGINT AS total_returned,
        COALESCE(SUM(net_gain), 0)::BIGINT AS net_profit
       FROM player_round_results
       WHERE user_id = $1`,
      [userId]
    );

    const row = res.rows[0];
    return {
      gamesPlayed: row.games_played,
      wins: row.wins,
      losses: row.losses,
      breakEven: row.break_even,
      totalBet: Number(row.total_bet),
      totalReturned: Number(row.total_returned),
      netProfit: Number(row.net_profit),
    };
  }

  /**
   * Thống kê tần suất xuất hiện của các biểu tượng từ các ván ĐÃ HOÀN TẤT (completed/settled rounds)
   * Không lấy từ số client gửi lên (theo spec A7).
   */
  static async getSymbolStatistics(roomId = null) {
    let sql = `
      SELECT symbol, COUNT(*)::INT as count
      FROM (
        SELECT jsonb_array_elements_text(dice) AS symbol
        FROM rounds
        WHERE status = 'settled' AND dice IS NOT NULL
    `;
    const params = [];

    if (roomId) {
      params.push(roomId);
      sql += ` AND room_id = $1`;
    }

    sql += `
      ) sub
      GROUP BY symbol
      ORDER BY count DESC
    `;

    const res = await query(sql, params);
    const result = { bau: 0, cua: 0, tom: 0, ca: 0, ga: 0, nai: 0 };
    for (const r of res.rows) {
      if (result[r.symbol] !== undefined) {
        result[r.symbol] = r.count;
      }
    }
    return result;
  }
}

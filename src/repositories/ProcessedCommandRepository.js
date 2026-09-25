import { Repository } from '../db/Repository.js';
import { query } from '../db/connection.js';

export class ProcessedCommandRepository extends Repository {
  constructor() {
    super('processed_commands');
  }

  /**
   * Lưu kết quả lệnh đã xử lý. Nếu lệnh đã tồn tại (duplicate), trả về bản ghi cũ.
   */
  async recordCommand({ commandKey, roomId = null, userId = null, commandType, resultPayload = null }, clientOverride = null) {
    const q = clientOverride ? clientOverride.query.bind(clientOverride) : query;

    // 1. Check existing
    const existing = await q('SELECT * FROM processed_commands WHERE command_key = $1', [commandKey]);
    if (existing.rows.length > 0) {
      return { isDuplicate: true, command: existing.rows[0] };
    }

    // 2. Insert new command
    try {
      const res = await q(
        `INSERT INTO processed_commands (command_key, room_id, user_id, command_type, result_payload)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [commandKey, roomId, userId, commandType, resultPayload ? JSON.stringify(resultPayload) : null]
      );
      return { isDuplicate: false, command: res.rows[0] };
    } catch (err) {
      // Concurrency catch in case of race condition
      if (err.code === '23505') { // unique_violation
        const recheck = await q('SELECT * FROM processed_commands WHERE command_key = $1', [commandKey]);
        return { isDuplicate: true, command: recheck.rows[0] };
      }
      throw err;
    }
  }

  async getCommand(commandKey) {
    const res = await query('SELECT * FROM processed_commands WHERE command_key = $1', [commandKey]);
    return res.rows[0] || null;
  }
}

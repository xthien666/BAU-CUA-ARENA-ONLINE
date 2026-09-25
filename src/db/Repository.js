import { query } from './connection.js';

export class Repository {
  constructor(tableName) {
    this.tableName = tableName;
  }

  async findById(id) {
    const res = await query(`SELECT * FROM ${this.tableName} WHERE id = $1`, [id]);
    return res.rows[0] || null;
  }

  async findAll(filters = {}, limit = 10, offset = 0) {
    const keys = Object.keys(filters);
    let sql = `SELECT * FROM ${this.tableName}`;
    const values = [];

    if (keys.length > 0) {
      const where = keys.map((key, i) => `${key} = $${i + 1}`).join(' AND ');
      sql += ` WHERE ${where}`;
      values.push(...Object.values(filters));
    }

    sql += ` LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
    values.push(limit, offset);

    const res = await query(sql, values);
    return res.rows;
  }

  async create(data) {
    const keys = Object.keys(data);
    const cols = keys.join(', ');
    const vals = keys.map((_, i) => `$${i + 1}`).join(', ');
    const sql = `INSERT INTO ${this.tableName} (${cols}) VALUES (${vals}) RETURNING *`;
    const res = await query(sql, Object.values(data));
    return res.rows[0];
  }

  async update(id, data) {
    const keys = Object.keys(data);
    const set = keys.map((key, i) => `${key} = $${i + 2}`).join(', ');
    const sql = `UPDATE ${this.tableName} SET ${set}, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`;
    const res = await query(sql, [id, ...Object.values(data)]);
    return res.rows[0];
  }

  async delete(id) {
    const res = await query(`DELETE FROM ${this.tableName} WHERE id = $1 RETURNING *`, [id]);
    return res.rows[0] || null;
  }
}

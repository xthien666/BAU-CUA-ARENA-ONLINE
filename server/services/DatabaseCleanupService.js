import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { TransactionManager } from '../db/TransactionManager.js';
import { AuditLogger } from '../db/AuditLogger.js';
import { AdminServiceError } from './AdminService.js';

const ACTION = 'DATABASE_CLEANUP';
const BATCH = 200;
const LOCK_TABLES = 'users, rooms, room_members, rounds, bets, player_round_results, wallets, wallet_transactions, auth_sessions, account_tokens, processed_commands, ad_reward_sessions, admin_mfa_credentials, admin_audit_logs, admin_request_tombstones';
function fail(code, message, status = 400) {
  const error = new AdminServiceError(code, message); error.status = status; throw error;
}
function options(input) {
  const retentionDays = Number(input.retentionDays);
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) fail('INVALID_ARGUMENT', 'Số ngày cần giữ phải từ 1 đến 3650.');
  const categories = Object.fromEntries(['rooms', 'users', 'audit'].map(key => [key, input.categories?.[key] === true]));
  if (!Object.values(categories).some(Boolean)) fail('INVALID_ARGUMENT', 'Chọn ít nhất một nhóm dữ liệu.');
  return { retentionDays, categories };
}
async function assertAdmin(client, actorId) {
  const result = await client.query("SELECT id FROM users WHERE id=$1 AND role='admin' AND status='active'", [actorId]);
  if (!result.rowCount) fail('ADMIN_REQUIRED', 'Cần tài khoản Admin đang hoạt động.', 403);
}
async function plan(client, { cutoff, categories }, excludedRoomIds) {
  const rooms = categories.rooms ? (await client.query(
    `SELECT r.id FROM rooms r WHERE r.status='closed' AND r.closed_at < $1
     AND NOT (r.id = ANY($2::uuid[]))
     AND NOT EXISTS (SELECT 1 FROM room_members m WHERE m.room_id=r.id AND m.left_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM rounds rd WHERE rd.room_id=r.id
       AND (rd.status NOT IN ('settled','cancelled') OR rd.settled_at >= $1))
     AND NOT EXISTS (SELECT 1 FROM bets b JOIN rounds rd ON rd.id=b.round_id
       WHERE rd.room_id=r.id AND (b.status='placed' OR b.created_at >= $1))
     ORDER BY r.closed_at, r.id LIMIT $3`, [cutoff, excludedRoomIds, BATCH])).rows.map(r => r.id) : [];
  const users = categories.users ? (await client.query(
    `SELECT u.id FROM users u WHERE u.role='player' AND u.status='deleted' AND u.deleted_at < $1
     AND NOT EXISTS (SELECT 1 FROM rooms r WHERE r.host_id=u.id AND NOT (r.id=ANY($2::uuid[])))
     AND NOT EXISTS (SELECT 1 FROM room_members m WHERE m.user_id=u.id AND NOT (m.room_id=ANY($2::uuid[])))
     AND NOT EXISTS (SELECT 1 FROM bets b JOIN rounds rd ON rd.id=b.round_id
       WHERE b.user_id=u.id AND NOT (rd.room_id=ANY($2::uuid[])))
     AND NOT EXISTS (SELECT 1 FROM player_round_results pr WHERE pr.user_id=u.id AND NOT (pr.room_id=ANY($2::uuid[])))
     AND NOT EXISTS (SELECT 1 FROM wallet_transactions w WHERE (w.user_id=u.id AND w.created_at >= $1)
       OR (w.actor_id=u.id AND w.user_id<>u.id))
     AND NOT EXISTS (SELECT 1 FROM auth_sessions s WHERE s.user_id=u.id AND s.revoked_at IS NULL AND s.expires_at>NOW())
     AND NOT EXISTS (SELECT 1 FROM processed_commands p WHERE p.user_id=u.id AND p.room_id IS NOT NULL AND NOT (p.room_id=ANY($2::uuid[])))
     AND NOT EXISTS (SELECT 1 FROM admin_audit_logs a WHERE a.admin_id=u.id)
     AND NOT EXISTS (SELECT 1 FROM admin_request_tombstones t WHERE t.admin_id=u.id)
     ORDER BY u.deleted_at, u.id LIMIT $3`, [cutoff, rooms, BATCH])).rows.map(u => u.id) : [];
  const audit = categories.audit ? (await client.query(
    'SELECT id FROM admin_audit_logs WHERE created_at < $1 AND action<>$2 ORDER BY created_at,id LIMIT $3',
    [cutoff, ACTION, BATCH])).rows.map(a => a.id) : [];
  const result = await client.query(
    `SELECT
     (SELECT count(*)::int FROM rounds WHERE room_id=ANY($1::uuid[])) AS rounds,
     (SELECT count(*)::int FROM bets WHERE round_id IN (SELECT id FROM rounds WHERE room_id=ANY($1::uuid[]))) AS bets,
     (SELECT count(*)::int FROM player_round_results WHERE room_id=ANY($1::uuid[])) AS results,
     (SELECT count(*)::int FROM room_members WHERE room_id=ANY($1::uuid[])) AS memberships,
     (SELECT count(*)::int FROM wallets WHERE user_id=ANY($2::uuid[])) AS wallets,
     (SELECT count(*)::int FROM wallet_transactions WHERE user_id=ANY($2::uuid[])) AS transactions,
     (SELECT count(*)::int FROM auth_sessions WHERE user_id=ANY($2::uuid[])) AS sessions,
     (SELECT count(*)::int FROM account_tokens WHERE user_id=ANY($2::uuid[])) AS tokens,
     (SELECT count(*)::int FROM ad_reward_sessions WHERE user_id=ANY($2::uuid[])) AS rewards,
     (SELECT count(*)::int FROM processed_commands WHERE user_id=ANY($2::uuid[]) OR room_id=ANY($1::uuid[])) AS commands,
     (SELECT count(*)::int FROM users WHERE role='player' AND status='deleted' AND deleted_at<$3) AS old_deleted_users`, [rooms, users, cutoff]);
  const { old_deleted_users, ...related } = result.rows[0];
  const counts = { rooms: rooms.length, users: users.length, audit: audit.length, ...related };
  return { rooms, users, audit, counts, skippedUsers: categories.users ? old_deleted_users-users.length : 0 };
}
function digest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

export class DatabaseCleanupService {
  constructor({ now = () => Date.now() } = {}) { this.key=randomBytes(32); this.now=now; }
  sign(payload) {
    const body=Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${createHmac('sha256',this.key).update(body).digest('base64url')}`;
  }
  read(token, actorId) {
    if (typeof token!=='string' || token.length>3000) fail('PREVIEW_INVALID','Hãy xem trước dữ liệu cần dọn.');
    const [body,signature,...extra]=token.split('.');
    const expected=createHmac('sha256',this.key).update(body||'').digest('base64url');
    const signatureBytes=Buffer.from(signature||'');
    const expectedBytes=Buffer.from(expected);
    if (extra.length || signatureBytes.length!==expectedBytes.length || !timingSafeEqual(signatureBytes,expectedBytes)) fail('PREVIEW_INVALID','Bản xem trước không hợp lệ.');
    let payload; try { payload=JSON.parse(Buffer.from(body,'base64url').toString()); } catch { fail('PREVIEW_INVALID','Bản xem trước không hợp lệ.'); }
    if(payload.actorId!==actorId) fail('PREVIEW_INVALID','Bản xem trước thuộc tài khoản khác.',403);
    if(payload.expiresAt<this.now()) fail('PREVIEW_EXPIRED','Bản xem trước hết hạn. Hãy xem trước lại.',409);
    return payload;
  }
  async preview({ actorId, excludedRoomIds=[], ...input }) {
    const selected=options(input);
    const cutoff=new Date(this.now()-selected.retentionDays*86400000).toISOString();
    return TransactionManager.withinTransaction(async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      await assertAdmin(client,actorId);
      const data=await plan(client,{...selected,cutoff},excludedRoomIds);
      const size=await client.query('SELECT pg_database_size(current_database())::text AS bytes');
      const expiresAt=this.now()+600000;
      return { ...selected,cutoff,expiresAt,counts:data.counts,skippedUsers:data.skippedUsers,batchLimit:BATCH,databaseBytes:Number(size.rows[0].bytes),
        previewToken:this.sign({actorId,...selected,cutoff,expiresAt,digest:digest(data)}) };
    });
  }
  async execute({ actorId, previewToken, confirmation, requestId, reason, ipAddress=null, excludedRoomIds=[] }) {
    if (confirmation!=='XOA VINH VIEN') fail('CONFIRMATION_REQUIRED','Nhập chính xác XOA VINH VIEN để xác nhận.');
    if(typeof requestId!=='string' || !requestId.trim() || requestId.length>100) fail('INVALID_REQUEST_ID','Thiếu mã yêu cầu hợp lệ.');
    if(typeof reason!=='string' || reason.trim().length<3 || reason.trim().length>255) fail('INVALID_REASON','Nhập lý do từ 3 đến 255 ký tự.');
    const fingerprint=digest({previewToken,confirmation,reason:reason.trim()});
    try {
      return await TransactionManager.withinTransaction(async client => {
        await client.query("SET LOCAL lock_timeout='2s'");
        await client.query("SET LOCAL statement_timeout='15s'");
        await client.query(`LOCK TABLE ${LOCK_TABLES} IN SHARE ROW EXCLUSIVE MODE`);
        await assertAdmin(client,actorId);
        const prior=await client.query('SELECT action,details FROM admin_audit_logs WHERE admin_id=$1 AND request_id=$2',[actorId,requestId]);
        if(prior.rowCount) {
          if(prior.rows[0].action!==ACTION || prior.rows[0].details?.fingerprint!==fingerprint) fail('REQUEST_ID_CONFLICT','Mã yêu cầu đã được dùng cho nội dung khác.',409);
          return {...prior.rows[0].details.result,isDuplicate:true};
        }
        const tombstone=await client.query('SELECT 1 FROM admin_request_tombstones WHERE admin_id=$1 AND request_id=$2',[actorId,requestId]);
        if(tombstone.rowCount) fail('REQUEST_ID_EXPIRED','Yêu cầu cũ đã được xử lý.',409);
        const selected=this.read(previewToken,actorId);
        const data=await plan(client,selected,excludedRoomIds);
        if(digest(data)!==selected.digest) fail('PREVIEW_CHANGED','Dữ liệu đã thay đổi. Hãy xem trước và xác nhận lại.',409);
        const {rooms,users,audit}=data;
        await client.query(`INSERT INTO admin_request_tombstones (admin_id,request_id)
          SELECT admin_id,request_id FROM admin_audit_logs WHERE id=ANY($1::uuid[]) AND request_id IS NOT NULL
          ON CONFLICT DO NOTHING`,[audit]);
        await client.query('DELETE FROM admin_audit_logs WHERE id=ANY($1::uuid[])',[audit]);
        await client.query('DELETE FROM processed_commands WHERE room_id=ANY($1::uuid[]) OR user_id=ANY($2::uuid[])',[rooms,users]);
        await client.query('DELETE FROM rooms WHERE id=ANY($1::uuid[])',[rooms]);
        for(const table of ['wallet_transactions','wallets','auth_sessions','account_tokens','ad_reward_sessions','admin_mfa_credentials']) {
          await client.query(`DELETE FROM ${table} WHERE user_id=ANY($1::uuid[])`,[users]);
        }
        await client.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[users]);
        const result={counts:data.counts,skippedUsers:data.skippedUsers,cutoff:selected.cutoff,retentionDays:selected.retentionDays,categories:selected.categories,completedAt:new Date(this.now()).toISOString()};
        await AuditLogger.logAdminAction({adminId:actorId,action:ACTION,targetType:'database',reason:reason.trim(),requestId,ipAddress,details:{fingerprint,result}},client);
        return {...result,isDuplicate:false};
      });
    } catch(error) {
      if(['55P03','57014','40P01'].includes(error.code)) fail('DATABASE_BUSY','Database đang bận. Hãy thử xem trước lại sau.',409);
      throw error;
    }
  }
}

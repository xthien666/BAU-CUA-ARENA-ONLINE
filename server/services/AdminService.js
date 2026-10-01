import { getClient } from '../db/connection.js';
import { isDeepStrictEqual } from 'node:util';
import { AuditLogger } from '../db/AuditLogger.js';
import { TransactionManager } from '../db/TransactionManager.js';
import { WalletService } from './WalletService.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DICE_SYMBOLS = new Set(['bau', 'cua', 'tom', 'ca', 'ga', 'nai']);
const OPEN_ROUND_STATUSES = ['waiting', 'betting', 'revealing', 'result'];
const MUTABLE_RESULT_STATUSES = new Set(['betting', 'revealing', 'result']);

export class AdminServiceError extends Error {
  constructor(code, message, options = undefined) {
    super(message, options);
    this.name = 'AdminServiceError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new AdminServiceError(code, message);
}

function requireUuid(value, field) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    fail('INVALID_ARGUMENT', `${field} không hợp lệ.`);
  }
  return value;
}

function requireRequestId(value) {
  const requestId = typeof value === 'string' ? value.trim() : '';
  if (!requestId || requestId.length > 100) {
    fail('INVALID_REQUEST_ID', 'requestId là bắt buộc và không được dài quá 100 ký tự.');
  }
  return requestId;
}

function requireReason(value) {
  const reason = typeof value === 'string' ? value.trim() : '';
  if (!reason || reason.length > 255) {
    fail('INVALID_REASON', 'Lý do là bắt buộc và không được dài quá 255 ký tự.');
  }
  return reason;
}

function normalizePage(limit = 25, offset = 0, maxLimit = 100) {
  const parsedLimit = Number(limit);
  const parsedOffset = Number(offset);
  return {
    limit: Number.isSafeInteger(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, maxLimit)
      : 25,
    offset: Number.isSafeInteger(parsedOffset) && parsedOffset >= 0
      ? parsedOffset
      : 0,
  };
}

function toJsonInteger(value, field = 'value') {
  const asNumber = Number(value ?? 0);
  if (!Number.isSafeInteger(asNumber)) {
    fail('DATABASE_VALUE_OUT_OF_RANGE', `${field} vượt giới hạn số nguyên an toàn.`);
  }
  return asNumber;
}

function normalizeWallet(wallet) {
  if (!wallet) return null;
  return {
    id: wallet.id,
    balance: toJsonInteger(wallet.balance, 'balance'),
    version: wallet.version,
    createdAt: wallet.created_at,
    updatedAt: wallet.updated_at,
  };
}

function mapUser(row) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    displayName: row.display_name,
    avatarKey: row.avatar_key,
    role: row.role,
    status: row.status,
    emailVerifiedAt: row.email_verified_at,
    bannedAt: row.banned_at,
    bannedUntil: row.banned_until,
    banReason: row.ban_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    wallet: row.wallet_id ? normalizeWallet({
      id: row.wallet_id,
      balance: row.balance,
      version: row.wallet_version,
      created_at: row.wallet_created_at,
      updated_at: row.wallet_updated_at,
    }) : null,
    pendingBetCount: toJsonInteger(row.pending_bet_count ?? 0, 'pending_bet_count'),
    pendingBetAmount: toJsonInteger(row.pending_bet_amount ?? 0, 'pending_bet_amount'),
  };
}

async function useClient(work) {
  const client = await getClient();
  try {
    return await work(client);
  } finally {
    client.release();
  }
}

async function assertActiveAdmin(client, actorId, { lock = false } = {}) {
  requireUuid(actorId, 'actorId');
  const result = await client.query(
    `SELECT id, username, display_name, role, status
     FROM users
     WHERE id = $1
     ${lock ? 'FOR UPDATE' : ''}`,
    [actorId]
  );
  const actor = result.rows[0];
  if (!actor || actor.role !== 'admin' || actor.status !== 'active') {
    fail('ADMIN_REQUIRED', 'Tài khoản quản trị đang hoạt động là bắt buộc.');
  }
  return actor;
}

function publicAudit(row) {
  if (!row) return null;
  return {
    id: row.id,
    adminId: row.admin_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    reason: row.reason,
    changes: row.changes,
    details: row.details,
    requestId: row.request_id,
    succeeded: row.succeeded,
    createdAt: row.created_at,
  };
}

async function findRequestAudit(client, actorId, requestId) {
  const result = await client.query(
    `SELECT * FROM admin_audit_logs
     WHERE admin_id = $1 AND request_id = $2`,
    [actorId, requestId]
  );
  if (result.rows[0]) return result.rows[0];
  const archived = await client.query(
    'SELECT 1 FROM admin_request_tombstones WHERE admin_id=$1 AND request_id=$2',
    [actorId, requestId]
  );
  if (archived.rowCount) fail('REQUEST_ID_EXPIRED', 'Yêu cầu này đã được xử lý và nhật ký đã dọn. Không thể thực hiện lại yêu cầu cũ.');
  return null;
}

function duplicateMutationResult(existing, { action, targetType, targetId }) {
  const sameTarget = (existing.target_id ?? null) === (targetId ?? null);
  if (existing.action !== action || existing.target_type !== targetType || !sameTarget) {
    fail('REQUEST_ID_CONFLICT', 'requestId đã được dùng cho một thao tác quản trị khác.');
  }
  const priorResult = existing.details?.result;
  if (!priorResult || typeof priorResult !== 'object' || Array.isArray(priorResult)) {
    fail('REQUEST_ID_CONFLICT', 'Không thể khôi phục kết quả của requestId đã dùng.');
  }
  return { ...priorResult, isDuplicate: true, audit: publicAudit(existing) };
}

async function executeMutation({
  actorId,
  requestId,
  reason,
  action,
  targetType,
  targetId,
  ipAddress = null,
  input = null,
  work,
}) {
  const safeRequestId = requireRequestId(requestId);
  const safeReason = requireReason(reason);
  if (targetId !== null) requireUuid(targetId, 'targetId');

  return TransactionManager.withinTransaction(async client => {
    // Locking the actor serializes request-id checks for each admin. This makes
    // both the business change and its unique audit record replay-safe.
    await assertActiveAdmin(client, actorId, { lock: true });
    const existing = await findRequestAudit(client, actorId, safeRequestId);
    if (existing) {
      if (existing.details?.input !== undefined && !isDeepStrictEqual(existing.details.input, { reason: safeReason, value: input })) {
        fail('REQUEST_ID_CONFLICT', 'requestId đã được dùng cho nội dung khác.');
      }
      return duplicateMutationResult(existing, { action, targetType, targetId });
    }

    const outcome = await work(client, { requestId: safeRequestId, reason: safeReason });
    const result = outcome?.result ?? outcome ?? {};
    const audit = await AuditLogger.logAdminAction({
      adminId: actorId,
      action,
      targetType,
      targetId,
      reason: safeReason,
      changes: outcome?.changes ?? null,
      details: {
        ...(outcome?.details ?? {}),
        result,
        input: { reason: safeReason, value: input },
      },
      ipAddress,
      requestId: safeRequestId,
      succeeded: true,
    }, client);

    return { ...result, isDuplicate: false, audit: publicAudit(audit) };
  });
}

async function findTargetUserForUpdate(client, userId) {
  const result = await client.query(
    `SELECT id, username, display_name, role, status, deleted_at,
            banned_at, banned_until, ban_reason
     FROM users WHERE id = $1 FOR UPDATE`,
    [userId]
  );
  const user = result.rows[0];
  if (!user) fail('USER_NOT_FOUND', 'Không tìm thấy tài khoản.');
  return user;
}

function assertPlayerAdministrativeTarget(actorId, user) {
  if (user.id === actorId) {
    fail('SELF_ACTION_FORBIDDEN', 'Không thể thực hiện thao tác này trên chính tài khoản quản trị.');
  }
  if (user.role === 'admin') {
    fail('ADMIN_TARGET_FORBIDDEN', 'Không thể ban, xóa hoặc kick tài khoản quản trị.');
  }
}

async function refundBettingBetsForUser(client, { userId, requestId, reason }) {
  const rounds = await client.query(
    `SELECT round.id, round.room_id
     FROM rounds round
     WHERE round.status = 'betting'
       AND round.final_result IS NULL
       AND (round.betting_deadline IS NULL OR round.betting_deadline > (
         SELECT CASE WHEN room.status='paused' THEN COALESCE(room.paused_at,CURRENT_TIMESTAMP) ELSE CURRENT_TIMESTAMP END
         FROM rooms room WHERE room.id=round.room_id
       ))
       AND EXISTS (
         SELECT 1 FROM bets bet
         WHERE bet.round_id = round.id
           AND bet.user_id = $1
           AND bet.status = 'placed'
       )
     ORDER BY round.id
     FOR UPDATE`,
    [userId]
  );

  let refunded = 0n;
  let cancelledBets = 0;
  for (const round of rounds.rows) {
    const bets = await client.query(
      `SELECT id, amount
       FROM bets
       WHERE round_id = $1 AND user_id = $2 AND status = 'placed'
       ORDER BY id
       FOR UPDATE`,
      [round.id, userId]
    );
    const amount = bets.rows.reduce((sum, bet) => sum + BigInt(bet.amount), 0n);
    if (amount === 0n) continue;

    await WalletService.refundBet({
      userId,
      amount: amount.toString(),
      roomId: round.room_id,
      roundId: round.id,
      requestId: `${requestId}:user-refund`,
      reason,
    }, client);
    await client.query(
      `UPDATE bets SET status = 'cancelled', payout = 0
       WHERE round_id = $1 AND user_id = $2 AND status = 'placed'`,
      [round.id, userId]
    );
    refunded += amount;
    cancelledBets += bets.rowCount;
  }

  return {
    refunded: toJsonInteger(refunded, 'refunded'),
    cancelledBets,
  };
}

async function refundRound(client, { roundId, roomId, requestId, reason }) {
  const bets = await client.query(
    `SELECT id, user_id, amount
     FROM bets
     WHERE round_id = $1 AND status = 'placed'
     ORDER BY user_id, id
     FOR UPDATE`,
    [roundId]
  );
  const byUser = new Map();
  for (const bet of bets.rows) {
    byUser.set(bet.user_id, (byUser.get(bet.user_id) ?? 0n) + BigInt(bet.amount));
  }

  let refunded = 0n;
  for (const [userId, amount] of byUser) {
    await WalletService.refundBet({
      userId,
      amount: amount.toString(),
      roomId,
      roundId,
      requestId: `${requestId}:round-close`,
      reason,
    }, client);
    refunded += amount;
  }
  if (bets.rowCount > 0) {
    await client.query(
      `UPDATE bets SET status = 'cancelled', payout = 0
       WHERE round_id = $1 AND status = 'placed'`,
      [roundId]
    );
  }
  return {
    refunded: toJsonInteger(refunded, 'refunded'),
    cancelledBets: bets.rowCount,
  };
}

async function closeRoomLocked(client, room, { requestId, reason }) {
  const rounds = await client.query(
    `SELECT id, status, final_result
     FROM rounds
     WHERE room_id = $1 AND status = ANY($2::varchar[])
     ORDER BY id
     FOR UPDATE`,
    [room.id, OPEN_ROUND_STATUSES]
  );

  let refunded = 0;
  let cancelledBets = 0;
  let cancelledRounds = 0;
  for (const round of rounds.rows) {
    // Settlement publishes final_result in the same transaction as payouts.
    // Never turn a committed result into a refund.
    if (round.final_result !== null) continue;
    const roundRefund = await refundRound(client, {
      roundId: round.id,
      roomId: room.id,
      requestId,
      reason,
    });
    refunded += roundRefund.refunded;
    cancelledBets += roundRefund.cancelledBets;
    await client.query(
      `UPDATE rounds
       SET status = 'cancelled', admin_override_result = NULL, result_mode = 'random'
       WHERE id = $1 AND final_result IS NULL`,
      [round.id]
    );
    cancelledRounds += 1;
  }

  await client.query(
    `UPDATE room_members SET left_at = CURRENT_TIMESTAMP
     WHERE room_id = $1 AND left_at IS NULL`,
    [room.id]
  );
  const closed = await client.query(
    `UPDATE rooms
     SET status = 'closed', closed_at = COALESCE(closed_at, CURRENT_TIMESTAMP)
     WHERE id = $1
     RETURNING id, code, name, status, closed_at`,
    [room.id]
  );
  return {
    room: closed.rows[0],
    refunded,
    cancelledBets,
    cancelledRounds,
  };
}

async function removeActiveMembership(client, { userId, requestId, reason }) {
  const membershipResult = await client.query(
    `SELECT member.id, member.room_id, member.role,
            room.code, room.name, room.status, room.host_id
     FROM room_members member
     JOIN rooms room ON room.id = member.room_id
     WHERE member.user_id = $1 AND member.left_at IS NULL
     FOR UPDATE OF member, room`,
    [userId]
  );
  const membership = membershipResult.rows[0];
  if (!membership) return { removed: false, roomClosed: false, newHostId: null };

  const refund = await refundBettingBetsForUser(client, { userId, requestId, reason });
  await client.query(
    'UPDATE room_members SET left_at = CURRENT_TIMESTAMP WHERE id = $1',
    [membership.id]
  );

  let newHostId = null;
  let roomClosed = false;
  let closeResult = null;
  if (membership.role === 'host' && membership.status !== 'closed') {
    const candidate = await client.query(
      `SELECT id, user_id
       FROM room_members
       WHERE room_id = $1 AND left_at IS NULL
       ORDER BY joined_at, id
       LIMIT 1
       FOR UPDATE`,
      [membership.room_id]
    );
    if (candidate.rowCount === 1) {
      newHostId = candidate.rows[0].user_id;
      await client.query('UPDATE room_members SET role = \'host\' WHERE id = $1', [candidate.rows[0].id]);
      await client.query('UPDATE rooms SET host_id = $1 WHERE id = $2', [newHostId, membership.room_id]);
    } else {
      closeResult = await closeRoomLocked(client, { id: membership.room_id }, { requestId, reason });
      roomClosed = true;
    }
  }

  return {
    removed: true,
    roomId: membership.room_id,
    roomCode: membership.code,
    roomClosed,
    newHostId,
    refunded: refund.refunded + (closeResult?.refunded ?? 0),
    cancelledBets: refund.cancelledBets + (closeResult?.cancelledBets ?? 0),
  };
}

function validateDice(dice) {
  if (!Array.isArray(dice) || dice.length !== 3 || !dice.every(symbol => DICE_SYMBOLS.has(symbol))) {
    fail('INVALID_DICE', 'Kết quả phải gồm đúng 3 linh vật hợp lệ.');
  }
  return [...dice];
}

export class AdminService {
  async getOverview({ actorId, from = null, to = null } = {}) {
    return useClient(async client => {
      await assertActiveAdmin(client, actorId);
      const fromDate = from === null ? null : new Date(from);
      const toDate = to === null ? null : new Date(to);
      if (fromDate && Number.isNaN(fromDate.valueOf())) fail('INVALID_ARGUMENT', 'Mốc from không hợp lệ.');
      if (toDate && Number.isNaN(toDate.valueOf())) fail('INVALID_ARGUMENT', 'Mốc to không hợp lệ.');
      if (fromDate && toDate && fromDate >= toDate) fail('INVALID_ARGUMENT', 'Khoảng thời gian không hợp lệ.');

      const [users, rooms, sessions, rounds, bets, coins] = [
        await client.query(
          `SELECT COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE status = 'active')::int AS active,
                  COUNT(*) FILTER (WHERE status = 'banned')::int AS banned,
                  COUNT(*) FILTER (WHERE status = 'deleted')::int AS deleted
           FROM users`
        ),
        await client.query(
          `SELECT COUNT(*) FILTER (WHERE status = 'active')::int AS active,
                  COUNT(*) FILTER (WHERE status = 'paused')::int AS paused,
                  COUNT(*) FILTER (WHERE status = 'closed')::int AS closed
           FROM rooms`
        ),
        await client.query(
          `SELECT COUNT(*)::int AS sessions,
                  COUNT(DISTINCT session.user_id)::int AS users
           FROM auth_sessions session
           JOIN users usr ON usr.id = session.user_id
           WHERE session.revoked_at IS NULL
             AND session.expires_at > CURRENT_TIMESTAMP
             AND session.idle_expires_at > CURRENT_TIMESTAMP
             AND usr.status = 'active'`
        ),
        await client.query(
          `SELECT COUNT(*) FILTER (WHERE status = ANY($1::varchar[]))::int AS unfinished,
                  COUNT(*) FILTER (
                    WHERE status = 'betting'
                      AND betting_deadline IS NOT NULL
                      AND betting_deadline < CURRENT_TIMESTAMP - INTERVAL '5 minutes'
                      AND EXISTS (SELECT 1 FROM rooms room WHERE room.id=rounds.room_id AND room.status='active')
                  )::int AS stalled
           FROM rounds`,
          [OPEN_ROUND_STATUSES]
        ),
        await client.query(
          `SELECT COUNT(*)::int AS count, COALESCE(SUM(bet.amount), 0) AS amount
           FROM bets bet
           JOIN rounds round ON round.id = bet.round_id
           WHERE bet.status = 'placed' AND round.status = ANY($1::varchar[])`,
          [OPEN_ROUND_STATUSES]
        ),
        await client.query(
          `SELECT
             COALESCE(SUM(amount) FILTER (WHERE transaction_type = 'ADMIN_GRANT'), 0) AS admin_grants,
             COALESCE(SUM(amount) FILTER (WHERE transaction_type = 'AD_REWARD'), 0) AS ad_rewards
           FROM wallet_transactions
           WHERE ($1::timestamptz IS NULL OR created_at >= $1)
             AND ($2::timestamptz IS NULL OR created_at < $2)`,
          [fromDate, toDate]
        ),
      ];

      return {
        users: users.rows[0],
        rooms: rooms.rows[0],
        activeSessions: sessions.rows[0],
        rounds: rounds.rows[0],
        pendingBets: {
          count: bets.rows[0].count,
          amount: toJsonInteger(bets.rows[0].amount, 'pending_bet_amount'),
        },
        coins: {
          adminGrants: toJsonInteger(coins.rows[0].admin_grants, 'admin_grants'),
          adRewards: toJsonInteger(coins.rows[0].ad_rewards, 'ad_rewards'),
          from: fromDate,
          to: toDate,
        },
      };
    });
  }

  async listUsers({ actorId, search = '', status = null, role = null, limit = 25, offset = 0 } = {}) {
    return useClient(async client => {
      await assertActiveAdmin(client, actorId);
      const page = normalizePage(limit, offset);
      if (status !== null && !['active', 'banned', 'deleted'].includes(status)) {
        fail('INVALID_ARGUMENT', 'Trạng thái tài khoản không hợp lệ.');
      }
      if (role !== null && !['player', 'admin'].includes(role)) {
        fail('INVALID_ARGUMENT', 'Vai trò tài khoản không hợp lệ.');
      }
      const safeSearch = typeof search === 'string' ? search.trim().slice(0, 255) : '';
      const values = [safeSearch, status, role];
      const where = `
        ($1 = '' OR usr.id::text = $1 OR usr.username ILIKE '%' || $1 || '%'
          OR usr.email ILIKE '%' || $1 || '%' OR usr.display_name ILIKE '%' || $1 || '%')
        AND ($2::varchar IS NULL OR usr.status = $2)
        AND ($3::varchar IS NULL OR usr.role = $3)`;
      const totalResult = await client.query(`SELECT COUNT(*)::int AS total FROM users usr WHERE ${where}`, values);
      const result = await client.query(
        `SELECT usr.id, usr.username, usr.email, usr.display_name, usr.avatar_key,
                usr.role, usr.status, usr.email_verified_at, usr.banned_at,
                usr.banned_until, usr.ban_reason, usr.created_at, usr.updated_at,
                usr.deleted_at, wallet.id AS wallet_id, wallet.balance,
                wallet.version AS wallet_version, wallet.created_at AS wallet_created_at,
                wallet.updated_at AS wallet_updated_at,
                COALESCE(pending.bet_count, 0)::int AS pending_bet_count,
                COALESCE(pending.bet_amount, 0) AS pending_bet_amount
         FROM users usr
         LEFT JOIN wallets wallet ON wallet.user_id = usr.id
         LEFT JOIN LATERAL (
           SELECT COUNT(*) AS bet_count, COALESCE(SUM(bet.amount), 0) AS bet_amount
           FROM bets bet
           JOIN rounds round ON round.id = bet.round_id
           WHERE bet.user_id = usr.id
             AND bet.status = 'placed'
             AND round.status = ANY($4::varchar[])
         ) pending ON TRUE
         WHERE ${where}
         ORDER BY usr.created_at DESC, usr.id
         LIMIT $5 OFFSET $6`,
        [...values, OPEN_ROUND_STATUSES, page.limit, page.offset]
      );
      return {
        items: result.rows.map(mapUser),
        total: totalResult.rows[0].total,
        ...page,
      };
    });
  }

  async getUser({ actorId, userId, transactionLimit = 25 } = {}) {
    requireUuid(userId, 'userId');
    return useClient(async client => {
      await assertActiveAdmin(client, actorId);
      const limit = normalizePage(transactionLimit, 0, 100).limit;
      const result = await client.query(
        `SELECT usr.id, usr.username, usr.email, usr.display_name, usr.avatar_key,
                usr.role, usr.status, usr.email_verified_at, usr.banned_at,
                usr.banned_until, usr.ban_reason, usr.created_at, usr.updated_at,
                usr.deleted_at, wallet.id AS wallet_id, wallet.balance,
                wallet.version AS wallet_version, wallet.created_at AS wallet_created_at,
                wallet.updated_at AS wallet_updated_at,
                COALESCE(pending.bet_count, 0)::int AS pending_bet_count,
                COALESCE(pending.bet_amount, 0) AS pending_bet_amount
         FROM users usr
         LEFT JOIN wallets wallet ON wallet.user_id = usr.id
         LEFT JOIN LATERAL (
           SELECT COUNT(*) AS bet_count, COALESCE(SUM(bet.amount), 0) AS bet_amount
           FROM bets bet
           JOIN rounds round ON round.id = bet.round_id
           WHERE bet.user_id = usr.id
             AND bet.status = 'placed'
             AND round.status = ANY($2::varchar[])
         ) pending ON TRUE
         WHERE usr.id = $1`,
        [userId, OPEN_ROUND_STATUSES]
      );
      if (!result.rows[0]) fail('USER_NOT_FOUND', 'Không tìm thấy tài khoản.');

      const [bets, transactions] = [
        await client.query(
          `SELECT bet.id, bet.round_id, round.room_id, room.code AS room_code,
                  bet.symbol, bet.amount, bet.status, bet.created_at,
                  round.status AS round_status, round.betting_deadline
           FROM bets bet
           JOIN rounds round ON round.id = bet.round_id
           JOIN rooms room ON room.id = round.room_id
           WHERE bet.user_id = $1
             AND bet.status = 'placed'
             AND round.status = ANY($2::varchar[])
           ORDER BY bet.created_at, bet.id`,
          [userId, OPEN_ROUND_STATUSES]
        ),
        await client.query(
          `SELECT id, transaction_type, amount, balance_before, balance_after,
                  actor_id, room_id, round_id, reason, created_at
           FROM wallet_transactions
           WHERE user_id = $1
           ORDER BY created_at DESC, id DESC
           LIMIT $2`,
          [userId, limit]
        ),
      ];
      return {
        user: mapUser(result.rows[0]),
        pendingBets: bets.rows.map(bet => ({
          id: bet.id,
          roundId: bet.round_id,
          roomId: bet.room_id,
          roomCode: bet.room_code,
          symbol: bet.symbol,
          amount: toJsonInteger(bet.amount, 'bet_amount'),
          status: bet.status,
          roundStatus: bet.round_status,
          bettingDeadline: bet.betting_deadline,
          createdAt: bet.created_at,
        })),
        recentTransactions: transactions.rows.map(transaction => ({
          id: transaction.id,
          type: transaction.transaction_type,
          amount: toJsonInteger(transaction.amount, 'transaction_amount'),
          balanceBefore: toJsonInteger(transaction.balance_before, 'balance_before'),
          balanceAfter: toJsonInteger(transaction.balance_after, 'balance_after'),
          actorId: transaction.actor_id,
          roomId: transaction.room_id,
          roundId: transaction.round_id,
          reason: transaction.reason,
          createdAt: transaction.created_at,
        })),
      };
    });
  }

  async grantCoins({ actorId, userId, amount, requestId, reason, ipAddress = null } = {}) {
    requireUuid(userId, 'userId');
    if (!Number.isSafeInteger(amount) || amount <= 0) fail('INVALID_AMOUNT', 'Số xu phải là số nguyên dương an toàn.');
    return executeMutation({
      actorId,
      requestId,
      reason,
      action: 'ADMIN_GRANT',
      input: { amount },
      targetType: 'user',
      targetId: userId,
      ipAddress,
      work: async (client, command) => {
        const user = await findTargetUserForUpdate(client, userId);
        if (user.status !== 'active') fail('USER_NOT_ACTIVE', 'Chỉ có thể cấp xu cho tài khoản đang hoạt động.');
        const wallet = (await client.query('SELECT balance FROM wallets WHERE user_id=$1 FOR UPDATE', [userId])).rows[0];
        if (!wallet) fail('WALLET_NOT_FOUND', 'Tài khoản chưa có ví.');
        const exposure = (await client.query("SELECT COALESCE(SUM(amount),0) AS total FROM bets WHERE user_id=$1 AND status='placed'", [userId])).rows[0];
        if (BigInt(wallet.balance) + BigInt(amount) + 4n * BigInt(exposure.total) > 1_000_000_000_000n) fail('WALLET_LIMIT', 'Cấp xu vượt giới hạn ví sau khi dự phòng trả thưởng cược đang chờ.');
        const grant = await WalletService.adminGrant({
          userId,
          amount,
          actorId,
          requestId: command.requestId,
          reason: command.reason,
        }, client);
        const result = {
          userId,
          transactionId: grant.transaction.id,
          amount: toJsonInteger(grant.transaction.amount, 'grant_amount'),
          balanceBefore: toJsonInteger(grant.transaction.balance_before, 'balance_before'),
          balanceAfter: toJsonInteger(grant.transaction.balance_after, 'balance_after'),
        };
        return {
          result,
          changes: { balance: { before: result.balanceBefore, after: result.balanceAfter } },
        };
      },
    });
  }

  async banUser({ actorId, userId, bannedUntil = null, requestId, reason, ipAddress = null } = {}) {
    requireUuid(userId, 'userId');
    const until = bannedUntil === null ? null : new Date(bannedUntil);
    if (until && (Number.isNaN(until.valueOf()) || until <= new Date())) {
      fail('INVALID_ARGUMENT', 'Thời hạn ban phải nằm trong tương lai.');
    }
    return executeMutation({
      actorId,
      requestId,
      reason,
      action: 'USER_BAN',
      input: { bannedUntil: until?.toISOString() ?? null },
      targetType: 'user',
      targetId: userId,
      ipAddress,
      work: async (client, command) => {
        const user = await findTargetUserForUpdate(client, userId);
        assertPlayerAdministrativeTarget(actorId, user);
        if (user.status === 'deleted') fail('USER_DELETED', 'Tài khoản đã bị xóa mềm.');
        const membership = await removeActiveMembership(client, {
          userId,
          requestId: command.requestId,
          reason: command.reason,
        });
        const revoked = await client.query(
          `UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP
           WHERE user_id = $1 AND revoked_at IS NULL
           RETURNING id`,
          [userId]
        );
        const updated = await client.query(
          `UPDATE users
           SET status = 'banned', banned_at = CURRENT_TIMESTAMP,
               banned_until = $2, ban_reason = $3, banned_by = $4,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1
           RETURNING id, status, banned_at, banned_until, ban_reason`,
          [userId, until, command.reason, actorId]
        );
        return {
          result: {
            userId,
            status: updated.rows[0].status,
            bannedAt: updated.rows[0].banned_at,
            bannedUntil: updated.rows[0].banned_until,
            revokedSessions: revoked.rowCount,
            membership,
          },
          changes: {
            status: { before: user.status, after: 'banned' },
            bannedUntil: { before: user.banned_until, after: until },
          },
        };
      },
    });
  }

  async unbanUser({ actorId, userId, requestId, reason, ipAddress = null } = {}) {
    requireUuid(userId, 'userId');
    return executeMutation({
      actorId,
      requestId,
      reason,
      action: 'USER_UNBAN',
      targetType: 'user',
      targetId: userId,
      ipAddress,
      work: async client => {
        const user = await findTargetUserForUpdate(client, userId);
        assertPlayerAdministrativeTarget(actorId, user);
        if (user.status !== 'banned') fail('USER_NOT_BANNED', 'Tài khoản không ở trạng thái bị ban.');
        const updated = await client.query(
          `UPDATE users
           SET status = 'active', banned_at = NULL, banned_until = NULL,
               ban_reason = NULL, banned_by = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1
           RETURNING id, status`,
          [userId]
        );
        return {
          result: { userId, status: updated.rows[0].status },
          changes: { status: { before: 'banned', after: 'active' } },
        };
      },
    });
  }

  async softDeleteUser({ actorId, userId, requestId, reason, ipAddress = null } = {}) {
    requireUuid(userId, 'userId');
    return executeMutation({
      actorId,
      requestId,
      reason,
      action: 'USER_SOFT_DELETE',
      targetType: 'user',
      targetId: userId,
      ipAddress,
      work: async (client, command) => {
        const user = await findTargetUserForUpdate(client, userId);
        assertPlayerAdministrativeTarget(actorId, user);
        if (user.status === 'deleted') fail('USER_DELETED', 'Tài khoản đã bị xóa mềm.');
        const membership = await removeActiveMembership(client, {
          userId,
          requestId: command.requestId,
          reason: command.reason,
        });
        const revoked = await client.query(
          `UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP
           WHERE user_id = $1 AND revoked_at IS NULL
           RETURNING id`,
          [userId]
        );
        const updated = await client.query(
          `UPDATE users
           SET status = 'deleted', deleted_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1
           RETURNING id, status, deleted_at`,
          [userId]
        );
        return {
          result: {
            userId,
            status: updated.rows[0].status,
            deletedAt: updated.rows[0].deleted_at,
            revokedSessions: revoked.rowCount,
            membership,
          },
          changes: { status: { before: user.status, after: 'deleted' } },
        };
      },
    });
  }

  async listRooms({ actorId, search = '', status = null, limit = 25, offset = 0 } = {}) {
    return useClient(async client => {
      await assertActiveAdmin(client, actorId);
      const page = normalizePage(limit, offset);
      if (status !== null && !['active', 'paused', 'closed'].includes(status)) {
        fail('INVALID_ARGUMENT', 'Trạng thái phòng không hợp lệ.');
      }
      const safeSearch = typeof search === 'string' ? search.trim().slice(0, 100) : '';
      const values = [safeSearch, status];
      const where = `($1 = '' OR room.id::text = $1 OR room.code ILIKE '%' || $1 || '%'
                       OR room.name ILIKE '%' || $1 || '%')
                     AND ($2::varchar IS NULL OR room.status = $2)`;
      const count = await client.query(`SELECT COUNT(*)::int AS total FROM rooms room WHERE ${where}`, values);
      const result = await client.query(
        `SELECT room.id, room.code, room.name, room.mode, room.capacity,
                room.betting_duration, room.locked, room.status, room.created_at, room.closed_at,
                host.id AS host_id, host.username AS host_username,
                host.display_name AS host_display_name,
                current_round.id AS round_id, current_round.round_number,
                current_round.status AS round_status, current_round.betting_deadline,
                current_round.result_mode, current_round.admin_override_result,
                COALESCE(members.member_count, 0)::int AS member_count,
                COALESCE(members.items, '[]'::jsonb) AS members
         FROM rooms room
         JOIN users host ON host.id = room.host_id
         LEFT JOIN LATERAL (
           SELECT round.id, round.round_number, round.status, round.betting_deadline,
                  round.result_mode, round.admin_override_result
           FROM rounds round
           WHERE round.room_id = room.id AND round.status = ANY($3::varchar[])
           ORDER BY round.started_at DESC, round.id DESC
           LIMIT 1
         ) current_round ON TRUE
         LEFT JOIN LATERAL (
           SELECT COUNT(*) AS member_count,
                  jsonb_agg(jsonb_build_object(
                    'id', usr.id,
                    'username', usr.username,
                    'displayName', usr.display_name,
                    'avatarKey', usr.avatar_key,
                    'role', member.role,
                    'joinedAt', member.joined_at
                  ) ORDER BY member.joined_at, member.id) AS items
           FROM room_members member
           JOIN users usr ON usr.id = member.user_id
           WHERE member.room_id = room.id AND member.left_at IS NULL
         ) members ON TRUE
         WHERE ${where}
         ORDER BY CASE room.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
                  room.created_at DESC, room.id
         LIMIT $4 OFFSET $5`,
        [...values, OPEN_ROUND_STATUSES, page.limit, page.offset]
      );
      return {
        items: result.rows.map(room => ({
          id: room.id,
          code: room.code,
          name: room.name,
          mode: room.mode,
          capacity: room.capacity,
          bettingDuration: room.betting_duration,
          locked: room.locked,
          status: room.status,
          createdAt: room.created_at,
          closedAt: room.closed_at,
          host: {
            id: room.host_id,
            username: room.host_username,
            displayName: room.host_display_name,
          },
          memberCount: room.member_count,
          members: room.members,
          currentRound: room.round_id ? {
            id: room.round_id,
            roundNumber: room.round_number,
            status: room.round_status,
            bettingDeadline: room.betting_deadline,
            resultMode: room.result_mode,
            adminOverrideResult: room.admin_override_result,
          } : null,
        })),
        total: count.rows[0].total,
        ...page,
      };
    });
  }

  async kickMember({ actorId, roomId, userId, requestId, reason, ipAddress = null } = {}) {
    requireUuid(roomId, 'roomId');
    requireUuid(userId, 'userId');
    return executeMutation({
      actorId,
      requestId,
      reason,
      action: 'ROOM_MEMBER_KICK',
      input: { userId },
      targetType: 'room',
      targetId: roomId,
      ipAddress,
      work: async (client, command) => {
        const target = await findTargetUserForUpdate(client, userId);
        if (target.role === 'admin') fail('ADMIN_TARGET_FORBIDDEN', 'Không thể kick tài khoản quản trị.');
        const membership = await client.query(
          `SELECT id FROM room_members
           WHERE room_id = $1 AND user_id = $2 AND left_at IS NULL`,
          [roomId, userId]
        );
        if (membership.rowCount !== 1) fail('MEMBER_NOT_FOUND', 'Người chơi không còn trong phòng.');
        const removal = await removeActiveMembership(client, {
          userId,
          requestId: command.requestId,
          reason: command.reason,
        });
        if (!removal.removed || removal.roomId !== roomId) {
          fail('MEMBER_NOT_FOUND', 'Người chơi không còn trong phòng.');
        }
        return {
          result: { userId, roomId, ...removal },
          changes: { membership: { before: 'active', after: 'left' } },
        };
      },
    });
  }

  async pauseRoom(options = {}) {
    return this.#setRoomStatus({ ...options, nextStatus: 'paused', action: 'ROOM_PAUSE' });
  }

  async setRoomLock({ actorId, roomId, locked, requestId, reason, ipAddress = null } = {}) {
    requireUuid(roomId, 'roomId');
    if (typeof locked !== 'boolean') fail('INVALID_ARGUMENT', 'Trạng thái khóa không hợp lệ.');
    return executeMutation({ actorId, requestId, reason, ipAddress, input: { locked }, action: 'ROOM_LOCK', targetType: 'room', targetId: roomId,
      work: async client => {
        const found = await client.query('SELECT id, status, locked FROM rooms WHERE id=$1 FOR UPDATE', [roomId]);
        const room = found.rows[0];
        if (!room) fail('ROOM_NOT_FOUND', 'Không tìm thấy phòng.');
        if (room.status === 'closed') fail('ROOM_CLOSED', 'Phòng đã đóng.');
        await client.query('UPDATE rooms SET locked=$2 WHERE id=$1', [roomId, locked]);
        return { result: { roomId, locked }, changes: { locked: { before: room.locked, after: locked } } };
      },
    });
  }

  async setBettingDuration({ actorId, roomId, durationSeconds, requestId, reason, ipAddress = null } = {}) {
    requireUuid(roomId, 'roomId');
    if (![15, 30, 45, 60].includes(durationSeconds)) fail('INVALID_ARGUMENT', 'Thời gian cược phải là 15, 30, 45 hoặc 60 giây.');
    return executeMutation({ actorId, requestId, reason, ipAddress, input: { durationSeconds }, action: 'ROOM_BETTING_DURATION', targetType: 'room', targetId: roomId,
      work: async client => {
        const found = await client.query('SELECT id, status, betting_duration FROM rooms WHERE id=$1 FOR UPDATE', [roomId]);
        const room = found.rows[0];
        if (!room) fail('ROOM_NOT_FOUND', 'Không tìm thấy phòng.');
        if (room.status === 'closed') fail('ROOM_CLOSED', 'Phòng đã đóng.');
        await client.query('UPDATE rooms SET betting_duration=$2 WHERE id=$1', [roomId, durationSeconds]);
        return { result: { roomId, durationSeconds }, changes: { bettingDuration: { before: room.betting_duration, after: durationSeconds } } };
      },
    });
  }

  async cancelCurrentRound({ actorId, roomId, roundId, requestId, reason, ipAddress = null } = {}) {
    requireUuid(roomId, 'roomId');
    requireUuid(roundId, 'roundId');
    return executeMutation({ actorId, requestId, reason, ipAddress, action: 'ROUND_CANCEL', targetType: 'round', targetId: roundId,
      work: async (client, command) => {
        const room = await client.query('SELECT id FROM rooms WHERE id=$1 AND status<>\'closed\' FOR UPDATE', [roomId]);
        if (!room.rowCount) fail('ROOM_NOT_FOUND', 'Không tìm thấy phòng đang chạy.');
        const found = await client.query('SELECT id, status, final_result FROM rounds WHERE id=$1 AND room_id=$2 FOR UPDATE', [roundId, roomId]);
        const round = found.rows[0];
        if (!round) fail('ROUND_NOT_FOUND', 'Không tìm thấy ván trong phòng.');
        if (round.final_result || !MUTABLE_RESULT_STATUSES.has(round.status)) fail('ROUND_RESULT_FINAL', 'Ván đã chốt; không thể hủy thanh toán.');
        const refund = await refundRound(client, { roundId, roomId, ...command });
        await client.query("UPDATE rounds SET status='cancelled', admin_override_result=NULL, result_mode='random' WHERE id=$1", [roundId]);
        return { result: { roomId, roundId, ...refund }, changes: { status: { before: round.status, after: 'cancelled' } } };
      },
    });
  }

  async resumeRoom(options = {}) {
    return this.#setRoomStatus({ ...options, nextStatus: 'active', action: 'ROOM_RESUME' });
  }

  async #setRoomStatus({ actorId, roomId, requestId, reason, ipAddress = null, nextStatus, action }) {
    requireUuid(roomId, 'roomId');
    return executeMutation({
      actorId,
      requestId,
      reason,
      action,
      targetType: 'room',
      targetId: roomId,
      ipAddress,
      work: async client => {
        const roomResult = await client.query(
          'SELECT id, code, status, paused_at FROM rooms WHERE id = $1 FOR UPDATE',
          [roomId]
        );
        const room = roomResult.rows[0];
        if (!room) fail('ROOM_NOT_FOUND', 'Không tìm thấy phòng.');
        if (room.status === 'closed') fail('ROOM_CLOSED', 'Phòng đã đóng.');
        const expectedStatus = nextStatus === 'paused' ? 'active' : 'paused';
        if (room.status !== expectedStatus) {
          fail('ROOM_STATE_CONFLICT', `Phòng không ở trạng thái ${expectedStatus}.`);
        }
        if (nextStatus === 'active' && room.paused_at) {
          await client.query(`UPDATE rounds SET betting_deadline=betting_deadline+(CURRENT_TIMESTAMP-$2::timestamptz)
            WHERE room_id=$1 AND status='betting' AND betting_deadline IS NOT NULL`, [roomId, room.paused_at]);
        }
        const updated = await client.query(
          `UPDATE rooms SET status = $2::varchar, paused_at=CASE WHEN $2::varchar='paused' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id = $1
           RETURNING id, code, name, status`,
          [roomId, nextStatus]
        );
        return {
          result: { room: updated.rows[0] },
          changes: { status: { before: room.status, after: nextStatus } },
        };
      },
    });
  }

  async closeRoom({ actorId, roomId, requestId, reason, ipAddress = null } = {}) {
    requireUuid(roomId, 'roomId');
    return executeMutation({
      actorId,
      requestId,
      reason,
      action: 'ROOM_CLOSE',
      targetType: 'room',
      targetId: roomId,
      ipAddress,
      work: async (client, command) => {
        const roomResult = await client.query(
          'SELECT id, code, name, status FROM rooms WHERE id = $1 FOR UPDATE',
          [roomId]
        );
        const room = roomResult.rows[0];
        if (!room) fail('ROOM_NOT_FOUND', 'Không tìm thấy phòng.');
        if (room.status === 'closed') fail('ROOM_CLOSED', 'Phòng đã đóng.');
        const result = await closeRoomLocked(client, room, command);
        return {
          result,
          changes: { status: { before: room.status, after: 'closed' } },
        };
      },
    });
  }

  async scheduleRoundResult({ actorId, roomId, roundId, dice, requestId, reason, ipAddress = null } = {}) {
    requireUuid(roomId, 'roomId');
    requireUuid(roundId, 'roundId');
    const safeDice = validateDice(dice);
    return executeMutation({
      actorId,
      requestId,
      reason,
      action: 'ROUND_RESULT_SCHEDULE',
      input: { roomId, dice: safeDice },
      targetType: 'round',
      targetId: roundId,
      ipAddress,
      work: async client => {
        const roundResult = await client.query(
          `SELECT round.id, round.room_id, round.status, round.final_result,
                  round.admin_override_result, round.result_mode
           FROM rounds round
           JOIN rooms room ON room.id = round.room_id
           WHERE round.id = $1 AND round.room_id = $2
             AND room.status IN ('active', 'paused')
           FOR UPDATE OF round`,
          [roundId, roomId]
        );
        const round = roundResult.rows[0];
        if (!round) fail('ROUND_NOT_FOUND', 'Không tìm thấy ván hiện tại của phòng.');
        if (round.final_result !== null || !MUTABLE_RESULT_STATUSES.has(round.status)) {
          fail('ROUND_RESULT_FINAL', 'Kết quả ván đã chốt hoặc quá muộn để điều chỉnh.');
        }
        const updated = await client.query(
          `UPDATE rounds
           SET admin_override_result = $2, result_mode = 'admin_scheduled'
           WHERE id = $1 AND final_result IS NULL
           RETURNING id, room_id, status, result_mode, admin_override_result`,
          [roundId, JSON.stringify(safeDice)]
        );
        if (updated.rowCount !== 1) fail('ROUND_RESULT_FINAL', 'Kết quả ván đã chốt hoặc quá muộn để điều chỉnh.');
        return {
          result: {
            roundId,
            roomId,
            status: updated.rows[0].status,
            resultMode: updated.rows[0].result_mode,
            adminOverrideResult: updated.rows[0].admin_override_result,
          },
          changes: {
            resultMode: { before: round.result_mode, after: 'admin_scheduled' },
            adminOverrideResult: { before: round.admin_override_result, after: safeDice },
          },
        };
      },
    });
  }

  async clearRoundResult({ actorId, roomId, roundId, requestId, reason, ipAddress = null } = {}) {
    requireUuid(roomId, 'roomId');
    requireUuid(roundId, 'roundId');
    return executeMutation({
      actorId,
      requestId,
      reason,
      action: 'ROUND_RESULT_CLEAR',
      targetType: 'round',
      targetId: roundId,
      ipAddress,
      work: async client => {
        const roundResult = await client.query(
          `SELECT round.id, round.room_id, round.status, round.final_result,
                  round.admin_override_result, round.result_mode
           FROM rounds round
           JOIN rooms room ON room.id = round.room_id
           WHERE round.id = $1 AND round.room_id = $2
             AND room.status IN ('active', 'paused')
           FOR UPDATE OF round`,
          [roundId, roomId]
        );
        const round = roundResult.rows[0];
        if (!round) fail('ROUND_NOT_FOUND', 'Không tìm thấy ván hiện tại của phòng.');
        if (round.final_result !== null || !MUTABLE_RESULT_STATUSES.has(round.status)) {
          fail('ROUND_RESULT_FINAL', 'Kết quả ván đã chốt hoặc quá muộn để điều chỉnh.');
        }
        const updated = await client.query(
          `UPDATE rounds
           SET admin_override_result = NULL, result_mode = 'random'
           WHERE id = $1 AND final_result IS NULL
           RETURNING id, room_id, status, result_mode, admin_override_result`,
          [roundId]
        );
        if (updated.rowCount !== 1) fail('ROUND_RESULT_FINAL', 'Kết quả ván đã chốt hoặc quá muộn để điều chỉnh.');
        return {
          result: {
            roundId,
            roomId,
            status: updated.rows[0].status,
            resultMode: updated.rows[0].result_mode,
            adminOverrideResult: null,
          },
          changes: {
            resultMode: { before: round.result_mode, after: 'random' },
            adminOverrideResult: { before: round.admin_override_result, after: null },
          },
        };
      },
    });
  }

  async listAuditLogs({
    actorId,
    adminId = null,
    action = null,
    targetType = null,
    targetId = null,
    limit = 50,
    offset = 0,
  } = {}) {
    return useClient(async client => {
      await assertActiveAdmin(client, actorId);
      if (adminId !== null) requireUuid(adminId, 'adminId');
      if (targetId !== null) requireUuid(targetId, 'targetId');
      const page = normalizePage(limit, offset);
      const filters = [];
      const values = [];
      const add = (sql, value) => {
        values.push(value);
        filters.push(sql.replace('?', `$${values.length}`));
      };
      if (adminId) add('audit.admin_id = ?', adminId);
      if (action) add('audit.action = ?', action);
      if (targetType) add('audit.target_type = ?', targetType);
      if (targetId) add('audit.target_id = ?', targetId);
      const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
      const count = await client.query(
        `SELECT COUNT(*)::int AS total FROM admin_audit_logs audit ${where}`,
        values
      );
      const rows = await client.query(
        `SELECT audit.*, admin.username AS admin_username,
                admin.display_name AS admin_display_name
         FROM admin_audit_logs audit
         JOIN users admin ON admin.id = audit.admin_id
         ${where}
         ORDER BY audit.created_at DESC, audit.id DESC
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, page.limit, page.offset]
      );
      return {
        items: rows.rows.map(row => ({
          ...publicAudit(row),
          adminUsername: row.admin_username,
          adminDisplayName: row.admin_display_name,
        })),
        total: count.rows[0].total,
        ...page,
      };
    });
  }
}

export const adminService = new AdminService();

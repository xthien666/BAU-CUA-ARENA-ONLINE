-- ============================================================================
-- Migration: 002_align_schema_with_contract.sql
-- Cập nhật schema chuẩn hóa theo đúng tài liệu contract (phan-chia-cong-viec-database-bau-cua.docx)
-- ============================================================================

-- A3. Ledger chuẩn: bổ sung balance_before, balance_after, actor_id, idempotency_key, CHECK transaction_type
ALTER TABLE wallet_transactions
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS transaction_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS balance_before BIGINT,
  ADD COLUMN IF NOT EXISTS balance_after BIGINT,
  ADD COLUMN IF NOT EXISTS actor_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS room_id UUID,
  ADD COLUMN IF NOT EXISTS round_id UUID,
  ADD COLUMN IF NOT EXISTS reward_session_id UUID,
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(100),
  ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Cập nhật transaction_type từ type hiện tại (nếu có)
-- Lưu ý: phải dùng đúng tên trong contract docx: WELCOME / BET_DEBIT / BET_REFUND /
-- ROUND_PAYOUT / ADMIN_GRANT / AD_REWARD (không dùng BET_DEDUCT hay ROUND_SETTLE).
UPDATE wallet_transactions
SET transaction_type = CASE LOWER(type)
  WHEN 'bet_placed' THEN 'BET_DEBIT'
  WHEN 'bet_won' THEN 'ROUND_PAYOUT'
  WHEN 'ad_reward' THEN 'AD_REWARD'
  WHEN 'admin_adjustment' THEN 'ADMIN_GRANT'
  WHEN 'initial_grant' THEN 'WELCOME'
  WHEN 'welcome' THEN 'WELCOME'
  WHEN 'bet_debit' THEN 'BET_DEBIT'
  WHEN 'bet_refund' THEN 'BET_REFUND'
  WHEN 'round_payout' THEN 'ROUND_PAYOUT'
  WHEN 'admin_grant' THEN 'ADMIN_GRANT'
  ELSE 'WELCOME'
END
WHERE transaction_type IS NULL;

-- Bổ sung user_id từ wallet nếu trống
UPDATE wallet_transactions wt
SET user_id = w.user_id
FROM wallets w
WHERE wt.wallet_id = w.id AND wt.user_id IS NULL;

-- Unique index cho idempotency_key theo user_id (chống xử lý lặp)
CREATE UNIQUE INDEX IF NOT EXISTS idx_txn_idempotency
  ON wallet_transactions(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- A4: Bảng player_round_results (Lưu kết quả chi tiết từng ván của mỗi người chơi)
CREATE TABLE IF NOT EXISTS player_round_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  total_bet BIGINT NOT NULL DEFAULT 0,
  total_return BIGINT NOT NULL DEFAULT 0,
  net_gain BIGINT NOT NULL DEFAULT 0, -- return - bet
  outcome VARCHAR(20) NOT NULL, -- 'win', 'loss', 'draw'
  settled_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT unique_player_round_result UNIQUE(round_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_prr_user_id ON player_round_results(user_id);
CREATE INDEX IF NOT EXISTS idx_prr_room_id ON player_round_results(room_id);
CREATE INDEX IF NOT EXISTS idx_prr_settled_at ON player_round_results(settled_at);

-- A4: Bảng processed_commands (Chống trùng lặp lệnh Socket.IO theo room/user)
CREATE TABLE IF NOT EXISTS processed_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  command_key VARCHAR(150) NOT NULL UNIQUE, -- e.g. "bet:add:{round_id}:{user_id}:{request_id}"
  room_id UUID,
  user_id UUID REFERENCES users(id),
  command_type VARCHAR(50) NOT NULL,
  result_payload JSONB,
  processed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_proc_cmd_key ON processed_commands(command_key);
CREATE INDEX IF NOT EXISTS idx_proc_cmd_room ON processed_commands(room_id);

-- A4: View player_profiles cho Phần B (Alias chuẩn từ users + wallets)
CREATE OR REPLACE VIEW player_profiles AS
SELECT 
  u.id AS user_id,
  u.username,
  u.email,
  u.display_name,
  u.avatar_key,
  u.role,
  u.status,
  w.id AS wallet_id,
  w.balance,
  w.version AS wallet_version,
  u.created_at,
  u.updated_at
FROM users u
JOIN wallets w ON u.id = w.user_id;

-- A4: Unique index đảm bảo một user chỉ có 1 active room_membership duy nhất trong MVP
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_membership
  ON room_members(user_id)
  WHERE left_at IS NULL;

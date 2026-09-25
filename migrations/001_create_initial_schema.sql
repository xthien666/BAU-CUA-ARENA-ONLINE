-- ============================================================================
-- Migration: 001_create_initial_schema.sql
-- Description: Khởi tạo 11 bảng cốt lõi cho Bầu Cua Arena (Database Foundation)
-- Lưu ý: Toàn bộ số dư (balance) và giao dịch (amount) là XU ẢO trong trò chơi,
--        tuyệt đối không có giá trị quy đổi hoặc liên kết thanh toán thật.
-- ============================================================================

-- Bật extension tạo UUID
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. users: Tài khoản người chơi
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(50) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  avatar_key VARCHAR(50) DEFAULT 'avatar_default',
  role VARCHAR(20) NOT NULL DEFAULT 'player', -- 'player', 'admin'
  status VARCHAR(20) NOT NULL DEFAULT 'active', -- 'active', 'banned', 'deleted'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP WITH TIME ZONE,
  
  CONSTRAINT email_lowercase CHECK (email = LOWER(email)),
  CONSTRAINT username_length CHECK (LENGTH(username) >= 3)
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(LOWER(username));
CREATE INDEX IF NOT EXISTS idx_users_email ON users(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- 2. wallets: Ví xu ảo chính của người chơi
CREATE TABLE IF NOT EXISTS wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  balance BIGINT NOT NULL DEFAULT 100000, -- 100.000 xu ảo khởi tạo mặc định
  version INT NOT NULL DEFAULT 1, -- Dành cho Optimistic Locking
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT balance_non_negative CHECK (balance >= 0)
);

CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);

-- 3. wallet_transactions: Lịch sử biến động xu ảo
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  amount BIGINT NOT NULL, -- Giá trị biến động (+ cộng xu ảo, - trừ xu ảo)
  type VARCHAR(50) NOT NULL, -- 'bet_placed', 'bet_won', 'ad_reward', 'admin_adjustment', 'initial_grant'
  reason VARCHAR(255),
  reference_id VARCHAR(100), -- round_id, ad_session_id, admin_audit_id,...
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_wallet_txns_wallet_id ON wallet_transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_wallet_txns_created_at ON wallet_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_wallet_txns_type ON wallet_transactions(type);

-- 4. auth_sessions: Quản lý phiên đăng nhập
CREATE TABLE IF NOT EXISTS auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  ip_address VARCHAR(45),
  user_agent TEXT,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_token_hash ON auth_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at);

-- 5. account_tokens: Token khôi phục mật khẩu hoặc xác thực
CREATE TABLE IF NOT EXISTS account_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  type VARCHAR(50) NOT NULL, -- 'password_reset', 'email_verify'
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_account_tokens_token_hash ON account_tokens(token_hash);

-- 6. rooms: Phòng chơi
CREATE TABLE IF NOT EXISTS rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(10) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  host_id UUID NOT NULL REFERENCES users(id),
  capacity INT NOT NULL DEFAULT 20,
  betting_duration INT NOT NULL DEFAULT 30, -- Giây
  status VARCHAR(20) NOT NULL DEFAULT 'active', -- 'active', 'paused', 'closed'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_rooms_code ON rooms(code);
CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);

-- 7. room_members: Người tham gia phòng chơi
CREATE TABLE IF NOT EXISTS room_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL DEFAULT 'player', -- 'host', 'player'
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  left_at TIMESTAMP WITH TIME ZONE,
  
  CONSTRAINT unique_active_room_member UNIQUE(room_id, user_id, left_at)
);

CREATE INDEX IF NOT EXISTS idx_room_members_room_id ON room_members(room_id);
CREATE INDEX IF NOT EXISTS idx_room_members_user_id ON room_members(user_id);

-- 8. rounds: Ván cược bầu cua
CREATE TABLE IF NOT EXISTS rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  round_number INT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'betting', -- 'betting', 'shaking', 'settled', 'cancelled'
  dice JSONB, -- Ví dụ: ["bau", "cua", "tom"]
  started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  settled_at TIMESTAMP WITH TIME ZONE,
  
  CONSTRAINT unique_room_round_number UNIQUE(room_id, round_number)
);

CREATE INDEX IF NOT EXISTS idx_rounds_room_id ON rounds(room_id);
CREATE INDEX IF NOT EXISTS idx_rounds_status ON rounds(status);

-- 9. bets: Chi tiết đặt cược xu ảo của người chơi
CREATE TABLE IF NOT EXISTS bets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol VARCHAR(20) NOT NULL, -- 'bau', 'cua', 'tom', 'ca', 'ga', 'nai'
  amount BIGINT NOT NULL, -- Số lượng xu ảo đặt cược
  payout BIGINT DEFAULT 0, -- Số lượng xu ảo nhận về sau ván (bao gồm hoàn cược)
  request_id VARCHAR(100), -- Khóa phòng ngừa duplicate đặt cược
  status VARCHAR(20) NOT NULL DEFAULT 'placed', -- 'placed', 'won', 'lost', 'cancelled'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT bet_amount_positive CHECK (amount > 0),
  CONSTRAINT unique_round_user_symbol_request UNIQUE(round_id, user_id, symbol, request_id)
);

CREATE INDEX IF NOT EXISTS idx_bets_round_id ON bets(round_id);
CREATE INDEX IF NOT EXISTS idx_bets_user_id ON bets(user_id);

-- 10. ad_reward_sessions: Phiên nhận xu ảo thưởng từ việc xem quảng cáo
CREATE TABLE IF NOT EXISTS ad_reward_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reward_amount BIGINT NOT NULL DEFAULT 10000, -- Xu ảo thưởng
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'claimed', 'rejected'
  claimed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ad_reward_sessions_user_id ON ad_reward_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_ad_reward_sessions_created_at ON ad_reward_sessions(created_at);

-- 11. admin_audit_logs: Nhật ký thao tác quản trị viên
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES users(id),
  action VARCHAR(100) NOT NULL, -- 'grant_coins', 'ban_user', 'change_room_status',...
  target_id UUID,
  details JSONB,
  ip_address VARCHAR(45),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_admin_id ON admin_audit_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at ON admin_audit_logs(created_at);

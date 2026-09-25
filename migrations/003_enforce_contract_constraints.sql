-- ============================================================================
-- Migration: 003_enforce_contract_constraints.sql
-- Bổ sung các CHECK/UNIQUE constraint còn THIẾU so với contract docx.
-- 001/002 mới chỉ bổ sung cột mà chưa ràng buộc chặt chẽ.
-- ============================================================================

-- 1. transaction_type bắt buộc NOT NULL + CHECK đúng danh sách hợp lệ (contract A3)
-- Luôn gán lại từ `type` legacy trước khi chuyển NOT NULL: migration 002 có thể đã
-- tạo bản ghi mới (do test) mà chưa có transaction_type, và có bản ghi
-- bị map sai (ROUND_SETTLE/BET_DEDUCT cũ) cần chỉnh lại.
UPDATE wallet_transactions SET transaction_type = 'BET_DEBIT' WHERE transaction_type = 'BET_DEDUCT';
UPDATE wallet_transactions SET transaction_type = 'ROUND_PAYOUT' WHERE transaction_type = 'ROUND_SETTLE';
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

ALTER TABLE wallet_transactions
  ALTER COLUMN transaction_type SET NOT NULL;

ALTER TABLE wallet_transactions
  ADD CONSTRAINT txn_type_valid CHECK (transaction_type IN (
    'WELCOME', 'BET_DEBIT', 'BET_REFUND', 'ROUND_PAYOUT', 'ADMIN_GRANT', 'AD_REWARD'
  ));

-- 2. amount khac 0 (contract A3)
ALTER TABLE wallet_transactions
  ADD CONSTRAINT txn_amount_valid CHECK (amount != 0);

-- 3. bet chi tren 6 bieu tuong hop le (contract: bets.symbol_valid)
ALTER TABLE bets
  ADD CONSTRAINT bet_symbol_valid CHECK (symbol IN ('bau', 'cua', 'tom', 'ca', 'ga', 'nai'));

-- 4. outcome chi nhin trong 3 gia tri (contract A4)
ALTER TABLE player_round_results
  ADD CONSTRAINT prr_outcome_valid CHECK (outcome IN ('win', 'loss', 'draw'));

-- 5. round status hop le (contract A4: waiting/betting/revealing/result/settled)
ALTER TABLE rounds
  ADD CONSTRAINT round_status_valid CHECK (status IN ('waiting', 'betting', 'revealing', 'result', 'settled', 'cancelled'));

-- 6. bet khong cho dat cua user khac phong (FK phong -> user) — bao dam thanh vien
ALTER TABLE bets
  ADD CONSTRAINT bet_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- 7. games_played / stats khong am cho player_profiles view — bo sung bang tong hop
-- (statistics duoc tinh truc tiep tu player_round_results nen khong can bang rieng)

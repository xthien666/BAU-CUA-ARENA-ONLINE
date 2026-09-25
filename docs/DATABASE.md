# HƯỚNG DẪN DATABASE FOUNDATION (PHẦN A)
## Dự án Bầu Cua Arena — Tầng Dữ Liệu PostgreSQL

Tài liệu này bàn giao toàn bộ nền tảng Database, Schema chuẩn hóa và các Service/Repository của **Phần A** để người phụ trách **Phần B (Game Integration)** sử dụng.

---

## 1. Nguyên Tắc Cốt Lõi (Đã Thống Nhất Theo Contract Docx)

- **Xu ảo giải trí:** Toàn bộ `balance` trong ví và giao dịch (`amount`) là tiền xu ảo trong game, không có giá trị quy đổi và tuyệt đối không tích hợp cổng thanh toán.
- **Mỗi User đúng 1 Wallet:** Một tài khoản chỉ có một ví duy nhất (`wallets.user_id` UNIQUE). Đổi phòng hoặc đăng nhập lại không cấp lại ví mới.
- **Mỗi User tối đa 1 Active Room Membership:** Một tài khoản chỉ được tham gia 1 phòng chơi tại một thời điểm (`idx_unique_active_membership`).
- **Ledger chuẩn & Idempotent:** Mọi thao tác đổi xu phải ghi sổ cái `wallet_transactions` kèm `idempotency_key`, `balance_before`, `balance_after`, và `transaction_type` thuộc danh sách cố định:
  `WELCOME | BET_DEBIT | BET_REFUND | ROUND_PAYOUT | ADMIN_GRANT | AD_REWARD`
- **Không tin Client:** Server quyết định số dư cuối cùng; ACK và Room Broadcast chỉ được gửi **sau khi** Database transaction đã commit thành công.

---

## 2. Cấu Trúc Bảng CSDL (Schema Reference)

Hệ thống có **14 bảng chính + 1 view**:

| Tên Bảng / View | Mục Đích | Ràng Buộc Quan Trọng |
|---|---|---|
| `users` | Tài khoản người chơi | `email` lowercase, `username` >= 3 ký tự |
| `wallets` | Ví xu ảo duy nhất của từng user | `user_id` UNIQUE, `balance >= 0`, `version` (optimistic locking) |
| `wallet_transactions` | Sổ cái lưu lịch sử biến động xu | `user_id + idempotency_key` UNIQUE INDEX, `amount != 0`, `transaction_type CHECK` |
| `player_profiles` *(VIEW)* | Alias kết hợp `users` + `wallets` | Dùng cho Phần B lấy nhanh profile + balance + version |
| `auth_sessions` | Phiên đăng nhập | `token_hash` UNIQUE, `expires_at` |
| `account_tokens` | Token verify / reset password | `type CHECK ('email_verify', 'password_reset')` |
| `rooms` | Phòng chơi | `code` UNIQUE |
| `room_members` | Thành viên tham gia phòng | `user_id` UNIQUE khi `left_at IS NULL` (1 active room per player) |
| `rounds` | Ván cược bầu cua | `room_id + round_number` UNIQUE, `status CHECK` |
| `bets` | Chi tiết cược xu ảo | `symbol CHECK ('bau','cua','tom','ca','ga','nai')`, `amount > 0` |
| `player_round_results` | Tổng kết thắng/thua từng ván của mỗi user | `round_id + user_id` UNIQUE, `outcome CHECK ('win','loss','draw')` |
| `processed_commands` | Chống trùng lặp lệnh Socket.IO | `command_key` UNIQUE |
| `ad_reward_sessions` | Phiên xem quảng cáo nhận xu ảo | `status CHECK ('pending','completed','claimed','rejected','expired')` |
| `admin_audit_logs` | Nhật ký thao tác quản trị | Trút log hành động admin (`grant_coins`, `ban_user`, v.v.) |
| `schema_migrations` | Quản lý phiên bản migration | `filename` UNIQUE, `checksum` SHA256 |

---

## 3. Hướng Dẫn Cài Đặt & Migration

### Cấu hình môi trường (`.env`)
```env
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME_DEV=bau_cua_dev
DB_NAME_TEST=bau_cua_test
# Hoặc dùng chuỗi kết nối đơn:
# DATABASE_URL=postgresql://postgres:your_password@localhost:5432/bau_cua_dev
```

### Lệnh Quản Lý CSDL
```bash
# Chạy toàn bộ migrations (001 -> 002 -> 003) tự động theo thứ tự
npm run db:migrate

# Chạy toàn bộ Test Suite (45/45 tests pass)
npm test
```

---

## 4. API & Repositories Bàn Giao Cho Phần B

### 4.1. `WalletService` (`src/services/WalletService.js`)
Service chính xử lý tiền xu và sổ cái an toàn (có row-lock `FOR UPDATE` + DB transaction):
```js
import { WalletService } from './src/services/WalletService.js';

// Cấp 100.000 xu chào mừng (chỉ thực hiện đúng 1 lần / user)
await WalletService.createWalletWithWelcomeGrant(userId);

// Trừ xu khi cược (chống trừ 2 lần nếu retry cùng requestId)
await WalletService.debitBet({ userId, amount: 20000, roomId, roundId, requestId });

// Hoàn xu khi huỷ ván
await WalletService.refundBet({ userId, amount: 20000, roomId, roundId, requestId });

// Trả thưởng khi ván có kết quả
await WalletService.payoutRound({ userId, amount: 60000, roomId, roundId });

// Admin cấp xu
await WalletService.adminGrant({ userId, amount: 50000, actorId: adminUserId, reason: 'Event reward' });
```

### 4.2. `ProcessedCommandRepository` (`src/repositories/ProcessedCommandRepository.js`)
Đảm bảo lệnh Socket.IO chỉ chạy đúng một lần:
```js
import { ProcessedCommandRepository } from './src/repositories/ProcessedCommandRepository.js';
const cmdRepo = new ProcessedCommandRepository();

const { isDuplicate, command } = await cmdRepo.recordCommand({
  commandKey: `bet:add:${roundId}:${userId}:${requestId}`,
  roomId,
  userId,
  commandType: 'bet:add',
  resultPayload: { success: true },
});
if (isDuplicate) return command.result_payload;
```

### 4.3. `HistoryRepository` & `StatisticsRepository`
```js
import { HistoryRepository } from './src/repositories/HistoryRepository.js';
import { StatisticsRepository } from './src/repositories/StatisticsRepository.js';

// Lưu kết quả ván cho người chơi sau settlement
const historyRepo = new HistoryRepository();
await historyRepo.recordPlayerRoundResult({ roundId, userId, roomId, totalBet, totalReturn, outcome: 'win' });

// Lấy lịch sử cược cá nhân (phân trang, mới nhất xếp trước)
const history = await historyRepo.getUserRoundHistory(userId, limit, offset);

// Thống kê cá nhân (gamesPlayed, wins, losses, breakEven, totalBet, totalReturned, netProfit)
const userStats = await StatisticsRepository.getUserStatistics(userId);

// Thống kê tần suất mặt xúc xắc từ các ván ĐÃ HOÀN TẤT (dùng cho frontend)
const symbolStats = await StatisticsRepository.getSymbolStatistics(roomId);
```

### 4.4. `AuditLogger` (`src/db/AuditLogger.js`)
```js
import { AuditLogger } from './src/db/AuditLogger.js';

await AuditLogger.logAdminAction({
  adminId,
  action: 'grant_coins',
  targetType: 'user',
  targetId: userId,
  reason: 'Sự kiện',
  changes: { amount: 50000 },
  ipAddress: '127.0.0.1',
});
```

---

## 5. Danh Sách Unit & Integration Tests (45/45 Passed)

- `tests/db/connection.test.js`: Kết nối PostgreSQL & kiểm tra 11+ bảng.
- `tests/db/repository.test.js`: CRUD chuẩn với Base Repository.
- `tests/db/audit.test.js`: Thao tác ghi nhật ký admin.
- `tests/repositories/user.test.js`: Tạo user, tìm kiếm case-insensitive, đổi trạng thái.
- `tests/repositories/wallet.test.js`: Thao tác ví nguyên tử & row lock.
- `tests/repositories/history_stats.test.js`: Lịch sử ván, thống kê thắng/thua & tần suất xúc xắc.
- `tests/repositories/integration.test.js`: Chuỗi luồng người chơi gia nhập phòng -> đặt cược -> chốt kết quả.
- `tests/services/walletService.test.js`: Idempotency chào mừng, trừ/hoàn/trả thưởng xu cược.

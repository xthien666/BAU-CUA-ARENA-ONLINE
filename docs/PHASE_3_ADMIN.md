# Giai đoạn 3 — Admin: bàn giao local

Cập nhật ngày 01/10/2026. Bản này chạy một Node server và PostgreSQL, không phải bản phát hành production đã được nghiệm thu.

## Trạng thái các giai đoạn

| Giai đoạn | Trạng thái |
|---|---|
| 1 — Database nền tảng | Migration, ràng buộc, ví/sổ giao dịch, repositories và kiểm thử PostgreSQL đã chạy. |
| 2 — Tài khoản và ví chung | Đăng ký/đăng nhập thật, cookie/CSRF, ví bền vững, Socket.IO theo userId, hồ sơ/lịch sử, thu hồi phiên, email token đã nối UI/API. SMTP thật chưa cấu hình. |
| 3 — Admin | Service/API và `/admin` đã triển khai, kiểm thử local; bắt buộc Admin hệ thống + TOTP MFA. Chưa tạo Admin sử dụng thật thay người vận hành. |
| 4 — Quảng cáo thưởng | Chưa triển khai; cần chọn provider rewarded web và cách xác minh trước. |

## Đã thực hiện

- Trang **Dọn dữ liệu** cho phép chọn thời hạn, xem trước và xác nhận xóa vĩnh viễn phòng đã đóng, người chơi đã xóa mềm và nhật ký cũ. Giữ Admin/dữ liệu đang hoạt động; xem [quy tắc và cách sử dụng](ADMIN_DATABASE_CLEANUP.md). Chạy migration mới trước khi khởi động backend phiên bản này.

- Tổng quan: kết nối/phòng thực từ engine; số tài khoản, cược chờ, ván quá hạn, xu cấp/thưởng từ DB. Phiên đăng nhập không được gọi là số người online.
- Tìm người theo ID/username/email/tên hiển thị; xem ví, cược chờ và giao dịch gần đây; ban/gỡ ban/xóa mềm có lý do. Ban có hạn tự hết khi đăng nhập lại; các phiên đã thu hồi không sống lại.
- Cấp xu qua ledger, hiển thị số dư trước/sau, dự phòng khả năng trả thưởng; requestId chống cấp lại và từ chối dùng cùng mã cho nội dung khác.
- Xem host/thành viên/pha/deadline; kick, khóa người mới, tạm dừng/tiếp tục, chỉnh 15/30/45/60 giây cho ván sau, hủy ván hoặc đóng phòng.
- Đặt/đổi/bỏ kết quả theo đúng roomId + roundId trước final_result; không sửa ván đã chốt. Override không được gửi trong snapshot công khai trước chốt.
- Audit nội bộ cùng transaction nghiệp vụ; failure của audit làm rollback thao tác.
- Kick/ban/xóa trong pha cược hoàn tiền; pha đã khóa giữ cược để thanh toán. Đóng/hủy ván chưa chốt hoàn một lần; các API và timer dùng cùng hàng đợi phòng.
- Host không cấp xu/reset/chọn kết quả/thay thời gian; host kick không được nhằm vào Admin hệ thống. Host kick lưu command và hoàn cược + rời membership cùng transaction.
- Argon2id, session và CSRF token chỉ lưu băm; cookie HttpOnly, SameSite=Lax, Secure ở production. Logout/đổi mật khẩu/ban thu hồi DB session và ngắt socket đang dùng.
- MFA secret mã hóa AES-GCM, kiểm tra mã TOTP, từ chối mã đã dùng, khóa thử mã sau 5 lần sai trong 15 phút. MFA được xác minh riêng cho mỗi phiên Admin.
- Hồ sơ và ví ở sảnh: tên/avatar có sẵn, ngày tham gia/thống kê, lịch sử xu phân trang, lịch sử ván, đổi mật khẩu, đăng xuất mọi thiết bị.

## Khởi động và tạo Admin

Chạy PowerShell trong thư mục dự án, **không chạy các lệnh npm trong `postgres=#`**:

```powershell
npm run db:migrate
npm run test:all
npm start
```

Mở `http://localhost:3000/admin`. Tạo Admin lần đầu trong terminal khác; thay username/email/tên theo thông tin thật của bạn:

Khi phát triển, có thể dùng `npm run dev` rồi mở `http://localhost:5173/admin`. Lệnh này chạy cả Vite và backend PostgreSQL có đăng nhập/Admin; không cần chạy thêm `npm run dev:server`. Sau khi cập nhật launcher, dừng tiến trình dev cũ rồi chạy lại. Không đặt `PERSISTENCE_ENABLED=false` khi dùng tài khoản/Admin: chế độ RAM cũ không có các API này.

```powershell
$adminPassword = Read-Host 'Mật khẩu Admin mới (ít nhất 12 ký tự)' -AsSecureString
$env:ADMIN_BOOTSTRAP_PASSWORD = [System.Net.NetworkCredential]::new('', $adminPassword).Password
try {
  npm run admin:create -- admin admin@example.com 'Quan tri vien'
} finally {
  Remove-Item Env:ADMIN_BOOTSTRAP_PASSWORD -ErrorAction SilentlyContinue
}
```

Không dùng lại mật khẩu PostgreSQL làm mật khẩu Admin. Script không biến tài khoản đăng ký công khai thành Admin; phiên bootstrap bị thu hồi. Nếu đã có Admin hoạt động, script dừng; chỉ đặt `ALLOW_ADDITIONAL_ADMIN=true` khi chủ ý tạo thêm.

Đăng nhập `/admin`, chọn tạo khóa Authenticator, thêm **khóa thiết lập theo thời gian** vào ứng dụng Authenticator rồi nhập mã 6 số. Khi đăng nhập phiên mới, nhập mã MFA mới; mã đã dùng không sử dụng lại trong cùng chu kỳ 30 giây. Giữ đồng hồ máy/server đồng bộ.

Mất Authenticator: người có quyền vận hành server chạy `npm run admin:mfa-reset -- admin`. Lệnh này xóa cấu hình MFA, thu hồi toàn bộ phiên và ghi audit; sau đó phải thiết lập lại. Không có API công khai bỏ qua MFA.

## Cấu hình cần bảo vệ

- `.env` local đã có `MFA_ENCRYPTION_KEY` ngẫu nhiên riêng và được Git bỏ qua. Khóa phải giữ ổn định và backup cùng cấu hình bảo mật; đổi/mất khóa làm secret đã mã hóa không giải được. Production bắt buộc khóa base64url 32 byte; development có fallback nhưng không dùng fallback khi public.
- SMTP: cấu hình `PUBLIC_APP_URL`, `SMTP_HOST`, `SMTP_FROM`, `SMTP_PORT`, `SMTP_SECURE` và thông tin đăng nhập theo `.env.example`. Production PUBLIC_APP_URL phải HTTPS. Chưa gửi thử email thật trong đợt này.
- Xác minh email trước khôi phục mật khẩu. Token một lần, hạn 30 phút; DB lưu băm, link dùng fragment được frontend bỏ khỏi URL. Reset không gỡ ban tài khoản.
- Chưa SMTP: request email trả `EMAIL_NOT_CONFIGURED` (503). Thư gửi thất bại không chứng minh đã giao thư; cần giám sát SMTP khi triển khai.
- Session: hạn tuyệt đối 7 ngày, hết hạn không hoạt động 30 phút; đăng nhập sai mặc định 5 lần/tài khoản hoặc 20 lần/IP trong 15 phút. Các giá trị này là mặc định bản đầu.

## API chính

| Nhóm | Đường dẫn |
|---|---|
| Tài khoản | `/api/auth/register`, `login`, `me`, `logout`, `logout-all`, `change-password` |
| Email | `/api/auth/email-verification/request`, `confirm`; `/api/auth/password-reset/request`, `confirm` |
| MFA | `/api/auth/mfa/status`, `setup`, `verify-setup`, `verify` |
| Hồ sơ/ví/lịch sử | `/api/me`, `/api/me/profile`, `/api/me/wallet/transactions`, `/api/me/history`, `/api/me/stats` |
| Admin tổng quan | `/api/admin/overview` |
| Admin người chơi | `/api/admin/users`, `/:id`, `/:id/grants`, `/:id/ban`, `/:id/unban` |
| Admin phòng | `/api/admin/rooms`, `/:id/status`, `/:id/lock`, `/:id/betting-duration`, `/:id/members/:userId/kick` |
| Admin ván | `/api/admin/rounds/:id/override`, `/:id/cancel` — body luôn có roomId |
| Audit | `/api/admin/audit-logs` |

Thay đổi dữ liệu cần cookie + `X-CSRF-Token`; mọi lệnh Admin cần MFA đã xác minh, lý do 3–255 ký tự và requestId. Danh tính không lấy từ userId/role/số dư gửi từ client.

## Nghiệm thu local và bước kế tiếp

- `npm run test:all`: **105/105** (49 core + 56 DB), không skip; `npm run build` thành công. Có kiểm thử launcher development, proxy API đăng nhập/Admin và hộp thoại nhập lý do/xác nhận/hủy tương thích trình duyệt nhúng.
- Browser QA dùng tài khoản tạm trên **bau_cua_test**, kiểm tra đăng nhập/MFA, tìm tài khoản, cấp xu 100.000 → 112.000, audit và lưu hồ sơ. Hai tài khoản QA và các bản ghi liên quan đã dọn, không tạo Admin thật trong dev.
- Migration `001`–`007` đã áp dụng trên dev/test. Không sửa migration đã chạy; nâng schema bằng file tiếp theo.
- Đây không thay thế security audit, stress test Internet hoặc diễn tập restore backup.

Trước mở Internet: chọn hosting/HTTPS và tài khoản DB hạn quyền; cấu hình SMTP + thử giao thư; bảo vệ/backup khóa MFA; thử backup/restore và đối soát; chốt điều khoản nghiên cứu, lưu đồng ý tham gia trước chơi; thêm hạn mức đăng ký/chống abuse và cấu hình IP thật qua reverse proxy đáng tin. Không phát hành công khai khi chưa có điều khoản về khả năng Admin điều chỉnh kết quả.

Sau đó triển khai Giai đoạn 4: chọn provider, lượt thưởng có hạn, bằng chứng xác minh, chống callback lặp, hạn mức/cooldown nguyên tử và trang quản trị quảng cáo. Không dùng timer trình duyệt giả làm bằng chứng xem quảng cáo.

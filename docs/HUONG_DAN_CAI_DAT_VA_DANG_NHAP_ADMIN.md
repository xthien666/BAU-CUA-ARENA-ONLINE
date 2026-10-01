# Hướng dẫn cài đặt và đăng nhập Admin web — Bầu Cua Victory

Tài liệu dành cho thành viên nhóm sử dụng Windows. Làm theo thứ tự để chạy
PostgreSQL trong Docker, cấu hình dự án, tạo tài khoản Admin và đăng nhập web.
Các lệnh bên dưới dùng **PowerShell**; lệnh `npm.cmd` tránh lỗi chặn `npm.ps1`.

## 1. Chọn cách sử dụng

| Cách sử dụng | Các bước cần làm |
|---|---|
| Cài dự án trên máy cá nhân | Làm từ mục 2 đến mục 8. Mỗi máy có database và tài khoản riêng. |
| Truy cập web do một thành viên đang chạy | Đọc mục 10. Máy truy cập chỉ cần trình duyệt và Authenticator. |
| Đã cài và chỉ muốn đăng nhập lại | Làm mục 9 rồi đăng nhập theo mục 8. |

Sao chép source code không sao chép database, tài khoản hoặc cấu hình `.env`.
Tài khoản của máy chủ chỉ dùng được khi truy cập đúng web của máy chủ đó.
Nếu khôi phục database có sẵn, giữ nguyên `MFA_ENCRYPTION_KEY` tương ứng với
database để đọc được cấu hình MFA cũ.

## 2. Cài môi trường trên máy mới

### Node.js

1. Cài **Node.js 24.x** từ [trang Node.js](https://nodejs.org/en/download).
2. Mở PowerShell mới và kiểm tra:

```powershell
node --version
npm.cmd --version
```

Kết quả Node phải bắt đầu bằng `v24.`. Dự án khai báo Node từ 24 đến dưới 25
trong `package.json`.

### Docker Desktop và WSL 2

1. Mở PowerShell bằng **Run as administrator**, kiểm tra WSL:

```powershell
wsl --version
```

2. Nếu chưa có WSL, chạy `wsl --install`; nếu đã có, chạy `wsl --update`.
   Khởi động lại Windows nếu được yêu cầu.
3. Cài Docker Desktop theo [hướng dẫn chính thức trên Windows](https://docs.docker.com/desktop/setup/install/windows-install/).
   Chọn WSL 2 khi trình cài đặt cho lựa chọn backend.
4. Mở Docker Desktop, chờ engine chạy rồi kiểm tra trong PowerShell mới:

```powershell
docker --version
docker compose version
docker run --rm hello-world
```

Thấy `Hello from Docker!` nghĩa là Docker đã chạy được container. Nếu Docker
báo lỗi WSL hoặc virtualization, làm theo yêu cầu hiển thị trong Docker Desktop
trước khi tiếp tục. Không cần cài PostgreSQL trực tiếp trên Windows cho luồng này.

## 3. Nhận source code và mở đúng thư mục

Nhận bản source mới nhất từ repository hoặc bản bàn giao của nhóm. Bản này cần có
`package.json`, `package-lock.json`, `.env.example`, `compose.yaml`, `server/`,
`src/`, `migrations/` và `docker/postgres/`.

Trong PowerShell, chuyển đến thư mục dự án trên máy của mình. Ví dụ:

```powershell
Set-Location 'C:\DuAn\Bau Cua victory'
Test-Path .\package.json
Test-Path .\compose.yaml
```

Thay đường dẫn ví dụ bằng đường dẫn thật. Cả hai kiểm tra phải trả về `True`.
Không chạy `npm` tại `C:\Windows\System32` hoặc trong dấu nhắc `postgres=#`.
Nếu đang ở psql, nhập `\q` để thoát.

## 4. Tạo và cấu hình `.env`

Tạo `.env` từ file mẫu nếu chưa có:

```powershell
if (-not (Test-Path .\.env)) {
    Copy-Item .\.env.example .\.env
}
notepad .\.env
```

Trên **máy mới với database mới**, cấu hình các dòng sau. Thay các giá trị
`THAY_...` trước khi chạy dự án; không chép nguyên giá trị mẫu để sử dụng.

```env
DB_HOST=127.0.0.1
DB_PORT=5433
DB_USER=postgres
DB_PASSWORD=THAY_BANG_MAT_KHAU_DATABASE_CUA_BAN
DB_NAME_DEV=bau_cua_dev
DB_NAME_TEST=bau_cua_test
DOCKER_DB_PASSWORD=THAY_BANG_MAT_KHAU_DATABASE_CUA_BAN
PORT=3000
MFA_ENCRYPTION_KEY=THAY_BANG_KHOA_MFA_DA_SINH
```

`DB_PASSWORD` và `DOCKER_DB_PASSWORD` phải giống nhau. Đây là mật khẩu database,
không phải mật khẩu đăng nhập Admin web. Chỉ để một dòng đang hoạt động cho mỗi
biến trong `.env`.

Sinh khóa MFA bằng lệnh sau, rồi dán kết quả vào `MFA_ENCRYPTION_KEY`:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Chỉ sinh khóa mới khi thiết lập database mới. Giữ khóa ổn định qua các lần chạy;
không sinh lại mỗi lần đăng nhập hoặc ghi đè khóa của database đã có MFA.
Không commit `.env`, mật khẩu hoặc khóa MFA vào Git.

Nếu `.env` hoặc `.env.test` có `DATABASE_URL` / `TEST_DATABASE_URL` cũ, hãy bỏ
hoặc comment các dòng đó khi dùng cấu hình trên. Code ưu tiên URL kết nối hơn
các biến `DB_*`. Không đặt `PERSISTENCE_ENABLED=false` vì Admin cần backend
PostgreSQL có xác thực.

## 5. Khởi động PostgreSQL và cài thư viện

Mở Docker Desktop trước, sau đó chạy tại thư mục dự án:

```powershell
docker compose up -d --wait
docker compose ps
npm.cmd ci
npm.cmd run db:migrate
```

Chạy lần lượt từng lệnh và xử lý lỗi trước khi tiếp tục. Kết quả mong đợi:

- Dịch vụ `postgres` dùng image `postgres:18.6`, trạng thái `healthy`.
- Cổng kết nối từ Windows là `127.0.0.1:5433`.
- Migration báo đã áp dụng thành công hoặc database đã ở phiên bản mới nhất.

Compose tạo `bau_cua_dev`; script khởi tạo tạo `bau_cua_test` khi volume còn
trống. Không cần tự chạy các file SQL migration bằng tay.

Có thể kiểm tra kết nối PostgreSQL:

```powershell
docker compose exec postgres psql -U postgres -d bau_cua_dev -c "SELECT current_database();"
```

Trước buổi demo, chạy kiểm thử trên database test:

```powershell
npm.cmd run test:all
```

Runner tự migrate DB test và yêu cầu tên DB có dấu hiệu `test`. Không đổi cấu
hình test sang database development đang giữ tài khoản của nhóm.

## 6. Tạo tài khoản Admin đầu tiên

Bỏ qua bước này nếu đã có tài khoản Admin và bạn biết thông tin đăng nhập.
Tài khoản đăng ký từ giao diện game có vai trò `player`; chủ phòng game cũng
không tự có quyền Admin hệ thống.

Để tạo Admin trên database mới, chạy trong PowerShell tại thư mục dự án:

```powershell
$adminUsername = Read-Host 'Ten dang nhap Admin moi'
$adminEmail = Read-Host 'Email Admin'
$adminDisplayName = Read-Host 'Ten hien thi'
$adminPassword = Read-Host 'Mat khau Admin moi (it nhat 12 ky tu)' -AsSecureString

$env:ADMIN_BOOTSTRAP_PASSWORD = [System.Net.NetworkCredential]::new('', $adminPassword).Password
try {
    npm.cmd run admin:create -- $adminUsername $adminEmail $adminDisplayName
    if ($LASTEXITCODE -ne 0) {
        throw 'Tao Admin that bai. Doc thong bao loi o tren.'
    }
} finally {
    Remove-Item Env:ADMIN_BOOTSTRAP_PASSWORD -ErrorAction SilentlyContinue
    Remove-Variable adminPassword -ErrorAction SilentlyContinue
}
```

Nhập username và email chưa được sử dụng, email có dạng hợp lệ. Mật khẩu được
nhập ẩn, có ít nhất 12 ký tự; không dùng lại mật khẩu PostgreSQL. Không lưu
`ADMIN_BOOTSTRAP_PASSWORD` trong `.env` hoặc source code.

Thành công sẽ có thông báo `Đã tạo admin ... và thu hồi phiên bootstrap`.
Ghi nhớ username của mình và đăng nhập web ở mục 8; script không tự đăng nhập
trình duyệt.

### Nếu cần tạo thêm Admin trên cùng database

Chỉ người phụ trách vận hành máy chủ thực hiện bước này. Mỗi thành viên có thể
dùng tài khoản riêng để phân biệt người thực hiện trong nhật ký.

Khi script báo `Đã có admin hoạt động`, có thể tạo **một tài khoản mới** bằng cách
chạy khối sau, rồi trong lúc nó hỏi thông tin, nhập username/email mới:

```powershell
$adminUsername = Read-Host 'Ten dang nhap Admin bo sung'
$adminEmail = Read-Host 'Email chua duoc su dung'
$adminDisplayName = Read-Host 'Ten hien thi'
$adminPassword = Read-Host 'Mat khau moi (it nhat 12 ky tu)' -AsSecureString

$env:ADMIN_BOOTSTRAP_PASSWORD = [System.Net.NetworkCredential]::new('', $adminPassword).Password
$env:ALLOW_ADDITIONAL_ADMIN = 'true'
try {
    npm.cmd run admin:create -- $adminUsername $adminEmail $adminDisplayName
    if ($LASTEXITCODE -ne 0) {
        throw 'Tao Admin bo sung that bai. Doc thong bao loi o tren.'
    }
} finally {
    Remove-Item Env:ADMIN_BOOTSTRAP_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:ALLOW_ADDITIONAL_ADMIN -ErrorAction SilentlyContinue
    Remove-Variable adminPassword -ErrorAction SilentlyContinue
}
```

Lệnh này tạo tài khoản mới, không đặt lại mật khẩu hay nâng quyền tài khoản
đã tồn tại. Không xóa database để xử lý thông báo đã có Admin.

## 7. Chạy web

Tại thư mục dự án, chạy:

```powershell
npm.cmd run dev
```

Giữ terminal này mở. Lệnh khởi động cả backend trên cổng 3000 và Vite trên cổng
5173. Không chạy thêm `npm.cmd run dev:server` hoặc `npm.cmd start` cùng lúc.

- Game: http://localhost:5173/
- Admin: http://localhost:5173/admin

Nếu cần chạy bản đã build thay cho chế độ phát triển, dừng `dev` bằng Ctrl+C,
rồi chạy:

```powershell
npm.cmd start
```

Lệnh `start` tự build qua `prestart`, rồi phục vụ web trên cổng 3000. Khi đó mở
http://localhost:3000/admin. Không đặt `NODE_ENV=production` chỉ để demo qua
HTTP localhost; cấu hình production dùng cookie Secure và yêu cầu HTTPS.

## 8. Đăng nhập và thiết lập Authenticator

### Lần đầu dùng tài khoản Admin

1. Mở http://localhost:5173/admin khi chạy `dev`.
2. Nhập username và mật khẩu Admin đã tạo ở mục 6, bấm đăng nhập.
3. Khi web yêu cầu MFA, bấm **Tạo khóa Authenticator**.
4. Mở ứng dụng Authenticator trên điện thoại, chọn thêm tài khoản bằng khóa
   thiết lập thủ công.
5. Đặt tên dễ nhận biết, ví dụ `Bau Cua - ten_admin`, dán khóa web hiển thị và
   chọn loại **theo thời gian / Time based**.
6. Nhập mã 6 số hiện tại từ điện thoại vào web và xác nhận.
7. Khi xác minh thành công, web mở giao diện quản trị với các mục Tổng quan,
   Người chơi, Phòng, Kết quả và Nhật ký.

`MFA_ENCRYPTION_KEY` trong `.env` là khóa máy chủ dùng mã hóa dữ liệu; khóa
Authenticator hiển thị trên web là khóa riêng của tài khoản. Không nhập khóa
trong `.env` vào ứng dụng Authenticator.

### Các lần đăng nhập sau

1. Đăng nhập bằng username và mật khẩu.
2. Nhập mã 6 số mới từ mục Authenticator của đúng tài khoản/máy chủ.
3. Nếu vừa dùng một mã để xác minh và web tiếp tục hỏi mã, đợi mã mới xuất hiện.
   Mã đổi theo chu kỳ 30 giây và mã đã dùng không được phát lại.

Không cần tạo khóa Authenticator mỗi lần đăng nhập. Bật ngày giờ tự động trên
điện thoại và Windows để mã theo thời gian khớp nhau. Khi kết thúc phiên dùng
máy chung, đăng xuất tài khoản Admin.

## 9. Bật và tắt ở những lần sử dụng sau

Mở Docker Desktop, mở PowerShell tại thư mục dự án rồi chạy:

```powershell
docker compose up -d --wait
npm.cmd run dev
```

Để dừng web, nhấn Ctrl+C tại terminal đang chạy `dev`. Sau đó có thể dừng DB:

```powershell
docker compose down
```

`down` giữ dữ liệu trong named volume. **Không dùng `docker compose down -v`**
nếu muốn giữ tài khoản, ví, lịch sử và cấu hình Authenticator trong database.
Không chạy lại `admin:create` hoặc sinh lại khóa MFA ở mỗi lần bật ứng dụng.

## 10. Thành viên truy cập web trên cùng mạng LAN

Một thành viên làm máy chủ: cấu hình DB và tạo tài khoản theo các mục trên,
chạy `npm.cmd run dev`, rồi giữ Docker và terminal web đang chạy.

1. Các thiết bị kết nối mạng có thể liên lạc với máy chủ.
2. Người chạy server lấy địa chỉ **Network** mà Vite in trong terminal,
   ví dụ `http://192.168.1.20:5173`.
3. Thành viên khác mở `http://192.168.1.20:5173/admin`, thay IP bằng IP máy chủ.
4. Đăng nhập bằng tài khoản Admin được người vận hành tạo **trên database máy
   chủ**, rồi thiết lập/xác minh Authenticator của tài khoản đó.
5. Nếu không truy cập được, kiểm tra mạng và Windows Firewall trên máy chủ;
   chỉ cho phép Node.js trên mạng riêng dùng cho buổi demo.

Không dùng `localhost` trên máy của người truy cập để trỏ về máy chủ: địa chỉ
này luôn chỉ chính thiết bị đang mở trình duyệt. Thành viên chỉ truy cập web
không cần cài Docker, Node.js hay mở cổng PostgreSQL trên máy mình. Đây là
cách truy cập nội bộ LAN; để sử dụng qua Internet cần triển khai server và HTTPS.

## 11. Xử lý lỗi thường gặp

| Hiện tượng | Cách xử lý |
|---|---|
| `docker` không được nhận diện | Mở PowerShell mới sau cài đặt; kiểm tra Docker Desktop đã được cài. |
| Không kết nối được Docker engine | Mở Docker Desktop, chờ engine; xử lý lỗi WSL nếu ứng dụng thông báo. |
| Thiếu `DOCKER_DB_PASSWORD` | Thêm biến vào `.env` tại thư mục chứa `compose.yaml`, không để trống. |
| PostgreSQL không `healthy` | Xem `docker compose logs --tail 50 postgres`; kiểm tra cổng 5433 có bị chiếm. |
| DB báo sai mật khẩu | Kiểm tra hai biến mật khẩu giống nhau và không có URL cũ ưu tiên kết nối. Với volume đã tồn tại, đổi `.env` không tự đổi mật khẩu DB; dùng mật khẩu ban đầu hoặc để người vận hành đổi bằng SQL. |
| Không có `bau_cua_test` | Script khởi tạo chỉ chạy lần đầu. Nếu thực sự chưa có DB này, chạy `docker compose exec postgres psql -U postgres -d postgres -c "CREATE DATABASE bau_cua_test;"`. |
| API báo bảng không tồn tại | Chạy `npm.cmd run db:migrate` với đúng database và kiểm tra kết quả. |
| Đã có Admin hoạt động | Dùng tài khoản hiện có, hoặc người vận hành tạo thêm theo mục 6. |
| Username/email đã tồn tại | Chọn username/email mới khi tạo; script không sửa tài khoản cũ. |
| Đăng nhập được game nhưng Admin báo không có quyền | Tài khoản `player` và host phòng không phải Admin; dùng tài khoản được tạo bằng `admin:create`. |
| Quên username Admin | Người vận hành có thể dùng lệnh tra cứu ở dưới; không đọc được mật khẩu gốc từ DB. |
| MFA sai | Chọn đúng mục Authenticator, kiểm tra giờ tự động và đợi mã 6 số mới; không gửi liên tiếp mã đã dùng. |
| MFA bị chặn tạm thời | Mặc định 5 lần sai bị chặn 15 phút; đợi hết thời gian, kiểm tra giờ/khóa rồi thử lại. |
| Mất điện thoại hoặc mục Authenticator | Người vận hành chạy lệnh reset MFA ở dưới, sau đó đăng nhập và thiết lập lại. |
| Web báo lỗi khóa mã hóa MFA | Kiểm tra `MFA_ENCRYPTION_KEY` đúng khóa cũ; không thay bằng khóa ngẫu nhiên mới cho DB đã có MFA. |
| `EMAIL_NOT_CONFIGURED` khi quên mật khẩu | Cần cấu hình SMTP và tài khoản có email đã xác minh. Reset MFA không đặt lại mật khẩu. |
| `EADDRINUSE` hoặc cổng 5173 bị chiếm | Dừng terminal chạy dự án cũ; không mở hai backend trên cùng cổng 3000. |
| `/admin` không gọi được API | Dùng `npm.cmd run dev` hoặc `npm.cmd start`, không chỉ chạy Vite/preview; kiểm tra PostgreSQL và trạng thái backend. |

Tra cứu username Admin, chạy trong PowerShell của người vận hành:

```powershell
docker compose exec postgres psql -U postgres -d bau_cua_dev -c "SELECT username, status FROM users WHERE role = 'admin';"
```

Reset MFA khi mất Authenticator; nhập đúng username cần khôi phục:

```powershell
$adminUsername = Read-Host 'Username Admin can reset MFA'
npm.cmd run admin:mfa-reset -- $adminUsername
```

Lệnh reset MFA xóa thiết lập Authenticator cũ, thu hồi tất cả phiên của tài khoản
và ghi nhật ký. Sau đó đăng nhập bằng **mật khẩu hiện có** để tạo Authenticator
mới. Không chạy lệnh này chỉ vì không nhớ username.

## 12. SMTP và kiểm tra hoàn tất

SMTP không bắt buộc để tạo Admin, đăng nhập hoặc xác minh MFA. Muốn dùng xác
minh email / quên mật khẩu, cấu hình theo nhà cung cấp trong `.env`:

```env
PUBLIC_APP_URL=http://localhost:5173
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_FROM=Bau Cua <no-reply@example.com>
SMTP_USER=THAY_BANG_TAI_KHOAN_SMTP
SMTP_PASSWORD=THAY_BANG_MAT_KHAU_SMTP
```

Đây là mẫu, chưa phải thông tin SMTP thật. Khởi động lại backend sau khi đổi
cấu hình và xác minh email trước khi dùng khôi phục mật khẩu. Nếu gửi link cho
thành viên qua LAN, `PUBLIC_APP_URL` phải là địa chỉ họ truy cập được, không
phải `localhost` của máy họ. Khi triển khai production, URL này phải dùng HTTPS.

Trước buổi demo, kiểm tra:

- [ ] Docker Desktop đang chạy; PostgreSQL `healthy`.
- [ ] Đúng database trên cổng 5433, migration thành công.
- [ ] Chỉ một backend đang chạy; mở được game và `/admin`.
- [ ] Đăng nhập tài khoản Admin và xác minh mã Authenticator thành công.
- [ ] Mở được Tổng quan, Người chơi, Phòng và Nhật ký.
- [ ] Khi cần thử thao tác quản trị, dùng tài khoản/phòng thử và ghi lý do rõ ràng.
- [ ] `.env` và khóa MFA được giữ ngoài Git; đã biết cách bật lại ứng dụng.

Tài liệu liên quan: [Database Docker](POSTGRES_DOCKER.md),
[dọn dữ liệu cũ trong Admin](ADMIN_DATABASE_CLEANUP.md),
[chi tiết tính năng Admin](PHASE_3_ADMIN.md), [README dự án](../README.md).

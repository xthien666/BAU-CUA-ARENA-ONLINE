# PostgreSQL trong Docker

Docker Desktop phải đang chạy. Cấu hình `compose.yaml` dùng PostgreSQL 18.6,
cổng `127.0.0.1:5433` và named volume giữ dữ liệu. PostgreSQL cài trực tiếp
trên máy có thể tiếp tục chạy trên cổng 5432.

## Khởi động dự án đã chuyển sang Docker

Mở terminal tại thư mục gốc dự án:

```powershell
docker compose up -d --wait
npm.cmd run dev
```

Mở http://localhost:5173. Backend dùng cổng 3000; chỉ chạy một backend.
Đối với bản build, chạy `npm.cmd run build` rồi `node server/index.js` và mở
http://localhost:3000.

## Cài trên máy mới

Tạo `.env` từ `.env.example`, giữ các cấu hình riêng của ứng dụng, thêm mật khẩu
Docker và cấu hình kết nối:

```env
DOCKER_DB_PASSWORD=your_local_docker_password
DB_HOST=127.0.0.1
DB_PORT=5433
DB_USER=postgres
DB_PASSWORD=your_local_docker_password
DB_NAME_DEV=bau_cua_dev
DB_NAME_TEST=bau_cua_test
```

Hai mật khẩu phải giống nhau. `DATABASE_URL` và `TEST_DATABASE_URL`, nếu có,
được ưu tiên hơn các biến `DB_*`; cập nhật hoặc bỏ chúng nếu còn trỏ tới DB cũ.
Kiểm tra cả `.env.test` nếu có cấu hình test riêng.

```powershell
docker compose up -d --wait
npm.cmd ci
npm.cmd run db:migrate
npm.cmd run test:all
npm.cmd run dev
```

Lần đầu tạo volume, PostgreSQL tạo `bau_cua_dev` và script trong
`docker/postgres/` tạo `bau_cua_test`. Script chỉ chạy khi thư mục dữ liệu trống.
Migration development chạy bằng `db:migrate`; test runner tự migrate database
test. Trên máy mới đây là DB mới, không tự có tài khoản hoặc lịch sử của máy khác.

## Kiểm tra và dừng

```powershell
docker compose ps
docker compose logs --tail 30 postgres
docker compose exec postgres psql -U postgres -d bau_cua_dev
docker compose down
```

Thoát psql bằng `\q`. `down` giữ volume; `down -v` xóa volume và dữ liệu.
Không dùng `down -v` nếu muốn giữ tài khoản và lịch sử.

`POSTGRES_PASSWORD` chỉ thiết lập mật khẩu khi khởi tạo volume lần đầu.
Đổi mật khẩu trong `.env` sau đó không tự đổi mật khẩu user trong PostgreSQL;
cần đổi bằng SQL rồi cập nhật cấu hình ứng dụng tương ứng.

## Dữ liệu đã chuyển từ PostgreSQL cũ

Bản sao lưu cục bộ và cấu hình trước khi chuyển được giữ tại
`.tools/docker-database/backup/` (bị Git bỏ qua):

- `bau_cua_dev.dump`: bản dump trước chuyển.
- `env.before-docker`: cấu hình ứng dụng trước chuyển, có thông tin bí mật.
- `source-fingerprint.json`: số dòng và hash nội dung từng bảng để đối chiếu.
- `source-fingerprint-utc.json`: kết quả đối chiếu chuẩn hóa múi giờ UTC.
- `env.test.before-docker`: cấu hình test trước chuyển nếu trước đó có file này.

Không chia sẻ hoặc commit thư mục backup. Database PostgreSQL cũ không bị xóa.
Muốn quay về bản cũ, tắt backend rồi khôi phục cấu hình từ `env.before-docker`
và cấu hình test tương ứng trước khi chạy lại. Bản cũ không chứa những thao tác
mới đã phát sinh sau khi chuyển sang Docker.

Named volume nằm trên máy đang chạy Docker, không tự đi theo source code.
Khi chuyển dữ liệu sang máy khác vẫn cần dump/restore và giữ nguyên khóa MFA
để các tài khoản Admin đã thiết lập MFA tiếp tục sử dụng được.

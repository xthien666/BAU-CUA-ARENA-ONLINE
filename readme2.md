# BAU CUA ARENA ONLINE - Các thay đổi so với Project gốc

## Mốc so sánh

- Project gốc: https://github.com/xthien666/BAU-CUA-ARENA-ONLINE
- Mốc so sánh: commit `9c31e02` (`origin/master`) trước các thay đổi hiện tại trong working tree.
- Project hiện tại: mã game gốc sau khi bổ sung tài khoản, sảnh chờ, database và lưu số dư.

## Danh sách thay đổi và tác dụng

| Phần | File chính | Tác dụng |
|---|---|---|
| Đăng nhập | `index.html`, `src/auth_scr.js` | Cho người dùng đăng nhập bằng email/mật khẩu và đi thẳng vào Main Lobby. |
| Tạo tài khoản | `index.html`, `src/auth_scr.js`, `server/auth_server.js` | Tạo tài khoản mới với kiểm tra username, email, mật khẩu, điều khoản và mã giới thiệu. |
| Mật khẩu | `server/database/user_server.js` | Hash mật khẩu bằng bcrypt trước khi lưu, không lưu mật khẩu dạng rõ. |
| JWT | `server/auth_server.js`, `server/game.js` | Xác định đúng tài khoản khi lấy danh sách phòng, tạo phòng và vào phòng. |
| MongoDB | `server/database/db_server.js`, `server/database/user_server.js` | Lưu tài khoản và số dư để dữ liệu không chỉ nằm trong giao diện hoặc RAM. |
| Main Lobby | `index.html`, `src/auth_scr.js`, `src/arena.css` | Làm trạm trung chuyển sau đăng nhập, trước khi người chơi vào bàn. |
| Chơi nhanh | `src/auth_scr.js` | Tìm phòng đang mở và còn chỗ, nếu không có thì tạo phòng mới. |
| Chọn bàn | `server/app.js`, `src/auth_scr.js` | Hiển thị các phòng phù hợp với trạng thái, số chỗ và số xu của người dùng. |
| Mức xu tối thiểu | `server/game.js`, `server/app.js`, `index.html` | Cho chủ phòng đặt điều kiện số dư và ngăn người không đủ xu tham gia. |
| Đồng bộ số dư | `server/game.js` | Ghi lãi/lỗ và xu Host cấp vào MongoDB sau khi cập nhật trạng thái game. |
| Cuộn giao diện | `src/arena.css` | Cho form dài cuộn theo toàn bộ body trên màn hình nhỏ. |
| Bố cục mobile ngang | `src/arena.css` | Làm Main Lobby vừa viewport khi điện thoại xoay ngang. |
| Profile và đăng xuất | `index.html`, `src/arena.css` | Đưa cụm đăng xuất, avatar, tên và số dư về góc trên trái theo bố cục game. |
| Âm thanh | `index.html`, `src/main.js`, `src/arena.css` | Cho phép bật/tắt âm thanh ở Login, Register, Lobby và bàn game bằng một trạng thái chung. |
| Tùy chọn tạo bàn | `index.html`, `src/auth_scr.js`, `src/main.js` | Chỉ hiển thị mức xu tối thiểu sau khi bấm Tạo Bàn Mới, tránh làm rối lobby. |
| Giao diện tham khảo | `src/arena.css` | Dùng nền game, header tối và các card màu riêng cho các chế độ chơi. |
| Tài khoản kiểm thử | `scripts/seed-test-users.js` | Tạo nhanh 2 tài khoản đăng nhập test trong MongoDB. |

## 1. Thay đổi frontend

### Giao diện xác thực

- Thay thế sảnh cũ chỉ nhập tên bằng màn hình Đăng nhập.
- Thêm biểu mẫu đăng nhập bằng email và mật khẩu.
- Thêm màn hình Tạo tài khoản gồm:
  - tên đăng nhập
  - email
  - mật khẩu
  - xác nhận mật khẩu
  - mã giới thiệu
  - ô đồng ý điều khoản
- Thêm kiểm tra phía client cho xác nhận mật khẩu và chính sách mật khẩu dài 8-16 ký tự.
- Thêm luồng đăng xuất và lưu trạng thái tài khoản/phiên đăng nhập.
- Thêm nút đăng nhập Google ở giao diện. Google OAuth chưa được kết nối với nhà cung cấp hoặc callback.

### Sảnh chờ chính

- Thêm Main Lobby yêu cầu đăng nhập trước khi vào phòng game.
- Hiển thị thông tin người dùng, tên đăng nhập, avatar và số dư xu ảo.
- Thêm chức năng Chơi nhanh.
- Thêm chức năng Tạo phòng.
- Thêm chức năng Vào phòng bằng mã phòng.
- Thêm danh sách phòng đang hoạt động và nút làm mới.
- Thêm nhập và hiển thị số xu tối thiểu của phòng.
- Các request lấy danh sách phòng sử dụng JWT bearer token.
- Cho phép cuộn toàn trang ở màn hình xác thực và sảnh chờ, đồng thời giữ cách hiển thị viewport riêng cho bàn game.
- Làm sáng nền, form, thẻ chế độ chơi và danh sách bàn ở auth/lobby; không thay đổi giao diện bàn game.
- Điều chỉnh lại theo bố cục game ngang: header ở trên, ba khu vực Chơi nhanh, Chơi với bạn và Chọn bàn nằm cạnh nhau.
- Đổi font sang `Nunito` cho nội dung và `Baloo 2` cho tiêu đề/nút để chữ bo tròn hơn.
- Dùng nền game có sẵn, card xanh/hồng/vàng và màu tương phản để gần với giao diện tham khảo.
- Ẩn thanh scrollbar nhưng vẫn giữ khả năng cuộn bằng chuột, trackpad, phím và thao tác vuốt.
- Chỉ hiển thị thông báo xoay ngang trên thiết bị portrait mobile; không hiển thị nhầm trên desktop.
- Giữ chức năng tạo link mời bên trong phòng game.

### Profile, âm thanh và tạo bàn

- Cụm tài khoản trong Main Lobby nằm ngang ở góc trên trái theo thứ tự: Đăng xuất, avatar, tên và số dư.
- Nút đăng xuất dùng biểu tượng thay cho nút chữ dài.
- Avatar được phóng lớn để dễ nhận diện.
- Nút loa xuất hiện ở Login, Register, Lobby và bàn game; trạng thái tắt tiếng được dùng chung và lưu trong trình duyệt.
- Khi bấm **Tạo Bàn Mới**, hệ thống mở hộp **Tạo Bàn Mới** để nhập số xu tối thiểu. Lobby chính không còn hiển thị trực tiếp ô nhập này.

### Sửa tương thích frontend

- Bọc kiểm tra các event handler của sảnh cũ trong `src/main.js` sau khi DOM sảnh cũ bị thay thế.
- Ngăn các phần tử cũ không tồn tại làm dừng module game khi tải trang.
- Lưu tên người dùng đã xác thực khi ghi nhớ phiên phòng.

## 2. Thay đổi backend và hệ thống tài khoản

### Lớp tài khoản/database mới

Added:

- `server/auth_server.js`
- `server/database/db_server.js`
- `server/database/user_server.js`

Lớp mới cung cấp:

- Kết nối MongoDB thông qua Mongoose.
- API HTTP đăng ký và đăng nhập.
- Hash mật khẩu bằng bcrypt.
- Tạo và xác thực access token JWT.
- Lưu số dư tài khoản.
- Tạo mã mời từ server.
- Kiểm tra mã giới thiệu.
- Lưu thời điểm người dùng đồng ý điều khoản.

Các endpoint HTTP mới:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/rooms` có xác thực JWT

### Kiểm tra phía server

- Đăng ký kiểm tra việc đồng ý điều khoản ở phía server.
- Mã giới thiệu được đối chiếu với mã mời của một tài khoản đã tồn tại.
- Lấy danh sách phòng yêu cầu bearer token hợp lệ.
- Danh sách chỉ trả về phòng chưa khóa, còn chỗ và đang ở phase `waiting` hoặc `betting`.
- Tạo phòng có hỗ trợ số xu tối thiểu đã được kiểm tra.
- Khi vào phòng, server kiểm tra số dư của người dùng với mức tối thiểu của phòng.
- Danh tính người chơi đã xác thực sử dụng username và số dư lấy từ MongoDB, không tin dữ liệu client gửi lên.

## 3. Thay đổi GameService

### Thành viên phòng có xác thực JWT

- Thêm `verifyToken()` vào `GameService`.
- `create()` và `join()` xác thực token tài khoản rồi lấy user từ database.
- Server production bắt buộc xác thực khi tạo/vào phòng.
- Vẫn có chế độ local/test riêng để test protocol trong RAM không cần MongoDB.
- `handle()` hỗ trợ cả luồng async có xác thực và luồng đồng bộ local/test cũ.

### Đồng bộ số dư với database

- Host cấp xu sẽ cập nhật số dư trong RAM và MongoDB.
- Khi kết toán vòng, server cập nhật số dư trong RAM và cộng lãi/lỗ của vòng vào MongoDB.
- Người chơi không có danh tính database sẽ không gọi cập nhật MongoDB.
- Người chơi local/test nhận số dư ban đầu theo cấu hình.

### Dữ liệu phòng

- Thêm `minimumBalance` vào state và danh sách phòng.
- Thêm kiểm tra số xu tối thiểu khi tạo/vào phòng bằng tài khoản đã xác thực.

## 4. Dependency và script

Thêm các dependency runtime cho hệ thống tài khoản:
- `bcrypt`
- `dotenv`
- `jsonwebtoken`
- `mongoose`

Thêm script:

```bash
npm run seed:test-users
```

Script này tạo các tài khoản test theo cách idempotent trong MongoDB đã cấu hình:

### Hai tài khoản đã có sẵn để đăng nhập

| Email | Mật khẩu |
|---|---|
| `tester@gmail.com` | `Test@1234` |
| `npc_lv1@gmail.com` | `Test@1234` |

### Ba email chỉ dùng để kiểm thử tạo tài khoản

- `example@gmail.com`
- `need_credit@gmail.com`
- `try_hard@gmail.com`

Ba địa chỉ này không phải tài khoản đăng nhập test. Khi kiểm thử đăng ký, hãy dùng từng địa chỉ để kiểm tra tạo tài khoản mới, email trùng và thông báo lỗi tương ứng.

Mật khẩu mặc định của hai tài khoản đăng nhập là `Test@1234`. Script không ghi đè người dùng đã tồn tại.

## Hướng dẫn kiểm thử tài khoản và lobby

### Chuẩn bị

1. Cấu hình `MONGODB_URI` và `JWT_SECRET` trong `.env`.
2. Chạy seed tài khoản đăng nhập:

```bash
npm run seed:test-users
```

3. Khởi động project:

```bash
npm start
```

Mở `http://localhost:3000`.

### Kiểm thử đăng nhập và Main Lobby

1. Đăng nhập bằng `tester@gmail.com` / `Test@1234`.
2. Kiểm tra chuyển thẳng sang Main Lobby.
3. Kiểm tra username, avatar và số dư hiển thị.
4. Bấm **Đăng xuất**, sau đó đăng nhập lại bằng `npc_lv1@gmail.com` / `Test@1234`.
5. Thử sai mật khẩu và email không tồn tại, hệ thống phải báo lỗi.
6. Thử **Chơi nhanh**, **Tạo bàn**, nhập mã phòng và làm mới danh sách bàn.
7. Tạo bàn với số xu tối thiểu, sau đó dùng tài khoản không đủ xu để kiểm tra việc bị từ chối.

### Kiểm thử tạo tài khoản

1. Chuyển sang màn hình **Tạo tài khoản**.
2. Dùng một trong ba email: `example@gmail.com`, `need_credit@gmail.com` hoặc `try_hard@gmail.com`.
3. Kiểm tra username sai định dạng, mật khẩu thiếu chữ/số/ký tự đặc biệt, xác nhận mật khẩu không khớp và bỏ chọn điều khoản.
4. Để trống mã giới thiệu để kiểm tra trường hợp hợp lệ không bắt buộc.
5. Nhập mã giới thiệu sai để kiểm tra thông báo lỗi.
6. Đăng ký thành công, kiểm tra thông báo **Tạo tài khoản thành công!** và nút **Bắt đầu đăng nhập**.

> Ba email trên hiện được dành cho kịch bản đăng ký. Nếu chúng đã tồn tại trong database từ lần seed trước, cần xóa bản ghi test tương ứng trước khi chạy lại kịch bản đăng ký.

## 5. Kiểm thử và xác minh

- Cập nhật setup test Socket.IO để dùng rõ chế độ local/test thay vì âm thầm bỏ qua xác thực production.
- Sửa middleware hash mật khẩu async của Mongoose cho đúng phiên bản đang cài đặt.
- Kết quả xác minh hiện tại:

```text
npm test       18 passed, 0 failed
npm run build  passed
```

## 6. File được thêm hoặc thay đổi lớn

### File được thêm

- `server/auth_server.js`
- `server/database/db_server.js`
- `server/database/user_server.js`
- `src/auth_scr.js`
- `scripts/seed-test-users.js`
- `readme2.md`

### File được thay đổi

- `index.html`
- `src/arena.css`
- `src/main.js`
- `server.js`
- `server/app.js`
- `server/game.js`
- `package.json`
- `package-lock.json`
- `tests/multiplayer.test.js`

Các thay đổi trên chỉ điều chỉnh bố cục và cách hiển thị; không thêm chế độ chơi mới hay thay đổi luật cược.

## 7. Giới hạn còn lại

- Google OAuth mới chỉ có trên giao diện; vẫn cần Google client credentials, OAuth callback và xác thực token phía server.
- Chưa triển khai xác minh quyền sở hữu email và gửi OTP thật. Cần SMTP provider hoặc dịch vụ test email local như Mailpit.
- Chức năng bạn bè và quét QR riêng chưa được xây dựng; hiện có mã phòng và link mời trong phòng game.
- Các địa chỉ Gmail test ở trên chỉ là danh tính test trong database, không phải hộp thư Gmail thật.
- Phòng, phiên và trạng thái game vẫn nằm trong RAM, nên sẽ mất sau khi server khởi động lại.
- `README.md` gốc vẫn mô tả kiến trúc trước khi có tài khoản; file này ghi lại các thay đổi mới trong working tree.

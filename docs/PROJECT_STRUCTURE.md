# Cấu trúc dự án

## Nơi đặt code

```text
bau-cua-arena/
├── index.html                    # Trang game, entry HTML của Vite
├── admin.html                    # Trang Admin, entry HTML của Vite
├── src/                          # Chỉ chứa code chạy trên trình duyệt
│   ├── main.js                   # Khởi tạo UI và kết nối Socket.IO
│   ├── styles/base.css           # CSS nền tảng dùng chung
│   └── features/
│       ├── game/                 # Bàn chơi, mở bát, lịch sử và CSS
│       ├── hub/                  # Sảnh, ảnh động WebP, video mobile và CSS
│       ├── auth/                 # Đăng nhập/đăng ký và CSS
│       ├── account/              # Hồ sơ, ví và CSS
│       └── admin/                # Giao diện quản trị, dialog và CSS
├── server/                       # Chỉ chứa code chạy trên Node.js
│   ├── index.js                  # Điểm khởi động, xử lý dừng server
│   ├── app.js                    # HTTP, Socket.IO, phục vụ bản build
│   ├── game.js                   # Luật chơi và trạng thái phòng
│   ├── persistent.js             # Kết nối game với PostgreSQL
│   ├── production.js             # Xác thực và API Admin
│   ├── media.js                  # Phục vụ video và byte ranges
│   ├── email.js                  # Email xác minh/khôi phục
│   ├── db/                       # Kết nối, transaction, repository nền, audit
│   ├── repositories/             # Truy vấn dữ liệu theo thực thể
│   └── services/                 # Nghiệp vụ ví, game, Auth, Admin và MFA
├── config/game-config.json       # Chip, biểu tượng và số dư ban đầu
├── migrations/                   # SQL theo thứ tự, giữ nguyên lịch sử migration
├── scripts/                      # Dev, migration và lệnh quản trị
├── tests/
│   ├── client/                   # Logic frontend có thể kiểm thử độc lập
│   ├── server/                   # Game, Socket.IO, HTTP và media
│   ├── db/                       # Kết nối và lớp nền PostgreSQL
│   ├── repositories/             # Truy vấn và thanh toán
│   ├── services/                 # Nghiệp vụ, Auth, Admin và khởi động dev
│   └── browser/                  # Kiểm tra trình duyệt thủ công và fixture QA
├── public/assets/                # Ảnh, WebP, video mobile và âm thanh công khai
├── media-sources/hub/            # Video nguồn cục bộ, không đưa vào Git/Docker
└── docs/
    ├── ASSET_CREDITS.md           # Nguồn và ghi chú tài nguyên
    └── archive/                  # Prompt thiết kế cũ để tham khảo
```

Các file `package.json`, `package-lock.json`, `vite.config.js`, `Dockerfile`, `render.yaml`, `.env.example` và HTML entry vẫn nằm ở gốc theo cách dùng của npm, Vite và công cụ triển khai. `.env` là cấu hình riêng trên máy; không đưa vào Git hoặc image Docker.

Đặt JS và CSS của một chức năng frontend cùng thư mục trong `src/features/`. Code truy cập PostgreSQL hoặc phụ thuộc Node.js đặt trong `server/`. Không import code backend vào frontend.

## Lệnh chạy

Các lệnh npm giữ nguyên: `npm run dev`, `npm start`, `npm test`, `npm run build`, `npm run db:migrate`, `npm run admin:create`, `npm run admin:mfa-reset`. Điểm khởi động trực tiếp đổi từ `node server.js` thành `node server/index.js`.

`npm test` chạy nhóm client/server và các kiểm thử PostgreSQL. Runner DB vẫn kiểm tra tên database dành cho test trước khi chạy migration và kiểm thử. `tests/browser/config-retry.cjs` là kiểm tra thủ công cần Playwright, Chrome và một ứng dụng đang chạy; nó không nằm trong `npm test`. Fixture quản trị thủ công nằm ở `tests/browser/admin-fixture.js` và vẫn bắt buộc database test.

Docker build cả hai trang HTML và đóng gói `server/`, `config/`, `scripts/`, `migrations/` cùng bản build. Tài liệu, kiểm thử, nguồn video, file tạm và công cụ cục bộ được loại khỏi build context.

## File đã dọn ngày 01/10/2026

Đã xóa các log cũ: `debug.log`, `.tools/vite.err.log`, `.tools/vite.out.log`, cùng các thư mục rỗng sau khi chuyển code. Tổng tài nguyên và log đã dọn khoảng 27 MiB. File build trong `dist/` được Vite tạo lại bằng `npm run build`; `node_modules/` chứa dependency được cài bằng npm.

26 tài nguyên dưới đây không được tham chiếu trong code hoặc tài liệu dự án khi dọn. Đã kiểm tra riêng các đường dẫn tạo động của chip và avatar/biểu tượng PNG để giữ các tài nguyên đó. Các file đã xóa vốn được theo dõi trong Git, nên có thể khôi phục từ lịch sử nếu cần dùng lại.

| Thư mục | File đã xóa |
| --- | --- |
| `public/assets/arena/` | `background-complete.png`, `betting-medallion.png`, `bowl-porcelain.png`, `bowl-porcelain1.png`, `bowl-tray.png` |
| `public/assets/arena/` | `chips-sheet.png`, `dice-3d.png`, `die-ca.png`, `die-ga.png`, `die-nai.png`, `die-nai1.png` |
| `public/assets/arena/` | `logo.png`, `scene.png` |
| `public/assets/arena/` | `mascot-bau.png`, `mascot-ca.png`, `mascot-cua.png`, `mascot-ga.png`, `mascot-nai.png`, `mascot-tom.png` |
| `public/assets/arena/` | `symbol-bau.jpg`, `symbol-ca.jpg`, `symbol-cua.jpg`, `symbol-ga.jpg`, `symbol-nai.jpg`, `symbol-tom.jpg` |
| `public/assets/audio/` | `tet1.mp3` |

## Dọn animation trước khi push Git

- Giữ 8 ảnh WebP dùng cho ba thẻ đầu, cùng nền sảnh, phượng hoàng và hai khung SVG. Thẻ Chơi với bạn dùng vòng lặp v5 ở tốc độ 1,5× cho desktop, fallback mobile và đúng một MP4 mobile nhẹ.
- Xóa các MP4/WebM và poster phiên bản cũ khỏi `public/`, code phát MP4, test của code đó, script nén MP4 cũ và các lớp CSS trang trí không còn trong HTML.
- Xóa thư mục dựng rồng, ảnh QA, snapshot và scaffold lân cũ. Đợt dọn này xóa 69 file, khoảng 25,38 MiB.
- Xóa bốn ảnh bàn/xúc xắc không còn tham chiếu; giữ các mặt xúc xắc, chip và avatar được tạo đường dẫn động.
- Gỡ các đường dẫn MP3 hiệu ứng vật phẩm không tồn tại; tiếp tục dùng âm thanh tổng hợp đã có.
- Ba video gốc được chuyển nguyên vẹn vào `media-sources/hub/`, có kiểm tra SHA-256 trước/sau. Thư mục này, `.tools/`, `.env`, `node_modules/` và `dist/` không đưa vào Git.

`npm run build` dùng WebP và MP4 mobile đã có sẵn nên bản clone không cần FFmpeg hoặc video nguồn. Nếu cần dựng lại, cung cấp ba video vào `media-sources/hub/` rồi chạy `node scripts/build-hub-motion.js`; thêm `--friend-only` để chỉ dựng video, ảnh động và poster Chơi với bạn. Kiểm tra nguồn mà không render bằng `node scripts/build-hub-motion.js --check-sources`. Có thể đặt `HUB_MOTION_SOURCE_DIR` để dùng nguồn ngoài dự án và `FFMPEG_PATH` để chỉ định FFmpeg.

# Dọn dữ liệu cũ trong Admin

Mở `/admin`, đăng nhập bằng tài khoản Admin và xác minh Authenticator, sau đó
chọn **Dọn dữ liệu** trong thanh điều hướng.

## Cách sử dụng

1. Nhập số ngày gần nhất cần giữ, từ 1 đến 3650; mặc định 30 ngày.
2. Chọn các nhóm cần dọn: phòng đã đóng, người chơi đã xóa mềm, nhật ký cũ.
3. Bấm **Xem trước dữ liệu sẽ xóa**. Kiểm tra mốc thời gian, số đối tượng và
   các bản ghi liên quan. Bước này không xóa dữ liệu.
4. Nếu đồng ý với phạm vi, nhập chính xác `XOA VINH VIEN`.
5. Bấm **Xóa vĩnh viễn dữ liệu đã xem trước**, nhập lý do trong hộp thoại rồi
   xác nhận. Hủy hộp thoại sẽ không thực hiện xóa.
6. Xem thông báo kết quả. Nếu còn dữ liệu cũ, xem trước lại và dọn lượt tiếp theo.

Mỗi lượt tối đa 200 phòng, 200 người chơi và 200 nhật ký. Bản xem trước có
hiệu lực 10 phút, gắn với Admin đã tạo bản đó; đổi lựa chọn sẽ hủy bản xem trước.
Nếu phạm vi đã đổi trên server, thao tác bị từ chối và cần xem trước lại.

## Quy tắc giữ dữ liệu

- Phòng chỉ được chọn khi đã đóng trước mốc thời gian, không còn membership
  đang hoạt động, không còn ván/cược chờ thanh toán và không còn trong engine
  đang chạy. Phòng bị xóa cùng membership, ván, cược, kết quả ván và lệnh liên quan.
- Người chơi phải có vai trò `player`, đã xóa mềm trước mốc thời gian. Những
  tài khoản còn liên quan đến phòng/lịch sử cần giữ, còn phiên hợp lệ hoặc có
  giao dịch mới hơn mốc thời gian được bỏ qua. Nếu phòng cũ liên quan chưa được
  chọn ở lượt này, tài khoản cũng được giữ; có thể xem trước lại sau lượt dọn phòng.
- Người chơi bị xóa vĩnh viễn cùng ví, giao dịch, phiên, token, phiên thưởng và
  lệnh của họ. Tài khoản Admin không nằm trong phạm vi xóa.
- Ví và sổ giao dịch của người chơi còn được giữ không bị xóa khi dọn phòng.
  Lịch sử chi tiết ván thuộc phòng đã xóa sẽ không còn trên web.
- Nhật ký cũ trước mốc thời gian được xóa nếu chọn nhóm nhật ký. Các bản ghi
  `DATABASE_CLEANUP` luôn được giữ để biết ai đã dọn gì và chống lặp thao tác dọn.
- Những mã yêu cầu quản trị thuộc nhật ký đã dọn được giữ ở dạng tối thiểu trong
  `admin_request_tombstones`, ngăn gửi lại yêu cầu cũ và vô tình thực hiện lại
  thao tác. Không dùng xóa trực tiếp bảng này để dọn database.

## Cấu hình và vận hành

Chạy migration mới trước khi sử dụng phiên bản có chức năng này:

```powershell
npm.cmd run db:migrate
```

Sau đó khởi động lại backend. Không cần thêm biến môi trường. API xem trước và
xóa đều yêu cầu phiên Admin đã xác minh MFA và token CSRF.

Việc xóa và ghi nhật ký nằm trong một transaction: lỗi bất kỳ bước nào thì
rollback. Thao tác khóa ghi các bảng liên quan trong thời gian ngắn và từ chối
khi database quá bận; nên dọn lúc ít người chơi. Có thể sao lưu bằng pg_dump
trước khi dọn nếu cần khả năng khôi phục. Xóa thành công không có nút hoàn tác.

PostgreSQL không trả ngay toàn bộ dung lượng đĩa sau `DELETE`. Autovacuum giúp
thu hồi vùng trống để tái sử dụng; `VACUUM FULL` có thể thu nhỏ file nhưng khóa
bảng và cần được người vận hành thực hiện khi bảo trì. Web không tự chạy
`VACUUM FULL`. Xem [tài liệu PostgreSQL 18](https://www.postgresql.org/docs/18/routine-vacuuming.html).

API:

- `POST /api/admin/cleanup/preview`: số ngày giữ và các nhóm dữ liệu.
- `POST /api/admin/cleanup`: token xem trước, chuỗi xác nhận, lý do và requestId.

Kiểm tra: `npm.cmd run test:db` kiểm tra điều kiện xóa, bảo vệ dữ liệu đang hoạt
động, chống lặp, bản xem trước và rollback; bộ kiểm thử HTTP kiểm tra quyền Admin,
MFA, CSRF và xác nhận bắt buộc. Thao tác xóa trong kiểm thử chỉ chạy trên DB test.

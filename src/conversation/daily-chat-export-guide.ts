/** Nội dung CLAUDE.md / AGENTS.md đặt ở gốc thư mục log - hướng dẫn AI đọc log và lọc việc */
export const HUONG_DAN_AI = `# Hướng dẫn đọc log Zalo

Thư mục này do zalo-agent (chế độ chỉ đọc) ghi tự động. Mỗi tin Zalo đến được nối
thêm vào file ngay lúc nhận. File này chỉ tạo một lần, sửa tay thoải mái.

## Cấu trúc

- \`<accountId>/<yyyy-MM-dd>/<ten-thread>_<threadId>.md\`: một cuộc trò chuyện trong một ngày.
  Mỗi tin một dòng \`- HH:mm **Người gửi**: nội dung\`. "Tôi (...)" là chủ tài khoản.
  Dòng \`> Trả lời ...\` là tin được trích dẫn, dòng "đã thu hồi" là tin bị rút lại.
- \`<accountId>/<yyyy-MM-dd>/tin-nhan.jsonl\`: cùng dữ liệu, mỗi dòng một JSON (có msgId, senderId).

Giờ theo múi giờ của bot (mặc định Asia/Ho_Chi_Minh).

## Khi được nhờ "lọc việc hôm nay" (hoặc một ngày cụ thể)

1. Đọc mọi file .md trong thư mục ngày đó (thiếu ngày thì báo, không đoán).
2. Lấy ra các việc: ai giao, giao cho ai (thường là "Tôi"), nội dung, hạn chót nếu có.
3. Xếp theo: Quá hạn / Hôm nay / Sắp tới / Không rõ hạn. Đánh dấu việc đã có câu trả lời
   kiểu "ok", "xong", "đã gửi" là đã xử lý.
4. Mỗi việc ghi nguồn: tên file + giờ tin nhắn, để mở lại kiểm tra.
5. Không bịa thông tin không có trong log. Tin bị thu hồi có thể là yêu cầu đã đổi, nêu rõ.

Mẫu kết quả:

| # | Việc | Người giao | Hạn | Trạng thái | Nguồn |
|---|---|---|---|---|---|
| 1 | Gửi báo giá cho khách A | Anh B | 17h hôm nay | Chưa làm | nhom-kinh-doanh_123.md 09:15 |
`;

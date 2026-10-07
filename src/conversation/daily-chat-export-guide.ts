/**
 * Nội dung CLAUDE.md / AGENTS.md đặt ở gốc thư mục log - hướng dẫn AI tra cứu
 * log và lọc việc. Đổi nội dung thì tăng số trong DAU_HIEU_HUONG_DAN: bản cũ
 * trên máy người dùng sẽ được chuyển vào `_backup/` và thay bằng bản mới.
 */
export const DAU_HIEU_HUONG_DAN = "<!-- zalo-agent-huong-dan v2 -->";

export const HUONG_DAN_AI = `${DAU_HIEU_HUONG_DAN}
# Hướng dẫn tra cứu log Zalo

Thư mục này do zalo-agent (chế độ chỉ đọc) ghi tự động: mỗi tin Zalo được nối vào file ngay
lúc nhận. Giờ theo múi giờ của bot (mặc định Asia/Ho_Chi_Minh). Muốn sửa file này thì xóa dòng
đầu tiên (dấu hiệu phiên bản), nếu không bản cập nhật sau có thể thay nó (bản cũ vào \`_backup/\`).

## Cấu trúc

\`\`\`
<accountId>/
  _trang-thai.md          bot còn chạy không, mất kết nối lúc nào, lần tải bù gần nhất
  _danh-ba.md             MỌI cuộc trò chuyện (tên, nhóm/riêng, ID, tên file, ngày đầu-cuối, số tin)
                          và MỌI người (tên, user ID, có chat riêng không, có mặt trong nhóm nào)
  <yyyy-MM-dd>/
    00_muc-luc.md         mục lục ngày: cuộc trò chuyện nào, bao nhiêu tin, ai nhắn, giờ đầu-cuối
    nhom_<ten-nhom>_<id>.md     chat nhóm, mỗi cuộc một file
    rieng_<ten-nguoi>_<id>.md   chat riêng, mỗi cuộc một file
    tin-nhan.jsonl        mọi tin trong ngày, một dòng JSON (có msgId, senderId, threadId)
\`\`\`

Mỗi tin một dòng \`- HH:mm **Người gửi**: nội dung\`. "Tôi (...)" là chủ tài khoản. Dòng
\`> Trả lời ...\` là tin được trích dẫn; "đã thu hồi" là tin bị rút lại. Tên file của một cuộc
trò chuyện GIỐNG NHAU ở mọi thư mục ngày (ID ở cuối không đổi), nên tìm \`*_<id>.md\` là ra mọi ngày.
Tin tải bù (lỡ lúc bot tắt) nối vào cuối file nên có thể lệch thứ tự giờ.

## Luôn làm trước

Đọc \`<accountId>/_trang-thai.md\`. Nếu tình trạng không phải "Đang kết nối", hoặc "Cập nhật lúc"
cũ hơn 15 phút so với bây giờ: ghi cảnh báo ngay đầu câu trả lời (bot tắt / mất kết nối từ mốc
nào, log từ đó có thể thiếu). "Lỗi đăng nhập" nghĩa là phải quét QR lại.

## Công thức tra cứu

| Câu hỏi | Cách làm |
|---|---|
| Hôm nay / ngày X có gì | Đọc \`<ngày>/00_muc-luc.md\`, rồi mở các file trong mục lục |
| Nhóm X bàn gì (khoảng ngày) | Tra \`_danh-ba.md\` lấy ID của nhóm, mở \`*/nhom_*_<id>.md\` trong các ngày cần |
| Người Y nói / giao gì | Tra bảng Người trong \`_danh-ba.md\`: chat riêng (\`rieng_*_<id>.md\`) + các nhóm Y có mặt; tìm dòng \`**Y**\` |
| Tìm theo từ khóa | Tìm trong \`*/tin-nhan.jsonl\` (nhanh, có threadId để mở đúng file .md) |
| Tên gần đúng / không dấu | Tên file là bản không dấu (vd \`vu-van-hai\`); so cả có dấu lẫn không dấu |

Mọi câu trả lời phải ghi nguồn: tên file + giờ của tin. Không bịa thông tin không có trong log.

## Lọc việc (báo cáo ngày)

1. Làm bước "Luôn làm trước".
2. Đọc \`00_muc-luc.md\` của ngày, rồi đọc các file trong đó (thiếu ngày thì báo, không đoán).
3. Lấy ra các việc: ai giao, giao cho ai (thường là "Tôi"), nội dung, hạn chót nếu có.
4. Xếp theo: Quá hạn / Hôm nay / Sắp tới / Không rõ hạn. Việc đã có trả lời kiểu "ok", "xong",
   "đã gửi" thì đánh dấu đã xử lý. Tin bị thu hồi có thể là yêu cầu đã đổi, nêu rõ.

Mẫu kết quả:

| # | Việc | Người giao | Nhóm / chat | Hạn | Trạng thái | Nguồn |
|---|---|---|---|---|---|---|
| 1 | Gửi báo giá cho khách A | Anh B | Nhóm Kinh Doanh | 17h hôm nay | Chưa làm | nhom_kinh-doanh_123.md 09:15 |
`;

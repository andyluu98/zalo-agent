/**
 * Nội dung CLAUDE.md / AGENTS.md đặt ở gốc thư mục log - hướng dẫn AI tra cứu
 * log và lọc việc. Đổi nội dung thì tăng số trong DAU_HIEU_HUONG_DAN: bản cũ
 * trên máy người dùng sẽ được chuyển vào `_backup/` và thay bằng bản mới.
 */
export const DAU_HIEU_HUONG_DAN = "<!-- zalo-agent-huong-dan v5 -->";

export const HUONG_DAN_AI = `${DAU_HIEU_HUONG_DAN}
# Hướng dẫn tra cứu log Zalo

Thư mục này do zalo-agent (chế độ chỉ đọc) ghi tự động: mỗi tin Zalo được nối vào file ngay
lúc nhận. Giờ theo múi giờ của bot (mặc định Asia/Ho_Chi_Minh). Muốn sửa file này thì xóa dòng
đầu tiên (dấu hiệu phiên bản), nếu không bản cập nhật sau có thể thay nó (bản cũ vào \`_backup/\`).

## Cấu trúc

\`\`\`
<accountId>/
  00_trang-thai.md        bot còn chạy không, mất kết nối lúc nào, lần tải bù gần nhất
  00_danh-ba.md           MỌI cuộc trò chuyện (tên, nhóm/riêng, Thread ID, file, ngày đầu-cuối, số tin)
                          và MỌI người (tên, user ID, có chat riêng không, có mặt trong nhóm nào)
  <yyyy-MM-dd>/
    00_muc-luc.md         mục lục ngày: cuộc trò chuyện nào, bao nhiêu tin, ai nhắn, giờ đầu-cuối
    nhom/<ten-nhom>.md    chat nhóm, mỗi cuộc một file
    rieng/<ten-nguoi>.md  chat riêng, mỗi cuộc một file
    tep/                  ảnh, file, video, tin thoại đã tải về (<HHmm>_<ten>.<duoi>)
  _du-lieu/               dữ liệu máy đọc
    <yyyy-MM-dd>.jsonl    mọi tin trong ngày, một dòng JSON (có msgId, senderId, threadId)
    danh-ba.json, trang-thai.json, muc-luc-<yyyy-MM-dd>.json
\`\`\`

Mỗi tin một dòng \`- HH:mm **Người gửi**: nội dung\`. "Tôi (...)" là chủ tài khoản. Dòng
\`> Trả lời ...\` là tin được trích dẫn; "đã thu hồi" là tin bị rút lại. Dòng \`- Đã lưu (file): ...\`
trỏ tới bản tệp trên máy (\`<ngày>/tep/\`): mở được trực tiếp (Word, Excel, PDF, ảnh) khi cần nội dung.

Tên file là tên nhóm / tên người viết không dấu (vd \`nhom/kinh-doanh.md\`, \`rieng/vu-van-hai.md\`).
Hai cuộc trùng tên thì thêm 4 số cuối ID (\`kinh-doanh-6789.md\`). Nhóm đổi tên thì những ngày sau
mang tên mới: tra CHÍNH XÁC theo Thread ID (dòng đầu mỗi file có \`- Thread ID: ...\`, cột Thread ID
trong \`00_danh-ba.md\`). Tin tải bù (lỡ lúc bot tắt) nối vào cuối file nên có thể lệch thứ tự giờ.

## Luôn làm trước

Đọc \`<accountId>/00_trang-thai.md\`. Nếu tình trạng không phải "Đang kết nối", hoặc "Cập nhật lúc"
cũ hơn 15 phút so với bây giờ: ghi cảnh báo ngay đầu câu trả lời (bot tắt / mất kết nối từ mốc
nào, log từ đó có thể thiếu). "Lỗi đăng nhập" nghĩa là phải quét QR lại.

## Công thức tra cứu

| Câu hỏi | Cách làm |
|---|---|
| Hôm nay / ngày X có gì | Đọc \`<ngày>/00_muc-luc.md\`, rồi mở các file trong mục lục |
| Nhóm X bàn gì (khoảng ngày) | Tra \`00_danh-ba.md\` lấy Thread ID; tìm \`Thread ID: <id>\` trong \`*/nhom/*.md\` của các ngày cần |
| Người Y nói / giao gì | Bảng Người trong \`00_danh-ba.md\`: chat riêng (\`*/rieng/\`) + các nhóm Y có mặt; tìm dòng \`**Y**\` |
| Tìm theo từ khóa | Tìm trong \`_du-lieu/*.jsonl\` (nhanh, có threadId để mở đúng file .md) |
| File / ảnh ai gửi | Tìm dòng \`Đã lưu\` trong file chat, mở tệp trong \`<ngày>/tep/\` |
| Tên gần đúng / không dấu | Tên file là bản không dấu; so cả có dấu lẫn không dấu |

Mọi câu trả lời phải ghi nguồn: đường dẫn file + giờ của tin. Không bịa thông tin không có trong log.

## Soạn và gửi tin (hộp thư đi có duyệt)

Bot chỉ gửi tin đã được chủ tài khoản duyệt, nằm trong \`hop-thu-di/<accountId>/<id>.json\`.
Chạy lệnh trong thư mục repo zalo-agent:

| Việc | Lệnh |
|---|---|
| Tạo tin chờ duyệt | \`pnpm outbox add --thread <Thread ID> --text "..."\` (nhiều dòng: \`--file <tệp .txt>\`) |
| Duyệt ĐÚNG một tin | \`pnpm outbox approve <id>\` |
| Xem / hủy | \`pnpm outbox list\`, \`pnpm outbox show <id>\`, \`pnpm outbox cancel <id>\` |

Quy trình BẮT BUỘC:
1. Lấy Thread ID trong \`00_danh-ba.md\` (không đoán theo tên). Tạo tin bằng \`add\`.
2. Hiện NGUYÊN VĂN tin cho chủ tài khoản kèm tên cuộc trò chuyện và id tin.
3. Chỉ \`approve\` khi chủ tài khoản đồng ý rõ ràng cho ĐÚNG tin đó. Không duyệt gộp nhiều tin
   bằng một câu "ok"; sửa nội dung thì tạo tin mới và hỏi lại.
4. Sau vài giây chạy \`pnpm outbox show <id>\`: \`da_gui\` là đã gửi; \`loi\` thì báo lý do, không tự tạo lại.

Tin ghi tay vào thư mục mà không qua \`approve\` sẽ bị từ chối (thiếu dấu duyệt \`banBam\`). Bot giãn
nhịp và có trần tin mỗi giờ: Zalo cá nhân dùng API không chính thức, không gửi hàng loạt.

## Lọc việc (báo cáo ngày)

1. Làm bước "Luôn làm trước".
2. Đọc \`00_muc-luc.md\` của ngày, rồi đọc các file trong đó (thiếu ngày thì báo, không đoán).
3. Lấy ra các việc: ai giao, giao cho ai (thường là "Tôi"), nội dung, hạn chót nếu có.
4. Xếp theo: Quá hạn / Hôm nay / Sắp tới / Không rõ hạn. Việc đã có trả lời kiểu "ok", "xong",
   "đã gửi" thì đánh dấu đã xử lý. Tin bị thu hồi có thể là yêu cầu đã đổi, nêu rõ.

Mẫu kết quả:

| # | Việc | Người giao | Nhóm / chat | Hạn | Trạng thái | Nguồn |
|---|---|---|---|---|---|---|
| 1 | Gửi báo giá cho khách A | Anh B | Nhóm Kinh Doanh | 17h hôm nay | Chưa làm | 2026-10-07/nhom/kinh-doanh.md 09:15 |
`;

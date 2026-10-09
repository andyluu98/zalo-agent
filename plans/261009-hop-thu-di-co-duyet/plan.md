# Hộp thư đi có duyệt (outbox) cho account chỉ đọc

Mục tiêu: Claude soạn tin, anh Tuấn Anh duyệt TỪNG tin, bot gửi đúng tin đó. Chế độ chỉ đọc giữ nguyên.

## Định dạng file
`<CHAT_EXPORT_DIR>/hop-thu-di/<accountId>/<id>.json` (accountId vì một process nhiều nick; bản đầu chỉ dùng id-ca-nhan).
Trường: id, threadId, loaiCuoc (nhom|rieng), tenCuoc, noiDung, trangThai (cho_duyet|da_duyet|dang_gui|da_gui|loi|huy), taoLuc, duyetLuc, guiLuc, msgId, loi, banBam (sha256 noiDung lúc duyệt).

## Thành phần (mỗi file < 200 dòng)
1. `src/outbox/outbox-file-store.ts`: đọc/ghi JSON nguyên tử (ghi file tạm rồi rename), validate Zod.
2. `src/outbox/outbox-sender.ts`: theo dõi thư mục bằng `fs.watch` (chỉ chạy khi có file đổi), quét 1 lần lúc khởi động, quét dự phòng 5 phút/lần phòng khi watch bỏ sót. Chỉ cho account readOnly đang chạy.
   - Chỉ nhận `da_duyet` VÀ `banBam` khớp noiDung hiện tại (sửa nội dung sau duyệt thì không gửi, chuyển `loi`).
   - Chống gửi lặp: GIÀNH trước bằng ghi `dang_gui` rồi mới gọi `api.sendMessage`. Restart gặp `dang_gui` thì KHÔNG gửi lại, chuyển `loi: "không rõ đã gửi chưa, kiểm tra log"`.
   - Giới hạn tốc độ: tối thiểu 20s giữa 2 tin, trần 20 tin/giờ (tuning definitions, chỉnh được trên dashboard), đếm từ guiLuc các file da_gui.
   - Chỉ văn bản thuần, cắt trần độ dài (vd 2000 ký tự, quá thì loi). threadId phải có trong danh-ba.json của log, loại thread khớp loaiCuoc.
   - Kill switch `OUTBOX_ENABLED` (mặc định TẮT) để không đổi hành vi khi chưa bật.
3. `scripts/outbox.ts` + `pnpm outbox:add|approve|list|cancel`: add tra tenCuoc/loaiCuoc từ danh-ba.json; approve in lại nguyên văn và ghi banBam; KHÔNG có approve hàng loạt.
4. Hướng dẫn AI: thêm mục "Gửi tin" vào `daily-chat-export-guide.ts`, nâng dấu hiệu lên v5 (bot tự ghi lại F:\Zalo-Logs\CLAUDE.md, bản cũ vào _backup). Quy trình: soạn -> hiện nguyên văn -> anh ok ĐÚNG tin đó -> approve. Không duyệt gộp.
5. Test: store, sender (chỉ da_duyet, giành/restart, banBam, rate limit, thread lạ), script.
6. CHANGELOG [Chưa phát hành], docs/system-architecture.md.

## Rủi ro
zca-js không chính thức: gửi từ nick chính có thể bị khóa. Không gửi hàng loạt.
Sau khi xong: hỏi anh trước khi restart bot / push.

## Dữ liệu và GitHub
- Repo `vuhai2002/zalo-agent` đang PUBLIC. Code mới chỉ là logic, không chứa tin nhắn, threadId, tên người.
- Tin soạn nằm ở F:\Zalo-Logs\hop-thu-di (ngoài repo), không bao giờ vào git.
- Test dùng dữ liệu giả, không chép từ log thật.
- Không push khi chưa hỏi anh; mặc định chỉ commit trên máy.

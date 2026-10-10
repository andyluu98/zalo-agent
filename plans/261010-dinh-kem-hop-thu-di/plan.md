# Đính kèm tệp cho hộp thư đi có duyệt

Ngày: 2026-10-10. Nối tiếp `plans/261009-hop-thu-di-co-duyet/`.

## Vì sao

Người dùng nhờ Claude soạn tin rồi duyệt gửi qua hộp thư đi (đã có, chỉ gửi chữ). Cần gửi kèm
tệp trên máy (báo giá, hợp đồng, ảnh) cho đúng người trong cùng một tin. zca-js đã hỗ trợ
`sendMessage({ msg, attachments: [đường dẫn] })` (đang dùng ở `send-attachment-with-caption.ts`).

## Phạm vi

1. `outbox-file-store.ts`: trường `tepDinhKem?: { duongDan, kichThuoc, bam }[]` (tối đa 10 tệp,
   mỗi tệp tối đa 100 MB, đường dẫn tuyệt đối); `moTaTep`, `kiemTepConNguyen`, `bamTin`.
2. Mã duyệt `banBam = bamTin(tin)` gồm nội dung + mô tả từng tệp. Tin KHÔNG tệp ra đúng
   `bamNoiDung` cũ: 21 tin đã gửi và tin đang duyệt từ bản trước vẫn hợp lệ.
3. `outbox-sender.ts`: kiểm mã duyệt bằng `bamTin`; đọc lại tệp trên đĩa NGAY trước khi gửi
   (sửa / thay / xóa sau khi duyệt -> `loi`, không gửi); cho phép tin chỉ có tệp, không chữ.
4. `outbox-watcher.ts`: có tệp thì một lời gọi `sendMessage({ msg, attachments })`; msgId lấy
   từ `message` hoặc `attachment[0]`.
5. `scripts/outbox.ts`: `add --attach <tệp>` lặp được; `approve` kiểm tệp còn nguyên trước khi duyệt;
   `show` / `list` hiện tệp.
6. Hướng dẫn trong `daily-chat-export-guide.ts` (CLAUDE.md của thư mục log) thêm `--attach`.

## Không làm

- Không tải tệp từ URL (chỉ tệp trên máy người dùng). Không đổi luồng duyệt, chống gửi lặp, giãn nhịp.
- Không lùi về "gửi riêng phần chữ" khi tệp hỏng: hoặc gửi đủ, hoặc `loi`.

## Xong khi

- Test `outbox-sender.test.ts` có ca: gửi kèm nhiều tệp, tin chỉ tệp, tệp sửa / xóa sau duyệt,
  thêm tệp vào tin đã duyệt, tương thích mã duyệt cũ, chặn đường dẫn tương đối / tệp rỗng.
- `pnpm typecheck` + full suite xanh. Thử thật: một tin kèm tệp tới nick phụ của người dùng.

# Tag tên (@người) cho hộp thư đi + skill gửi Zalo dùng chung

Ngày: 2026-10-10. Nối tiếp `plans/261010-dinh-kem-hop-thu-di/`.

## Vì sao

1. Người dùng cần tag người trong nhóm khi gửi tin qua hộp thư đi, làm ngầm (không điều khiển Zalo PC).
   zca-js đã hỗ trợ `sendMessage({ msg, mentions: [{ pos, uid, len }] })` (đang dùng ở `tag-member-tool.ts`);
   tag tất cả dùng `uid: "-1"`.
2. Các phiên Claude khác không biết máy có hộp thư đi nên tự điều khiển Zalo PC bằng chuột.

## Phạm vi

1. `outbox-file-store.ts`: trường `nhacTen?: { uid, pos, len }[]` (tối đa 20), lưu vị trí lúc tạo tin.
   `bamTin` gộp cả tag; tin không tệp, không tag vẫn ra đúng `bamNoiDung` cũ.
2. `scripts/outbox.ts`: `--mention <uid>` (tên lấy từ bảng Người trong danh bạ), `--mention <uid>=<Tên>`,
   `--mention all`. Chưa có `@Tên` trong chữ thì tự chèn ở đầu tin. Chỉ cho tin nhóm.
3. `outbox-sender.ts`: kiểm tag hợp lệ (chỉ nhóm, `pos/len` nằm trong chữ, đoạn chữ bắt đầu bằng `@`).
4. `outbox-watcher.ts`: truyền `mentions` khi có.
5. Hướng dẫn trong `daily-chat-export-guide.ts` thêm `--mention`.
6. Ngoài repo: skill `~/.claude/skills/zalo-gui-tin/SKILL.md` + một dòng phân luồng trong
   `~/.claude/CLAUDE.md` (sao lưu trước): gửi Zalo đi qua hộp thư đi, không điều khiển Zalo PC.

## Xong khi

- Test: tag đúng vị trí, tự chèn @Tên, tag trong chat riêng bị từ chối, sửa chữ sau duyệt làm lệch tag thì không gửi,
  tương thích mã duyệt cũ. Typecheck + full suite xanh.

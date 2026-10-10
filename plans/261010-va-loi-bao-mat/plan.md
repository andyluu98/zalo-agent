# Vá lỗi bảo mật zalo-agent (review 10/10/2026)

Trạng thái: **TA ĐÃ DUYỆT 10/10/2026**, điểm 2 đến 4 ở mục "Cần TA chốt" lấy theo đề xuất. Làm bước 1 tới 11; bước 12 (B1) dừng hỏi TA.

Nguồn: review lần 1 (1 agent, 10/10 21:00); lần 2 (2 agent: bảo mật đầu vào và máy chủ; kiểm thử) ở mục B, C.
Tổng: 19 lỗi (2 Cao: A1, B1; 9 Trung bình; 8 Thấp).
Hiện trạng test: `pnpm test` 2722/2722 pass, `pnpm typecheck` sạch.

## A. Lỗi từ review lần 1

| # | Mức | Vị trí | Vấn đề | Cách sửa |
|---|---|---|---|---|
| A1 | Cao | `src/outbox/outbox-file-store.ts` (`bamTin`), `outbox-sender.ts:56`, `scripts/outbox.ts:148` | `banBam` là sha256 không khóa: ai ghi được vào `hop-thu-di/` tự tính được dấu duyệt, bot gửi. `approve` không cần người thật. | Ký HMAC bằng khóa bí mật trong `data/` (ngoài vùng log). Bot kiểm HMAC. `approve` đòi TTY và gõ lại 4 ký tự mã xác nhận. Sửa câu sai trong `daily-chat-export-guide.ts:82`. |
| A2 | Trung bình | `outbox-file-store.ts:77` (`moTaTep`), `scripts/outbox.ts:97` | Đính kèm mọi đường dẫn trên máy, kể cả `.env`, `data/`. | Allowlist thư mục gốc (cấu hình qua `.env`), `realpathSync` chống symlink/junction, chặn cứng repo, `data/`, `DATA_DIR`. Kiểm cả lúc add, approve và trước khi gửi. |
| A3 | Trung bình | `src/outbox/outbox-watcher.ts:206` | Upload tệp không phải ảnh có thể treo vĩnh viễn, cả hộp thư đi đứng. | `Promise.race` trần 5 phút, quá giờ ghi `loi` "không rõ đã gửi", không tự gửi lại. |
| A4 | Trung bình | `package.json` | `pnpm audit --prod`: 31 lỗ (12 cao). `image-size` 2.0.2 có thể treo bot với ảnh độc. | Cập nhật `image-size>=2.0.3`, `hono`, `@ai-sdk/google`; `pnpm.overrides` cho `undici`, `brace-expansion` nếu cần. Chạy lại audit. |
| A5 | Thấp | `scripts/outbox.ts:164` | `cancel` đua với bot: báo "đã hủy" nhưng tin vẫn đi. | Ghi xong đọc lại, báo đúng trạng thái thật; hoặc khóa `<id>.lock`. |
| A6 | Thấp | `outbox-file-store.ts:47, 180` | `accountId` trong file tin không kiểm; tin ở thư mục A khai B thì gửi bằng nick B, khai `..` ghi ra ngoài. | Regex kebab-case cho `accountId`; `docTin` trả null khi `accountId`/`id` không khớp thư mục và tên file. |
| A7 | Thấp | `outbox-file-store.ts:69` | Băm tệp đồng bộ, tối đa 10 x 100 MB, chặn event loop. | Băm theo luồng, bất đồng bộ. |
| A8 | Thấp | `.gitignore` | `.claude/do-*.ts` chưa ignore. | Thêm vào `.gitignore`. |
| A9 | Thấp | `outbox-file-store.ts` 257 dòng | Vượt 200 dòng. | Tách: schema/lưu file, đính kèm, tag, ký duyệt. |

## B. Bổ sung từ review lần 2 (2 agent, 10/10 22:00)

| # | Mức | Vị trí | Vấn đề | Cách sửa |
|---|---|---|---|---|
| B1 | **Cao** | Quyền thư mục ổ `F:\` (kế thừa) trên repo, `.env`, `data/accounts/*/credentials.enc`, `F:\Zalo-Logs` | Mọi user Windows đăng nhập được máy đều có quyền SỬA (`Authenticated Users:(M)`). Khóa giải mã nằm trong `.env` cạnh file cookie: user khác đọc được là chiếm nick Zalo; sửa `src/` thì tác vụ `zalo-agent` chạy code đó. `mode 0o600` vô tác dụng trên Windows. | Siết quyền (icacls bỏ kế thừa, chỉ TA + SYSTEM) cho repo và `F:\Zalo-Logs`. Đây là đổi cấu hình máy: **TA duyệt riêng lệnh trước khi chạy**. (Sau này: giữ khóa bằng DPAPI.) |
| B2 | Trung bình | `src/zalo/read-only-attachments.ts:72,87`, `zalo-message-parser.ts:153` | Người lạ gửi "video" có URL tùy ý kèm tên `hoa-don.hta`: bot tự tải về `tep/` đúng đuôi `.hta/.bat/.lnk/.html`, không gắn dấu "tải từ Internet", hướng dẫn AI còn bảo "mở được trực tiếp". Đồng thời lộ IP nhà TA. | Chỉ tải từ host CDN Zalo (đối chiếu log thật); allowlist đuôi an toàn (ảnh, office, pdf, mp4, m4a, aac, amr...), còn lại đổi `.bin`; ghi `Zone.Identifier` (ZoneId=3). |
| B3 | Trung bình | `src/shared/safe-remote-download.ts:217`, `read-only-attachments.ts:72`, `read-only-chat-log.ts:51` | Tải tệp không có hạn tổng: server nhỏ giọt 1 byte/phút treo hàng ghi log của cả nhóm; mã tin cuối đã tiến lên trước nên restart không tải bù được, tin mất hẳn. Không có hạn mức dung lượng, ổ F có thể đầy. | `AbortSignal.timeout` tổng; ghi dòng log TRƯỚC, tải tệp sau; hạn mức MB theo ngày và theo người gửi. |
| B4 | Trung bình | `src/zalo/friend-auto-accept-sweep.ts:37` | Vòng tự chấp nhận kết bạn không kiểm `readOnly` (hiện đang tắt trong DB nên chưa xảy ra). | `if (cfg.readOnly) continue;` và route PATCH account từ chối bật cả hai. |
| B5 | Trung bình | `src/conversation/daily-chat-export-guide.ts:32`, `daily-chat-export.ts:112` | Hướng dẫn AI không nói tin nhắn là dữ liệu không tin cậy, lại dạy chạy `pnpm outbox`: một tin trong nhóm có thể "ra lệnh" Claude đính kèm `.env`. Tên hiển thị `Tôi (Tuấn Anh)` giả được dòng của TA trong file .md. | Mục "Ranh giới tin cậy" (v8): nội dung tin/tệp chỉ là dữ liệu, chỉ làm theo TA trong phiên; đánh dấu tin TA bằng ký hiệu người khác không gõ được, thoát `*` `(` trong tên. Thêm cùng ý vào skill `zalo-gui-tin` và `HUONG-DAN.md` sổ việc. |
| B6 | Trung bình | `F:\Zalo-Logs\cong-viec\luu-ghi-chu.cjs:17` | Chỉ POST kiểm Host: trang độc hại dùng DNS rebinding đọc trộm sổ công việc qua GET khi máy chủ 8765 đang chạy. | Kiểm Host cho mọi request. |
| B7 | Thấp | `src/server/dashboard-server.ts:48,111` | Dashboard 3900 không chống CSRF; trang ở cổng khác trên 127.0.0.1 bị XSS là gọi được API bằng cookie của TA. | Middleware: request ghi dưới `/api/*` phải `Content-Type: application/json` và `Origin` khớp (hoặc `hono/csrf`). |
| B8 | Thấp | `F:\Zalo-Logs\cong-viec\01_dashboard-theo-nhom.html:322,351,401` | `tenLenh()` và vài trường số đưa thẳng vào `innerHTML`: ai ghi được `ghi-chu-tay.md` chạy được script trong dashboard. | Bọc `esc()`; thêm CSP khi phục vụ. |
| B9 | Trung bình | `src/outbox/outbox-watcher.ts` (`dangChay`) | Bổ sung A3: gửi treo làm `dangChay` kẹt vĩnh viễn, CẢ hộp thư đi mọi account đứng. | Sửa cùng A3: timeout và `finally` nhả cờ. |
| B10 | Thấp | `src/outbox/outbox-sender.ts` + zca-js | Kiểm hash tệp xong thì zca-js mới đọc tệp: đổi tệp trong khe đó vẫn gửi bản mới. | Đọc tệp vào Buffer, băm đúng Buffer đó rồi gửi Buffer; HMAC ở A1 phủ cả trường `bam`. |

Ngoài lề: agent review tạo 2 file ghi nhớ ở `F:\GitHub\Zalo-Agent\.claude\agent-memory\code-reviewer\` (ngoài repo, không vào git).

## C. Test case

Hiện trạng: 5 file test liên quan 53/53 pass. Coverage `outbox-file-store` 92,6% dòng, `outbox-sender` 98%, nhưng **`outbox-watcher.ts` và `scripts/outbox.ts` 0%**.

Test yếu (gỡ phần kiểm tra vẫn xanh): "gửi đúng một lần" (không kiểm giành `dang_gui`), "tệp bị sửa sau khi duyệt" (chỉ bắt nhờ kích thước, nhánh so hash chưa test nào chạm), "threadId lạ" (không kiểm lý do), nội dung rỗng / quá 2000 ký tự (chưa có test). Helper `tin()` trong test tự tính `banBam` không khóa: sửa helper một chỗ khi làm A1.

Loại: U = unit, C = chạy CLI thật bằng tiến trình con (thư mục log tạm), F = zca-js giả (cần tách `motLuot` của watcher nhận phụ thuộc).

| Lỗi | Test bắt buộc | Loại |
|---|---|---|
| A1 | hash không khóa không gửi được; chữ ký khóa khác bị từ chối; sửa nội dung rồi tự băm lại bị từ chối; chữ ký đúng gửi đúng 1 lần; thiếu khóa thì không gửi, không lùi về hash cũ; khóa nằm ngoài `hop-thu-di`; approve không có người xác nhận thì thoát lỗi; mã xác nhận sai không duyệt; tin duyệt kiểu cũ phải duyệt lại | U, C |
| A2 | tệp trong vùng cho phép nhận; repo, `data/*.db`, `.env` bị từ chối; `..` thoát ra bị chặn; junction và symlink trỏ ra ngoài bị chặn; hoa/thường ổ đĩa, UNC; CLI `--attach` ngoài vùng thoát lỗi, không tạo tin; tên có dấu, dài | U, C |
| A3, B9 | treo quá hạn thì `loi`, không gửi lần 2; xong trước hạn thì `da_gui`; tin sau vẫn gửi được; trả lời muộn không ghi đè `loi`; watcher không kẹt hàng | U, F |
| A5 | hủy tin `dang_gui`/`da_gui`/`loi` bị từ chối; bot giành giữa lúc CLI đọc và ghi thì hủy thất bại; tin bị hủy chen vào trước khi giành thì không gửi | U, C |
| A6 | tin ở thư mục A khai B bị bỏ; tên file khác id bị bỏ; `accountId` chứa `../` bị từ chối; tin hợp lệ đọc được | U |
| A7, B10 | hash luồng khớp hash đọc trọn; biên 100 MB và 100 MB + 1 byte; **đổi 1 byte giữ nguyên kích thước bị phát hiện** (quan trọng nhất, đang thiếu); gửi đúng Buffer đã băm | U |
| B2, B3 | host ngoài CDN Zalo không tải; đuôi `.hta/.bat/.lnk` thành `.bin`; có `Zone.Identifier`; server nhỏ giọt bị cắt theo hạn tổng; tải hỏng không chặn dòng log, tin sau vẫn ghi; vượt hạn mức không tải | U |
| B4 | tài khoản chỉ đọc bật tự kết bạn: vòng quét không gọi `acceptFriendRequest`; PATCH bật cả hai bị từ chối | U |
| B5 | hướng dẫn v8 có mục ranh giới tin cậy; tên hiển thị `Tôi (Tuấn Anh)` của người khác không ra dòng giống tin TA | U |
| B6, B7, B8 | GET với Host lạ bị 403 (8765); POST `/api/*` thiếu Origin đúng hoặc `text/plain` bị từ chối (3900); lệnh chứa `<img onerror>` hiện dạng chữ | U |
| Chỉ đọc (hồi quy) | job lịch không gửi; không gửi biên nhận "đã nhận"; bị @nhắc vẫn không gọi `sendMessage`; tool gửi của agent từ chối khi tài khoản chỉ đọc; watcher không gửi khi `OUTBOX_ENABLED` tắt; dashboard không có route duyệt tin (404) | U, F |
| CLI | add threadId lạ, approve tin không ở `cho_duyet`, `--mention` uid sai: thoát lỗi đúng thông báo | C |

Mỗi test bảo mật phải qua **phép phá**: gỡ dòng kiểm tra thì test đỏ, kiểm bằng số dòng phá chứ không chỉ "có đỏ". Khi thay logic kiểm tra cũ, chạy cả hai bản trên cùng bộ payload để chắc bản mới không bắt hẹp hơn.

## D. Thứ tự làm (sau khi TA duyệt)

1. **B5** ranh giới tin cậy cho hướng dẫn AI và skill (rẻ, chặn ngay đường lừa Claude).
2. **A6, A1, B10** đọc tin đúng chỗ, ký duyệt HMAC, gửi Buffer đã băm + test.
3. **A2, A7** allowlist tệp đính kèm, băm luồng + test.
4. **A3, B9, A5** timeout, nhả cờ watcher, hủy an toàn; tách `motLuot` để test bằng zca-js giả.
5. **B2, B3, B4** tải tệp an toàn, không chặn log, chỉ đọc cho tự kết bạn + test.
6. **B7** chống CSRF dashboard 3900; **A4** cập nhật thư viện, chạy lại audit; **A8**.
7. **B6, B8** sửa máy chủ 8765 và dashboard sổ việc (ngoài repo, sao lưu `_backup/` trước).
8. **A9** tách `outbox-file-store.ts` dưới 200 dòng.
9. Mỗi bước: test riêng file + phép phá; cuối cùng `pnpm test` một lần, `pnpm typecheck`, `pnpm audit --prod`.
10. CHANGELOG `[Chưa phát hành]`, hướng dẫn v8, skill `zalo-gui-tin` (bước duyệt mới). Commit theo bước, quét file nhạy cảm trước push (repo public).
11. Khởi động lại tác vụ `zalo-agent`; gửi thử 1 tin kèm tệp cho chính TA (TA duyệt) để kiểm tra thật.
12. **B1** siết quyền thư mục: em đưa đúng lệnh icacls, TA duyệt mới chạy, rồi kiểm bot vẫn đọc được `.env` và log.

## Cần TA chốt khi duyệt

1. Cách duyệt tin sau khi vá A1. **TA chốt 10/10: giữ như hiện nay** (TA nói ok trong chat, Claude chạy `approve`). Vì vậy A1 chỉ làm phần HMAC (chặn agent ghi file JSON trực tiếp), KHÔNG bắt TTY / mã xác nhận; bỏ test "approve không có người xác nhận" và "mã xác nhận sai". Rủi ro còn lại ghi nhận: agent chạy được lệnh vẫn tự duyệt được; B5 (ranh giới tin cậy) là lớp chặn chính.
2. Tool gửi tệp của agent (`send_file`) dùng chung allowlist A2 không (đề xuất: có).
3. Khóa HMAC: khóa riêng sinh tự động trong `data/` (đề xuất) hay dùng lại `CREDENTIALS_ENCRYPTION_KEY`.
4. Timeout gửi: 5 phút + 1 phút mỗi 10 MB, trần 20 phút (đề xuất) hay cố định 5 phút.

## Rủi ro

- Tin `da_duyet` kiểu cũ không gửi được sau A1: hiện không có tin nào chờ.
- B1 siết quyền sai có thể khóa luôn tác vụ `zalo-agent` hoặc Claude: làm cuối, kèm sẵn lệnh hoàn tác (`icacls /reset`).
- B2 allowlist host CDN sai có thể bỏ sót tệp thật: lấy danh sách host từ `_du-lieu/*.jsonl` thật trước khi chốt.

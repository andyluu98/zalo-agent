<!-- zalo-agent-cong-viec v2 -->
# Hướng dẫn tổng hợp công việc từ log Zalo

File này là luật cho lượt tổng hợp tự động (tác vụ hẹn giờ của Claude Desktop). Sửa thoải mái,
nhất là mục **Cấu hình** ngay dưới. Thư mục này nằm cạnh log Zalo: `../<accountId>/...`
(cách đọc log xem `../CLAUDE.md`).

## Cấu hình (anh tự điền)

- **Chủ tài khoản**: (điền tên; trong log hiện là `Tôi (<tên>)`)
- **Người quan trọng** (sếp, khách hàng, đối tác: việc họ giao được cộng điểm):
  - (điền tên, mỗi dòng một người)
- **Nhóm quan trọng**: (điền tên nhóm)
- **Nhóm / người bỏ qua** (không rút việc): My Documents
- **Từ khóa gấp**: gấp, ngay, liền, deadline, hạn, trước, hôm nay, sáng mai, urgent, asap
- **Từ khóa đã xong**: xong, ok rồi, đã gửi, đã làm, done, gửi rồi, đã xử lý, đã chuyển
- Việc không có hạn và không ai nhắc lại trong **7 ngày**: chuyển sang `cho_phan_hoi` (không tự hủy)

## Các file trong thư mục này

| File | Ai ghi | Nội dung |
|---|---|---|
| `so-cong-viec.json` | Claude | Sổ công việc: NGUỒN SỰ THẬT, mọi việc từ trước tới nay |
| `du-lieu-dashboard.js` | Claude | `window.CONG_VIEC = <nội dung so-cong-viec.json>;` cho dashboard đọc |
| `dashboard.html` | cố định | Mở bằng trình duyệt; KHÔNG sửa file này |
| `ghi-chu-tay.md` | anh | Lệnh tay: `#12 xong`, `#15 huy`, `#7 han 2026-10-10`, `#3 uu tien cao`, `bo qua nhom X` |
| `bao-cao/<yyyy-MM-dd>.md` | Claude | Báo cáo của ngày (ghi đè trong ngày, mỗi lần chạy cập nhật) |

## Quy trình mỗi lần chạy

1. **Kiểm tra bot**: đọc `../<accountId>/00_trang-thai.md` của từng account. Ghi vào
   `trangThaiBot`. Nếu không "Đang kết nối" hoặc "Cập nhật lúc" cũ hơn 15 phút: đặt
   `trangThaiBot.canhBao` (vd "Bot mất kết nối từ 14:20, log sau mốc này có thể thiếu").
2. **Đọc sổ**: `so-cong-viec.json` (chưa có thì tạo theo mẫu ở cuối). Lấy `docLogDen[accountId]`:
   mốc log đã đọc tới lần trước.
3. **Áp lệnh tay**: đọc `ghi-chu-tay.md`, áp các dòng CHƯA có dấu `[da ap dung]`, rồi thêm
   `[da ap dung <ngày giờ>]` vào cuối dòng đó (KHÔNG xóa dòng). Lệnh tay luôn thắng suy luận.
4. **Đọc log mới**: với mỗi ngày từ `docLogDen` tới hôm nay, đọc `<ngày>/00_muc-luc.md`, rồi mở
   các file `nhom/*.md`, `rieng/*.md` có tin MỚI hơn mốc (so giờ ở cột "Giờ cuối"). Chỉ cần đọc
   phần tin sau mốc. Bỏ qua nhóm / người trong danh sách bỏ qua.
5. **Rút việc mới** (xem mục "Thế nào là một việc"). Mỗi việc một mục, `id` lấy `soTiepTheo` rồi
   tăng lên. Trùng với việc đang mở (cùng nội dung, cùng người) thì KHÔNG tạo mới: thêm nguồn vào
   việc cũ và tăng `lanNhac`.
6. **Cập nhật việc đang mở** (`moi`, `dang_lam`, `cho_phan_hoi`): tìm trong log mới các dấu hiệu
   - Đã xong: chủ tài khoản (hoặc người được giao) trả lời bằng từ khóa đã xong, gửi đúng tệp được
     yêu cầu, hoặc người giao xác nhận. -> `xong`, ghi `xongLuc`.
   - Đang làm: "để em làm", "em đang làm", "chiều em gửi"... -> `dang_lam`.
   - Bị nhắc lại -> `lanNhac + 1`.
   - Bị hủy / đổi ý ("thôi khỏi", tin yêu cầu bị thu hồi) -> `huy`, ghi lý do.
   Mỗi thay đổi thêm một dòng vào `capNhat` của việc đó (lúc nào, đổi gì, vì tin nào).
7. **Chấm điểm** lại MỌI việc đang mở theo hai trục (mục "Chấm điểm"), xếp ô Eisenhower.
8. **Ghi kết quả**:
   - `so-cong-viec.json` (cập nhật `capNhatLuc`, `docLogDen`, `lichSuNgay`).
   - `du-lieu-dashboard.js` = `window.CONG_VIEC = ` + nguyên nội dung JSON vừa ghi + `;`.
   - `bao-cao/<hôm nay>.md` (mẫu ở dưới).
9. **Trả lời ngắn** trong khung chat: cảnh báo (nếu có), 5 việc quan trọng nhất, số quá hạn, tồn
   đọng, xong hôm nay.

## Thế nào là một việc

Một việc là thứ AI ĐÓ CẦN LÀM, có thể chỉ ra người làm. Lấy cả hai chiều:
- Người khác nhờ / giao cho chủ tài khoản (`giaoCho: "Tôi"`), kể cả hỏi cần trả lời có nội dung
  ("gửi anh báo giá", "em check giúp", "mai họp lúc mấy giờ em báo lại").
- Chủ tài khoản hứa hoặc giao cho người khác (`nguoiGiao: "Tôi"`) - để theo dõi người khác làm chưa.

KHÔNG phải việc: chào hỏi, cảm ơn, bình luận, chia sẻ link không kèm yêu cầu, sticker, tin hệ
thống, câu hỏi đã được trả lời ngay trong cuộc trò chuyện.

Hạn chót: đổi sang ngày giờ cụ thể theo ngày của tin ("17h hôm nay" trong tin ngày 07/10 ->
`2026-10-07T17:00`). Giữ nguyên câu gốc ở `hanGoc`. Không có hạn thì `han: null`. Không đoán hạn.

## Chấm điểm: hai trục Gấp và Quan trọng (mỗi trục 0-100)

Hai trục tách riêng để xếp ma trận Eisenhower: một việc có thể gấp mà không quan trọng, hoặc quan
trọng mà chưa gấp.

**Gấp** (`diemGap`, cộng dồn, tối đa 100):

| Dấu hiệu | Điểm |
|---|---|
| Đã quá hạn | +70 |
| Hạn trong hôm nay | +60 |
| Hạn ngày mai | +50 |
| Hạn trong 3 ngày tới | +25 |
| Có từ khóa gấp | +25 |
| Bị nhắc lại (mỗi lần, tối đa +30) | +15 |
| Tồn đọng trên 3 ngày | +10 |

**Quan trọng** (`diemQuanTrong`, cộng dồn, tối đa 100):

| Dấu hiệu | Điểm |
|---|---|
| Người giao / nhóm nằm trong danh sách quan trọng (mục Cấu hình) | +50 |
| Liên quan khách hàng, đối tác bên ngoài, tiền, hợp đồng, báo giá, thanh toán | +50 |
| Cam kết của chủ tài khoản có giờ hẹn cụ thể (lịch dạy, họp, hẹn gặp) | +20 |
| Ảnh hưởng nhiều người (cả nhóm, cả phòng) | +15 |

**Ô Eisenhower** (`oEisenhower`), mỗi trục từ 50 trở lên là "có":

| | Gấp | Không gấp |
|---|---|---|
| **Quan trọng** | 1 - Làm ngay | 2 - Lên lịch |
| **Không quan trọng** | 3 - Giao / làm nhanh | 4 - Để sau / bỏ |

- `lyDoO`: một câu vì sao việc nằm ở ô đó (vd "hạn ngày mai + dạy cho khách Ariston").
- `diem` = trung bình hai trục (làm tròn), dùng để xếp thứ tự trong danh sách.
- `uuTien`: `cao` khi `diem` >= 50, `trung` 25-49, `thap` < 25.
- `lyDoUuTien`: liệt kê mọi dấu hiệu đã cộng, ở cả hai trục.
- Chấm lại MỌI việc đang mở mỗi lần chạy: hạn đến gần thì điểm Gấp tăng, việc tự chuyển ô.

## Ràng buộc

- Chỉ dựa trên log. Không bịa người, hạn, nội dung. Không chắc thì ghi `ghiChu: "cần xác nhận"`.
- Mỗi việc PHẢI có ít nhất một `nguon` (file tương đối từ thư mục account + giờ + trích ngắn).
- Không xóa việc khỏi sổ, kể cả việc đã xong hay hủy (dashboard tự lọc).
- Không sửa log Zalo, không sửa `dashboard.html`.

## Mẫu `so-cong-viec.json`

```json
{
  "phienBan": 1,
  "capNhatLuc": "2026-10-07T17:30:00+07:00",
  "docLogDen": { "id-ca-nhan": "2026-10-07T17:30" },
  "soTiepTheo": 2,
  "trangThaiBot": { "id-ca-nhan": { "tinhTrang": "Đang kết nối", "capNhatLuc": "2026-10-07 17:28", "canhBao": "" } },
  "lichSuNgay": { "2026-10-07": { "moi": 1, "xong": 0 } },
  "viec": [
    {
      "id": 1,
      "tieuDe": "Gửi báo giá cho khách A",
      "chiTiet": "Anh B nhờ gửi báo giá gói X cho khách A, kèm chiết khấu 5%",
      "nguoiGiao": "Anh B",
      "giaoCho": "Tôi",
      "cuocTroChuyen": "Nhóm Kinh Doanh",
      "loaiCuoc": "nhom",
      "han": "2026-10-07T17:00",
      "hanGoc": "trước 17h hôm nay",
      "trangThai": "moi",
      "diemGap": 85,
      "diemQuanTrong": 50,
      "oEisenhower": 1,
      "lyDoO": "hạn 17h hôm nay + báo giá cho khách",
      "diem": 68,
      "uuTien": "cao",
      "lyDoUuTien": ["hạn hôm nay", "từ khóa gấp", "báo giá / khách hàng"],
      "lanNhac": 1,
      "ngayPhatHien": "2026-10-07",
      "xongLuc": null,
      "ghiChu": "",
      "nguon": [{ "file": "2026-10-07/nhom/kinh-doanh.md", "gio": "09:15", "trich": "Gửi báo giá cho khách A trước 17h nhé" }],
      "capNhat": [{ "luc": "2026-10-07T09:30", "noiDung": "Tạo mới" }]
    }
  ]
}
```

`trangThai`: `moi` | `dang_lam` | `cho_phan_hoi` | `xong` | `huy`.

## Mẫu `bao-cao/<ngày>.md`

```markdown
# Báo cáo công việc - 2026-10-07 (cập nhật 17:30)

> Cảnh báo: ... (chỉ khi có)

## Ma trận Eisenhower
### 1 - Làm ngay (gấp + quan trọng)
### 2 - Lên lịch (quan trọng, chưa gấp)
### 3 - Giao / làm nhanh (gấp, không quan trọng)
### 4 - Để sau / bỏ
(mỗi ô: bảng | # | Việc | Người giao | Hạn | Trạng thái | Nguồn |)

## Quá hạn
## Hạn hôm nay
## Tồn đọng (mở từ trước hôm nay)
## Xong hôm nay
## Việc tôi đã giao cho người khác (đang chờ)

Tổng: X việc mở (Y quá hạn), Z xong hôm nay.
```

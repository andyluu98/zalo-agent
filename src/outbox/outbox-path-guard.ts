import fs from "node:fs";
import path from "node:path";

/**
 * Ranh giới đường dẫn của tệp đính kèm. Module THUẦN về cấu hình: danh sách
 * thư mục do người gọi truyền (CLI, bot, tool agent), không đọc env ở đây.
 */

/** Nhóm thư mục được phép + nhóm bị chặn cứng (chặn thắng, kể cả khi nằm trong thư mục được phép) */
export type QuyDinhTep = { thuMucDuocPhep: string[]; thuMucChan: string[] };

/**
 * `con` có nằm trong (hoặc bằng) thư mục `thuMuc` không. So sánh theo đường dẫn
 * đã chuẩn hóa; Windows không phân biệt hoa/thường (ổ `C:` = `c:`). Hàm THUẦN:
 * không chạm đĩa, nên cũng không giải symlink / junction - gọi nó trên đường
 * dẫn đã qua `giaiDuongDanThat` khi cần chống đường vòng.
 */
export function laTrongThuMuc(con: string, thuMuc: string): boolean {
  const chuanHoa = (p: string) => {
    const r = path.resolve(p);
    return process.platform === "win32" ? r.toLowerCase() : r;
  };
  const rel = path.relative(chuanHoa(thuMuc), chuanHoa(con));
  if (rel === "") return true;
  // Khác ổ / khác UNC: path.relative trả lại đường tuyệt đối
  return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/** Đường dẫn THẬT sau khi giải symlink / junction / tên ngắn 8.3; null nếu không tồn tại */
export function giaiDuongDanThat(p: string): string | null {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
}

/** Tên tệp không bao giờ được đính kèm, ở bất kỳ thư mục nào */
const TEN_NHAY_CAM = [/^\.env(\..*)?$/i, /^credentials\.enc$/i, /^outbox-hmac\.key$/i, /\.db(-wal|-shm)?$/i];

export function laTenTepNhayCam(ten: string): boolean {
  return TEN_NHAY_CAM.some((re) => re.test(ten));
}

/**
 * Kiểm một đường dẫn tuyệt đối trước khi cho đính kèm / gửi và trả về đường dẫn
 * THẬT (đã giải symlink / junction). Ném Error kèm lý do dễ đọc khi bị từ chối.
 * Thứ tự: tồn tại -> tên nhạy cảm -> thư mục chặn cứng -> phải nằm trong thư mục được phép.
 */
export function kiemDuongDanTep(duongDan: string, q: QuyDinhTep): string {
  if (!path.isAbsolute(duongDan)) throw new Error(`cần đường dẫn tuyệt đối: ${duongDan}`);
  const that = giaiDuongDanThat(duongDan);
  if (!that) throw new Error(`không thấy tệp: ${duongDan}`);
  if (laTenTepNhayCam(path.basename(that))) throw new Error(`tệp nhạy cảm, không được đính kèm: ${duongDan}`);
  for (const chan of q.thuMucChan) {
    const dich = [path.resolve(chan), giaiDuongDanThat(chan)].filter((x): x is string => !!x);
    if (dich.some((d) => laTrongThuMuc(that, d))) throw new Error(`thư mục bị chặn (mã nguồn bot / dữ liệu bot): ${duongDan}`);
  }
  const goc = q.thuMucDuocPhep.map(giaiDuongDanThat).filter((x): x is string => !!x);
  if (!goc.some((g) => laTrongThuMuc(that, g))) {
    throw new Error(`ngoài các thư mục được phép đính kèm (OUTBOX_ATTACH_ALLOWED_DIRS): ${duongDan}`);
  }
  return that;
}

/** Hai đường dẫn thật có cùng một tệp không (Windows không phân biệt hoa/thường) */
export function cungDuongDan(a: string, b: string): boolean {
  const n = (p: string) => (process.platform === "win32" ? path.normalize(p).toLowerCase() : path.normalize(p));
  return n(a) === n(b);
}

/**
 * Dùng cho tool gửi tệp của agent (kho shared-files): tệp phải nằm THẬT SỰ trong
 * `thuMucGoc` sau khi giải symlink / junction, và không phải tệp nhạy cảm.
 * Trả về đường dẫn thật hoặc ném Error.
 */
export function kiemTepTrongThuMuc(duongDan: string, thuMucGoc: string): string {
  const that = giaiDuongDanThat(duongDan);
  const goc = giaiDuongDanThat(thuMucGoc);
  if (!that || !goc) throw new Error(`không thấy tệp: ${path.basename(duongDan)}`);
  if (!laTrongThuMuc(that, goc) || laTenTepNhayCam(path.basename(that))) {
    throw new Error(`tệp nằm ngoài kho cho phép: ${path.basename(duongDan)}`);
  }
  return that;
}

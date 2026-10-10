import fs from "node:fs";
import path from "node:path";

/**
 * Luật an toàn cho tệp đính kèm của tin chỉ đọc. Người lạ điều khiển được URL
 * (tin "video" trỏ URL tùy ý) lẫn tên tệp (`hoa-don.hta`), nên:
 *  1. chỉ tải từ CDN của Zalo (không lộ IP máy này ra máy chủ lạ);
 *  2. chỉ giữ đuôi thuộc danh sách an toàn, còn lại đổi `.bin`;
 *  3. gắn dấu "tải từ Internet" (Zone.Identifier) để Windows cảnh báo khi mở.
 */

/**
 * Hậu tố host CDN. Ba cái đầu LẤY TỪ LOG THẬT (`_du-lieu/*.jsonl`, 07-10/10/2026):
 * ảnh + thoại `*.zdn.vn`, file `*.dlfl.vn`, video `*.dlmd.me`. Hai cái sau
 * (`zadn.vn`, `zaloapp.com`) chưa gặp trong log nhưng là tên miền của Zalo.
 */
export const HAU_TO_HOST_CDN_ZALO = [".zdn.vn", ".dlfl.vn", ".dlmd.me", ".zadn.vn", ".zaloapp.com"] as const;

/** https, cổng mặc định, không userinfo, host kết thúc bằng một hậu tố CDN (có dấu chấm đầu) */
export function laHostCdnZalo(rawUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.port !== "" || u.username !== "" || u.password !== "") return false;
  const host = u.hostname.toLowerCase();
  return HAU_TO_HOST_CDN_ZALO.some((h) => host.endsWith(h));
}

/** Đuôi được giữ nguyên. KHÔNG có script / shortcut / html / svg / macro (docm, xlsm) / exe */
export const DUOI_AN_TOAN: ReadonlySet<string> = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".bmp",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".pdf", ".txt", ".csv",
  ".zip", ".rar", ".7z",
  ".mp4", ".mov",
  ".m4a", ".aac", ".amr", ".mp3", ".ogg",
]);

const DUOI_THEO_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "audio/mp4": ".m4a",
  "audio/aac": ".aac",
  "audio/mpeg": ".mp3",
  "audio/amr": ".amr",
};

/**
 * Chọn đuôi file lưu. Tên gốc CÓ đuôi mà không an toàn thì `.bin` ngay (không
 * hỏi MIME: header do máy chủ khai, chỉ tin khi tên không nói gì).
 */
export function chonDuoiAnToan(tenGoc: string, mediaType: string, url: string): string {
  const duoiGoc = path.extname(tenGoc).toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/.test(duoiGoc)) return DUOI_AN_TOAN.has(duoiGoc) ? duoiGoc : ".bin";
  const theoMime = DUOI_THEO_MIME[mediaType.split(";")[0]!.trim().toLowerCase()];
  if (theoMime) return theoMime;
  let duoiUrl = "";
  try {
    duoiUrl = path.extname(new URL(url).pathname).toLowerCase();
  } catch {
    // URL đã qua laHostCdnZalo nên hiếm khi tới đây
  }
  return DUOI_AN_TOAN.has(duoiUrl) ? duoiUrl : ".bin";
}

/**
 * Gắn dấu "tải từ Internet" (ZoneId=3) bằng luồng dữ liệu phụ NTFS. Chỉ Windows;
 * hệ tệp không hỗ trợ (FAT, mạng) thì bỏ qua, không làm hỏng việc lưu tệp.
 */
export function ghiDauTaiTuInternet(duongDanTep: string): boolean {
  if (process.platform !== "win32") return false;
  try {
    fs.writeFileSync(`${duongDanTep}:Zone.Identifier`, "[ZoneTransfer]\r\nZoneId=3\r\n");
    return true;
  } catch {
    return false;
  }
}

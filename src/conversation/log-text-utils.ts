import fs from "node:fs";
import path from "node:path";
import { boDauTiengViet } from "../shared/bo-dau-tieng-viet.js";

/** Tiện ích chữ dùng chung cho các file log chỉ đọc (log ngày, danh bạ, mục lục) */

export function taoSlug(s: string): string {
  return boDauTiengViet(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
}

/** Chặn ký tự phá đường dẫn trong id dùng làm tên thư mục/file */
export function sachTen(s: string): string {
  return s.replace(/[^A-Za-z0-9_.-]/g, "_") || "_";
}

export function motDong(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function catNgan(s: string, toiDa: number): string {
  const g = motDong(s);
  return g.length > toiDa ? `${g.slice(0, toiDa)}...` : g;
}

/** Ô bảng markdown: một dòng, không phá cột */
export function oBang(s: string): string {
  return motDong(s).replace(/\|/g, "/");
}

/**
 * Chọn tên file (tương đối với thư mục ngày) cho một cuộc trò chuyện mới gặp
 * trong ngày: `nhom/<ten>.md` hoặc `rieng/<ten>.md`. Tên đã có file (của cuộc
 * trò chuyện KHÁC trùng tên) thì thêm 4 số cuối ID, vẫn trùng thì thêm cả ID.
 */
export function chonTenFileThread(
  thuMucNgay: string,
  t: { threadId: string; tenThread: string; laNhom: boolean },
): string {
  const thuMuc = t.laNhom ? "nhom" : "rieng";
  const goc = taoSlug(t.tenThread) || "chua-ro-ten";
  const id = sachTen(t.threadId);
  for (const ten of [goc, `${goc}-${id.slice(-4)}`, `${goc}-${id}`]) {
    const tuongDoi = `${thuMuc}/${ten}.md`;
    if (!fs.existsSync(path.join(thuMucNgay, tuongDoi))) return tuongDoi;
  }
  return `${thuMuc}/${goc}-${id}-${Date.now()}.md`;
}

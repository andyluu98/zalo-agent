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

/** Tên file .md của một cuộc trò chuyện - giống nhau mọi ngày để tìm bằng `rieng_vu-van-hai_*` */
export function tenFileThread(t: { threadId: string; tenThread: string; laNhom: boolean }): string {
  const tienTo = t.laNhom ? "nhom" : "rieng";
  const slug = taoSlug(t.tenThread) || "chua-ro-ten";
  return `${tienTo}_${slug}_${sachTen(t.threadId)}.md`;
}

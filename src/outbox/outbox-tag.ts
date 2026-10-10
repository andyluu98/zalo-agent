import fs from "node:fs";
import path from "node:path";
import type { TagTen, TinHopThu } from "./outbox-types.js";

/** Tag có hợp lệ với nội dung không; null = hợp lệ, chuỗi = lý do */
export function kiemTag(t: Pick<TinHopThu, "noiDung" | "nhacTen" | "loaiCuoc">): string | null {
  const tag = t.nhacTen ?? [];
  if (tag.length === 0) return null;
  if (t.loaiCuoc !== "nhom") return "chỉ tag được trong tin nhóm";
  for (const x of tag) {
    if (x.pos + x.len > t.noiDung.length || t.noiDung[x.pos] !== "@") {
      return `vị trí tag không khớp nội dung (uid ${x.uid}) - tạo lại tin`;
    }
  }
  return null;
}

/**
 * Dựng danh sách tag từ (uid, tên): tìm "@Tên" trong nội dung (lần xuất hiện kế
 * tiếp chưa dùng); không có thì chèn "@Tên " vào đầu tin. Trả nội dung mới + tag.
 */
export function dungTag(noiDung: string, nguoi: { uid: string; ten: string }[]): { noiDung: string; nhacTen: TagTen[] } {
  let chu = noiDung;
  const chen: string[] = [];
  for (const n of nguoi) if (!chu.includes(`@${n.ten}`)) chen.push(`@${n.ten}`);
  if (chen.length > 0) chu = `${chen.join(" ")} ${chu}`.trimEnd();
  const daDung = new Set<number>();
  const nhacTen: TagTen[] = [];
  for (const n of nguoi) {
    const nhan = `@${n.ten}`;
    let pos = chu.indexOf(nhan);
    while (pos >= 0 && daDung.has(pos)) pos = chu.indexOf(nhan, pos + 1);
    if (pos < 0) throw new Error(`không tìm thấy "${nhan}" trong nội dung`);
    daDung.add(pos);
    nhacTen.push({ uid: n.uid, pos, len: nhan.length });
  }
  return { noiDung: chu, nhacTen };
}

/** Bảng Người trong danh bạ log: uid -> tên hiển thị */
export function docNguoiTrongDanhBa(goc: string, accountId: string): Record<string, string> {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(goc, accountId, "_du-lieu", "danh-ba.json"), "utf8"));
    const kq: Record<string, string> = {};
    for (const [uid, v] of Object.entries((raw?.nguoi ?? {}) as Record<string, { ten?: unknown }>)) {
      if (v?.ten) kq[uid] = String(v.ten);
    }
    return kq;
  } catch {
    return {};
  }
}

export type CuocTrongDanhBa = { ten: string; laNhom: boolean };

/** Đọc danh bạ của log chỉ đọc: `<goc>/<accountId>/_du-lieu/danh-ba.json` */
export function docDanhBa(goc: string, accountId: string): Record<string, CuocTrongDanhBa> {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(goc, accountId, "_du-lieu", "danh-ba.json"), "utf8"));
    const threads = raw?.threads;
    if (!threads || typeof threads !== "object") return {};
    const kq: Record<string, CuocTrongDanhBa> = {};
    for (const [id, v] of Object.entries(threads as Record<string, { ten?: unknown; laNhom?: unknown }>)) {
      kq[id] = { ten: String(v?.ten ?? ""), laNhom: v?.laNhom === true };
    }
    return kq;
  } catch {
    return {};
  }
}

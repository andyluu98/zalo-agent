import crypto from "node:crypto";
import type { TinHopThu } from "./outbox-types.js";

export function bamNoiDung(noiDung: string): string {
  return crypto.createHash("sha256").update(noiDung, "utf8").digest("hex");
}

/**
 * Mã duyệt của cả tin. Tin không có tệp ra ĐÚNG `bamNoiDung` như trước, nên
 * các tin đã duyệt / đã gửi từ bản cũ vẫn hợp lệ.
 */
export function bamTin(t: Pick<TinHopThu, "noiDung" | "tepDinhKem" | "nhacTen">): string {
  const tep = t.tepDinhKem ?? [];
  const tag = t.nhacTen ?? [];
  if (tep.length === 0 && tag.length === 0) return bamNoiDung(t.noiDung);
  const phan = [
    t.noiDung,
    ...tep.map((x) => `${x.duongDan}|${x.kichThuoc}|${x.bam}`),
    ...tag.map((x) => `@${x.uid}|${x.pos}|${x.len}`),
  ];
  return crypto.createHash("sha256").update(phan.join("\u0000"), "utf8").digest("hex");
}

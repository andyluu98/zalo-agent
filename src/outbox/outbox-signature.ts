import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { TinHopThu } from "./outbox-types.js";

/**
 * Dấu duyệt của hộp thư đi.
 *
 * `bamNoiDung` / `bamTin` chỉ là sha256 KHÔNG khóa: ai ghi được file vào
 * `hop-thu-di/` tự tính được. Nên dấu duyệt thật (`banBam`) là HMAC-SHA256 ký
 * bằng khóa riêng nằm trong DATA_DIR (ngoài vùng log mà AI khác đọc/ghi được).
 * Chữ ký phủ id, accountId, threadId, loaiCuoc và `bamTin` (chữ + tệp + tag).
 */

export function bamNoiDung(noiDung: string): string {
  return crypto.createHash("sha256").update(noiDung, "utf8").digest("hex");
}

/**
 * Mã băm nội dung của cả tin (chữ + tệp + tag). Tin không có tệp / tag ra
 * ĐÚNG `bamNoiDung`. Đây chưa phải chữ ký: xem `kyDuyet`.
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

/** Tiền tố của chữ ký; `banBam` kiểu cũ (sha256 trần) không có tiền tố này nên bị từ chối */
export const TIEN_TO_CHU_KY = "hmac1:";
export const TEN_FILE_KHOA = "outbox-hmac.key";
const DO_DAI_KHOA_HEX = 64;

export function duongDanKhoa(thuMucKhoa: string): string {
  return path.join(thuMucKhoa, TEN_FILE_KHOA);
}

/** Đọc khóa; thiếu hoặc hỏng thì null (bot KHÔNG tự sinh khóa và KHÔNG lùi về hash trần) */
export function docKhoa(thuMucKhoa: string): Buffer | null {
  try {
    const hex = fs.readFileSync(duongDanKhoa(thuMucKhoa), "utf8").trim();
    return hex.length === DO_DAI_KHOA_HEX && /^[0-9a-f]+$/.test(hex) ? Buffer.from(hex, "hex") : null;
  } catch {
    return null;
  }
}

/** Đọc khóa, chưa có thì sinh ngẫu nhiên 32 byte (chỉ CLI `approve` gọi). File khóa hỏng thì ném, không ghi đè */
export function layHoacTaoKhoa(thuMucKhoa: string): Buffer {
  const co = docKhoa(thuMucKhoa);
  if (co) return co;
  const dich = duongDanKhoa(thuMucKhoa);
  if (fs.existsSync(dich)) throw new Error(`file khóa ký hỏng: ${dich} (không tự ghi đè)`);
  fs.mkdirSync(thuMucKhoa, { recursive: true });
  try {
    fs.writeFileSync(dich, `${crypto.randomBytes(DO_DAI_KHOA_HEX / 2).toString("hex")}\n`, { flag: "wx", mode: 0o600 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
  const moi = docKhoa(thuMucKhoa);
  if (!moi) throw new Error(`không tạo được khóa ký: ${dich}`);
  return moi;
}

type TruongKy = Pick<
  TinHopThu,
  "id" | "accountId" | "threadId" | "loaiCuoc" | "noiDung" | "tepDinhKem" | "nhacTen"
>;

/** Chữ ký duyệt (đặt vào `banBam`) */
export function kyDuyet(t: TruongKy, khoa: Buffer): string {
  const thanh = JSON.stringify([t.id, t.accountId, t.threadId, t.loaiCuoc, bamTin(t)]);
  return TIEN_TO_CHU_KY + crypto.createHmac("sha256", khoa).update(thanh, "utf8").digest("hex");
}

/** `banBam` có đúng chữ ký của tin này không (so sánh thời gian cố định) */
export function kiemChuKy(t: TruongKy & { banBam?: string }, khoa: Buffer): boolean {
  if (!t.banBam?.startsWith(TIEN_TO_CHU_KY)) return false;
  const a = Buffer.from(t.banBam, "utf8");
  const b = Buffer.from(kyDuyet(t, khoa), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

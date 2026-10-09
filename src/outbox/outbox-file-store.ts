import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * Hộp thư đi dạng FILE: mỗi tin một file JSON trong
 * `<CHAT_EXPORT_DIR>/hop-thu-di/<accountId>/<id>.json`.
 *
 * Module THUẦN (không đọc env, không chạm DB): CLI và bot dùng chung, test
 * truyền thư mục tạm. Nội dung tin là dữ liệu của người dùng - không log ở đây.
 */

export const THU_MUC_HOP_THU = "hop-thu-di";
export const TRAN_KY_TU = 2000;

export const TRANG_THAI = ["cho_duyet", "da_duyet", "dang_gui", "da_gui", "loi", "huy"] as const;
export type TrangThaiTin = (typeof TRANG_THAI)[number];

const tinSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  accountId: z.string().min(1),
  threadId: z.string().regex(/^\d+$/),
  loaiCuoc: z.enum(["nhom", "rieng"]),
  tenCuoc: z.string().default(""),
  noiDung: z.string(),
  trangThai: z.enum(TRANG_THAI),
  taoLuc: z.string(),
  duyetLuc: z.string().optional(),
  /** sha256 của noiDung lúc duyệt - sửa nội dung sau khi duyệt thì không gửi */
  banBam: z.string().optional(),
  guiLuc: z.string().optional(),
  msgId: z.string().optional(),
  loi: z.string().optional(),
});
export type TinHopThu = z.infer<typeof tinSchema>;

export function bamNoiDung(noiDung: string): string {
  return crypto.createHash("sha256").update(noiDung, "utf8").digest("hex");
}

export function laIdHopLe(id: string): boolean {
  return /^[a-z0-9-]+$/.test(id);
}

export function thuMucHopThu(goc: string, accountId: string): string {
  return path.join(goc, THU_MUC_HOP_THU, accountId);
}

function duongDan(goc: string, accountId: string, id: string): string {
  if (!laIdHopLe(id)) throw new Error(`id không hợp lệ: ${id}`);
  return path.join(thuMucHopThu(goc, accountId), `${id}.json`);
}

/** Đọc một tin; file hỏng/không đúng định dạng thì trả null (không ném) */
export function docTin(goc: string, accountId: string, id: string): TinHopThu | null {
  try {
    const raw = JSON.parse(fs.readFileSync(duongDan(goc, accountId, id), "utf8"));
    const kq = tinSchema.safeParse(raw);
    return kq.success ? kq.data : null;
  } catch {
    return null;
  }
}

/** Ghi nguyên tử: ghi file tạm rồi rename, người đọc không bao giờ thấy file dở */
export function ghiTin(goc: string, tin: TinHopThu): void {
  const dich = duongDan(goc, tin.accountId, tin.id);
  fs.mkdirSync(path.dirname(dich), { recursive: true });
  const tam = `${dich}.${process.pid}.tmp`;
  fs.writeFileSync(tam, `${JSON.stringify(tin, null, 2)}\n`, "utf8");
  fs.renameSync(tam, dich);
}

export function danhSachTin(goc: string, accountId: string): TinHopThu[] {
  let ten: string[];
  try {
    ten = fs.readdirSync(thuMucHopThu(goc, accountId)).filter((t) => t.endsWith(".json"));
  } catch {
    return [];
  }
  const kq: TinHopThu[] = [];
  for (const t of ten) {
    const id = t.slice(0, -".json".length);
    if (!laIdHopLe(id)) continue;
    const tin = docTin(goc, accountId, id);
    if (tin && tin.accountId === accountId && tin.id === id) kq.push(tin);
  }
  return kq.sort((a, b) => a.taoLuc.localeCompare(b.taoLuc));
}

/** Các account có thư mục hộp thư đi */
export function danhSachAccountCoHopThu(goc: string): string[] {
  try {
    return fs
      .readdirSync(path.join(goc, THU_MUC_HOP_THU), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

export function taoIdTin(bayGio: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const ngay = `${String(bayGio.getFullYear()).slice(2)}${p(bayGio.getMonth() + 1)}${p(bayGio.getDate())}`;
  const gio = `${p(bayGio.getHours())}${p(bayGio.getMinutes())}${p(bayGio.getSeconds())}`;
  return `${ngay}-${gio}-${crypto.randomBytes(2).toString("hex")}`;
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

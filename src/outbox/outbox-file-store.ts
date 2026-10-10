import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { laAccountIdHopLe, laIdHopLe, THU_MUC_HOP_THU, tinSchema, type TinHopThu } from "./outbox-types.js";

/**
 * Hộp thư đi dạng FILE: mỗi tin một file JSON trong
 * `<CHAT_EXPORT_DIR>/hop-thu-di/<accountId>/<id>.json`.
 *
 * Module THUẦN (không đọc env, không chạm DB): CLI và bot dùng chung, test
 * truyền thư mục tạm. Nội dung tin là dữ liệu của người dùng - không log ở đây.
 * Kiểu/hằng số, đính kèm, tag, ký duyệt nằm ở các file anh em; re-export ở đây
 * để người gọi vẫn import một chỗ.
 */

export * from "./outbox-types.js";
export * from "./outbox-attachment.js";
export * from "./outbox-tag.js";
export * from "./outbox-path-guard.js";
export * from "./outbox-signature.js";

export function thuMucHopThu(goc: string, accountId: string): string {
  if (!laAccountIdHopLe(accountId)) throw new Error(`accountId không hợp lệ: ${accountId}`);
  return path.join(goc, THU_MUC_HOP_THU, accountId);
}

function duongDan(goc: string, accountId: string, id: string): string {
  if (!laIdHopLe(id)) throw new Error(`id không hợp lệ: ${id}`);
  return path.join(thuMucHopThu(goc, accountId), `${id}.json`);
}

/**
 * Đọc một tin; file hỏng / sai định dạng thì trả null (không ném). Cũng null khi
 * `accountId` hoặc `id` TRONG file không khớp thư mục / tên file chứa nó: tin để
 * ở thư mục A mà khai B thì không được gửi bằng nick B.
 */
export function docTin(goc: string, accountId: string, id: string): TinHopThu | null {
  try {
    const raw = JSON.parse(fs.readFileSync(duongDan(goc, accountId, id), "utf8"));
    const kq = tinSchema.safeParse(raw);
    return kq.success && kq.data.accountId === accountId && kq.data.id === id ? kq.data : null;
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
    if (tin) kq.push(tin);
  }
  return kq.sort((a, b) => a.taoLuc.localeCompare(b.taoLuc));
}

/** Các account có thư mục hộp thư đi */
export function danhSachAccountCoHopThu(goc: string): string[] {
  try {
    return fs
      .readdirSync(path.join(goc, THU_MUC_HOP_THU), { withFileTypes: true })
      .filter((e) => e.isDirectory() && laAccountIdHopLe(e.name))
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

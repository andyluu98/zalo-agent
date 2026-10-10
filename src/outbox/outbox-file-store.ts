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
/** Trần tệp đính kèm mỗi tin và dung lượng mỗi tệp */
export const TRAN_SO_TEP = 10;
export const TRAN_MB_TEP = 100;

export const TRANG_THAI = ["cho_duyet", "da_duyet", "dang_gui", "da_gui", "loi", "huy"] as const;
export type TrangThaiTin = (typeof TRANG_THAI)[number];

const tepSchema = z.object({
  /** Đường dẫn TUYỆT ĐỐI trên máy */
  duongDan: z.string().min(1),
  kichThuoc: z.number().int().nonnegative(),
  /** sha256 nội dung tệp lúc tạo tin - tệp bị thay sau đó thì không gửi */
  bam: z.string(),
});
export type TepDinhKem = z.infer<typeof tepSchema>;

/** Trần số người được tag trong một tin */
export const TRAN_SO_TAG = 20;
/** uid đặc biệt của zca-js nghĩa là tag tất cả (@All) */
export const UID_TAG_TAT_CA = "-1";

const tagSchema = z.object({
  uid: z.string().regex(/^(-1|\d+)$/),
  /** Vị trí ký tự (UTF-16, đúng cách zca-js đếm) của "@Tên" trong noiDung */
  pos: z.number().int().nonnegative(),
  len: z.number().int().positive(),
});
export type TagTen = z.infer<typeof tagSchema>;

const tinSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  accountId: z.string().min(1),
  threadId: z.string().regex(/^\d+$/),
  loaiCuoc: z.enum(["nhom", "rieng"]),
  tenCuoc: z.string().default(""),
  noiDung: z.string(),
  tepDinhKem: z.array(tepSchema).max(TRAN_SO_TEP).optional(),
  nhacTen: z.array(tagSchema).max(TRAN_SO_TAG).optional(),
  trangThai: z.enum(TRANG_THAI),
  taoLuc: z.string(),
  duyetLuc: z.string().optional(),
  /** `bamTin` lúc duyệt (nội dung + tệp) - sửa nội dung hay thay tệp sau khi duyệt thì không gửi */
  banBam: z.string().optional(),
  guiLuc: z.string().optional(),
  msgId: z.string().optional(),
  loi: z.string().optional(),
});
export type TinHopThu = z.infer<typeof tinSchema>;

export function bamNoiDung(noiDung: string): string {
  return crypto.createHash("sha256").update(noiDung, "utf8").digest("hex");
}

function bamTepTrenDia(duongDan: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(duongDan)).digest("hex");
}

/**
 * Mô tả một tệp để đính kèm: kiểm đường dẫn tuyệt đối, tồn tại, là tệp, trong
 * trần dung lượng. Ném Error kèm lý do dễ đọc khi không hợp lệ.
 */
export function moTaTep(duongDan: string): TepDinhKem {
  if (!path.isAbsolute(duongDan)) throw new Error(`cần đường dẫn tuyệt đối: ${duongDan}`);
  let st: fs.Stats;
  try {
    st = fs.statSync(duongDan);
  } catch {
    throw new Error(`không thấy tệp: ${duongDan}`);
  }
  if (!st.isFile()) throw new Error(`không phải tệp: ${duongDan}`);
  if (st.size === 0) throw new Error(`tệp rỗng: ${duongDan}`);
  if (st.size > TRAN_MB_TEP * 1024 * 1024) throw new Error(`tệp lớn quá ${TRAN_MB_TEP} MB: ${duongDan}`);
  return { duongDan, kichThuoc: st.size, bam: bamTepTrenDia(duongDan) };
}

/** Tệp còn đúng như lúc tạo tin không; null = còn nguyên, chuỗi = lý do */
export function kiemTepConNguyen(tep: TepDinhKem[] | undefined): string | null {
  for (const t of tep ?? []) {
    let st: fs.Stats;
    try {
      st = fs.statSync(t.duongDan);
    } catch {
      return `không còn tệp: ${t.duongDan}`;
    }
    if (!st.isFile() || st.size !== t.kichThuoc || bamTepTrenDia(t.duongDan) !== t.bam) {
      return `tệp đã bị sửa hoặc thay sau khi tạo tin: ${t.duongDan} - tạo lại tin`;
    }
  }
  return null;
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

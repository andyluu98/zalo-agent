import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { setImmediate as nhuong } from "node:timers/promises";
import { cungDuongDan, giaiDuongDanThat, kiemDuongDanTep, type QuyDinhTep } from "./outbox-path-guard.js";
import { TRAN_MB_TEP, TRAN_TONG_MB_TEP, type TepDinhKem } from "./outbox-types.js";

/** sha256 của tệp trên đĩa, đọc THEO LUỒNG (không nạp cả tệp, không chặn event loop) */
export async function bamTepTheoLuong(duongDan: string): Promise<string> {
  const h = crypto.createHash("sha256");
  for await (const mieng of fs.createReadStream(duongDan)) h.update(mieng as Buffer);
  return h.digest("hex");
}

/**
 * Mô tả một tệp để đính kèm: đường dẫn tuyệt đối, nằm trong thư mục được phép
 * (đã giải symlink / junction), là tệp, trong trần dung lượng. Lưu đường dẫn THẬT.
 * Ném Error kèm lý do dễ đọc khi không hợp lệ.
 */
export async function moTaTep(duongDan: string, q: QuyDinhTep): Promise<TepDinhKem> {
  const that = kiemDuongDanTep(duongDan, q);
  const st = await fs.promises.stat(that);
  if (!st.isFile()) throw new Error(`không phải tệp: ${duongDan}`);
  if (st.size === 0) throw new Error(`tệp rỗng: ${duongDan}`);
  if (st.size > TRAN_MB_TEP * 1024 * 1024) throw new Error(`tệp lớn quá ${TRAN_MB_TEP} MB: ${duongDan}`);
  return { duongDan: that, kichThuoc: st.size, bam: await bamTepTheoLuong(that) };
}

/** Kiểm đường dẫn của tệp đã lưu còn hợp lệ và vẫn trỏ về đúng tệp đó; null = ổn, chuỗi = lý do */
function kiemChoDaLuu(t: TepDinhKem, q: QuyDinhTep): string | null {
  if (giaiDuongDanThat(t.duongDan) === null) return `không còn tệp: ${t.duongDan}`;
  try {
    const that = kiemDuongDanTep(t.duongDan, q);
    if (!cungDuongDan(that, t.duongDan)) return `đường dẫn thật của tệp đã đổi (symlink / junction?): ${t.duongDan} - tạo lại tin`;
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

/** Tệp còn đúng như lúc tạo tin không (CLI approve); null = còn nguyên, chuỗi = lý do */
export async function kiemTepConNguyen(tep: TepDinhKem[] | undefined, q: QuyDinhTep): Promise<string | null> {
  for (const t of tep ?? []) {
    const loi = kiemChoDaLuu(t, q);
    if (loi) return loi;
    let st: fs.Stats;
    try {
      st = await fs.promises.stat(t.duongDan);
    } catch {
      return `không còn tệp: ${t.duongDan}`;
    }
    if (!st.isFile() || st.size !== t.kichThuoc || (await bamTepTheoLuong(t.duongDan)) !== t.bam) {
      return `tệp đã bị sửa hoặc thay sau khi tạo tin: ${t.duongDan} - tạo lại tin`;
    }
  }
  return null;
}

/** Tệp đã nạp vào RAM và băm ĐÚNG Buffer này - gửi chính Buffer này, không đọc lại đường dẫn */
export type TepGui = { duongDan: string; filename: string; data: Buffer };

const MIENG_BAM = 16 * 1024 * 1024;

/** sha256 của Buffer, chia miếng và nhường event loop giữa các miếng */
export async function bamBuffer(data: Buffer): Promise<string> {
  const h = crypto.createHash("sha256");
  for (let i = 0; i < data.length; i += MIENG_BAM) {
    h.update(data.subarray(i, i + MIENG_BAM));
    await nhuong();
  }
  return h.digest("hex");
}

/**
 * Nạp các tệp của tin ĐÃ DUYỆT: kiểm lại thư mục cho phép NGAY LÚC GỬI (không chỉ lúc
 * add / approve), đọc MỘT lần vào Buffer, băm đúng Buffer đó rồi so với mã lúc tạo tin.
 * Đổi tệp trong khe giữa "kiểm" và "gửi" không còn tác dụng vì người gọi gửi chính Buffer này.
 */
export async function napTepDaDuyet(
  tep: TepDinhKem[] | undefined,
  q: QuyDinhTep,
): Promise<{ loi: string } | { tep: TepGui[] }> {
  const ds = tep ?? [];
  if (ds.reduce((n, t) => n + t.kichThuoc, 0) > TRAN_TONG_MB_TEP * 1024 * 1024) {
    return { loi: `tổng tệp đính kèm lớn quá ${TRAN_TONG_MB_TEP} MB` };
  }
  const kq: TepGui[] = [];
  for (const t of ds) {
    const loiDuongDan = kiemChoDaLuu(t, q);
    if (loiDuongDan) return { loi: loiDuongDan };
    let data: Buffer;
    try {
      const st = await fs.promises.stat(t.duongDan);
      if (!st.isFile()) return { loi: `không phải tệp: ${t.duongDan}` };
      if (st.size !== t.kichThuoc) return { loi: `tệp đã bị sửa hoặc thay sau khi tạo tin: ${t.duongDan} - tạo lại tin` };
      data = await fs.promises.readFile(t.duongDan);
    } catch {
      return { loi: `không còn tệp: ${t.duongDan}` };
    }
    if (data.length !== t.kichThuoc || (await bamBuffer(data)) !== t.bam) {
      return { loi: `tệp đã bị sửa hoặc thay sau khi tạo tin: ${t.duongDan} - tạo lại tin` };
    }
    kq.push({ duongDan: t.duongDan, filename: path.basename(t.duongDan), data });
  }
  return { tep: kq };
}

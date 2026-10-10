import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { setImmediate as nhuong } from "node:timers/promises";
import { TRAN_MB_TEP, TRAN_TONG_MB_TEP, type TepDinhKem } from "./outbox-types.js";

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
 * Nạp các tệp của tin ĐÃ DUYỆT: đọc MỘT lần vào Buffer, băm đúng Buffer đó rồi
 * so với mã lúc tạo tin. Đổi tệp trong khe giữa "kiểm" và "gửi" không còn tác
 * dụng vì người gọi gửi chính Buffer này.
 */
export async function napTepDaDuyet(tep: TepDinhKem[] | undefined): Promise<{ loi: string } | { tep: TepGui[] }> {
  const ds = tep ?? [];
  if (ds.reduce((n, t) => n + t.kichThuoc, 0) > TRAN_TONG_MB_TEP * 1024 * 1024) {
    return { loi: `tổng tệp đính kèm lớn quá ${TRAN_TONG_MB_TEP} MB` };
  }
  const kq: TepGui[] = [];
  for (const t of ds) {
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

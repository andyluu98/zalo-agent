import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { TRAN_MB_TEP, type TepDinhKem } from "./outbox-types.js";

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

import fs from "node:fs";
import { docTin, ghiTin, thuMucHopThu } from "./outbox-file-store.js";
import type { TinHopThu } from "./outbox-types.js";
import path from "node:path";

/**
 * Đổi trạng thái MỘT tin theo kiểu "đọc - kiểm - ghi" nguyên tử giữa CLI và bot.
 *
 * Không có khóa thì `cancel` của CLI đọc `da_duyet`, bot giành `dang_gui` và bắt đầu gửi,
 * rồi CLI ghi `huy` đè lên: màn hình báo "đã hủy" mà tin vẫn đi. Khóa là file
 * `<id>.lock` tạo bằng cờ `wx` (nguyên tử trên cả Windows lẫn POSIX); bot GIÀNH tin và
 * CLI HỦY / DUYỆT đều đi qua hàm này nên chỉ một bên thắng, bên kia thấy trạng thái thật.
 */

const KHOA_CU_MS = 30_000;
const NGHI_MS = 15;

export type KetQuaDoi =
  | { ok: true; tin: TinHopThu }
  /** `banRon`: không lấy được khóa (tiến trình khác đang giữ) - trạng thái CHƯA được đọc */
  | { ok: false; banRon: boolean; lyDo: string; hienTai: TinHopThu | null };

function nghi(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Lấy khóa `<id>.lock`; khóa bỏ quên quá 30 giây (tiến trình chết giữa chừng) thì cướp lại */
function layKhoa(duongKhoa: string, choMs: number): number | null {
  const han = Date.now() + choMs;
  for (;;) {
    try {
      return fs.openSync(duongKhoa, "wx");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    try {
      if (Date.now() - fs.statSync(duongKhoa).mtimeMs > KHOA_CU_MS) fs.unlinkSync(duongKhoa);
    } catch {
      /* khóa vừa được nhả - thử lại ngay */
    }
    if (Date.now() >= han) return null;
    nghi(NGHI_MS);
  }
}

/**
 * Trong khóa: đọc tin, `dieuKien(tin)` trả null thì ghi `moi(tin)`, trả chuỗi thì từ chối
 * (kèm lý do). Trả về trạng thái THẬT sau thao tác.
 */
export function doiTrangThai(
  goc: string,
  accountId: string,
  id: string,
  dieuKien: (t: TinHopThu) => string | null,
  moi: (t: TinHopThu) => TinHopThu,
  choMs = 2000,
): KetQuaDoi {
  const duongKhoa = path.join(thuMucHopThu(goc, accountId), `${id}.lock`);
  fs.mkdirSync(path.dirname(duongKhoa), { recursive: true });
  const fd = layKhoa(duongKhoa, choMs);
  if (fd === null) return { ok: false, banRon: true, lyDo: "tin đang được tiến trình khác xử lý, thử lại sau", hienTai: null };
  try {
    const hienTai = docTin(goc, accountId, id);
    if (!hienTai) return { ok: false, banRon: false, lyDo: "không thấy tin (hoặc file sai định dạng)", hienTai: null };
    const lyDo = dieuKien(hienTai);
    if (lyDo) return { ok: false, banRon: false, lyDo, hienTai };
    const sau = moi(hienTai);
    ghiTin(goc, sau);
    return { ok: true, tin: sau };
  } finally {
    fs.closeSync(fd);
    try {
      fs.unlinkSync(duongKhoa);
    } catch {
      /* khóa đã bị cướp vì quá cũ - không còn gì để nhả */
    }
  }
}

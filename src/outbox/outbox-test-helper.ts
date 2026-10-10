import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ghiTin, kyDuyet, layHoacTaoKhoa, type TinHopThu } from "./outbox-file-store.js";

/** Helper dùng chung cho test hộp thư đi (không phải file test, `pnpm test` không chạy nó) */

export const ACC = "acc-test";
export const NHOM = "1111";
export const RIENG = "2222";
/** Một nhóm thứ hai hợp lệ trong danh bạ (để đổi threadId mà vẫn cùng loại cuộc) */
export const NHOM_2 = "4444";
export const CAU_HINH = { cachNhauMs: 0, tranMoiGio: 100 };

export type MoiTruong = ReturnType<typeof taoMoiTruong>;

/**
 * Thư mục log tạm + thư mục khóa tạm RIÊNG (khóa nằm ngoài vùng log, đúng như
 * production) + danh bạ. `tin()` ký tin bằng khóa thật - chỗ DUY NHẤT test tạo tin đã duyệt;
 * muốn tin KHÔNG hợp lệ thì truyền `banBam` tường minh (kể cả `undefined`).
 */
export function taoMoiTruong() {
  const goc = fs.mkdtempSync(path.join(os.tmpdir(), "outbox-"));
  const thuMucKhoa = fs.mkdtempSync(path.join(os.tmpdir(), "outbox-khoa-"));
  const khoa = layHoacTaoKhoa(thuMucKhoa);
  const duLieu = path.join(goc, ACC, "_du-lieu");
  fs.mkdirSync(duLieu, { recursive: true });
  fs.writeFileSync(
    path.join(duLieu, "danh-ba.json"),
    JSON.stringify({ threads: { [NHOM]: { ten: "Nhóm A", laNhom: true }, [RIENG]: { ten: "Người B", laNhom: false }, [NHOM_2]: { ten: "Nhóm C", laNhom: true } } }),
  );

  function tin(id: string, sua: Partial<TinHopThu> = {}): TinHopThu {
    const t: TinHopThu = {
      id,
      accountId: ACC,
      threadId: NHOM,
      loaiCuoc: "nhom",
      tenCuoc: "Nhóm A",
      noiDung: sua.noiDung ?? `chào ${id}`,
      trangThai: "da_duyet",
      taoLuc: `2026-10-09T01:00:0${id.length % 10}.000Z`,
      ...sua,
    };
    if (!("banBam" in sua)) t.banBam = kyDuyet(t, khoa);
    ghiTin(goc, t);
    return t;
  }

  function guiGia() {
    const daGoi: { threadId: string; laNhom: boolean; noiDung: string }[] = [];
    const gui = async (threadId: string, laNhom: boolean, noiDung: string) => {
      daGoi.push({ threadId, laNhom, noiDung });
      return "999";
    };
    return { daGoi, gui };
  }

  /** Tham số chung cho xuLyHopThu */
  const chung = { goc, accountId: ACC, thuMucKhoa, cauHinh: CAU_HINH };

  function don(): void {
    fs.rmSync(goc, { recursive: true, force: true });
    fs.rmSync(thuMucKhoa, { recursive: true, force: true });
  }

  return { goc, thuMucKhoa, khoa, tin, guiGia, chung, don };
}

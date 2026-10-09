import {
  bamNoiDung,
  danhSachTin,
  docDanhBa,
  docTin,
  ghiTin,
  TRAN_KY_TU,
  type TinHopThu,
} from "./outbox-file-store.js";

/**
 * Một lượt xử lý hộp thư đi của MỘT account. Chỉ gửi tin `da_duyet`.
 *
 * Chống gửi lặp: GIÀNH tin bằng cách ghi `dang_gui` TRƯỚC khi gọi API. Gặp
 * `dang_gui` mà tiến trình này không đang gửi (bot chết giữa chừng rồi bật
 * lại) thì KHÔNG gửi lại - chuyển `loi` để người dùng tự kiểm tra, vì tin có
 * thể đã tới nơi. Lỗi từ API cũng vậy: không bao giờ tự thử lại.
 */

export type GuiTinVanBan = (threadId: string, laNhom: boolean, noiDung: string) => Promise<string | undefined>;

export type CauHinhGui = {
  /** Khoảng cách tối thiểu giữa 2 tin của cùng account */
  cachNhauMs: number;
  /** Trần số tin trong 60 phút gần nhất */
  tranMoiGio: number;
};

export type KetQuaLuot = {
  daGui: number;
  /** Còn tin đã duyệt đang chờ vì giới hạn tốc độ: hẹn lượt sau sau ngần này ms */
  henLaiSauMs?: number;
};

const MOT_GIO = 60 * 60_000;

/** id các tin đang gửi trong tiến trình này - `dang_gui` ngoài tập này là sót từ lần chạy trước */
const dangGui = new Set<string>();

function danhLoi(goc: string, tin: TinHopThu, loi: string): void {
  ghiTin(goc, { ...tin, trangThai: "loi", loi });
}

/** Lý do không được gửi, hoặc null nếu hợp lệ */
export function kiemTinTruocKhiGui(tin: TinHopThu, danhBa: ReturnType<typeof docDanhBa>): string | null {
  if (!tin.banBam || tin.banBam !== bamNoiDung(tin.noiDung)) {
    return "nội dung đã bị sửa sau khi duyệt (hoặc chưa duyệt qua lệnh approve) - duyệt lại";
  }
  if (!tin.noiDung.trim()) return "nội dung rỗng";
  if (tin.noiDung.length > TRAN_KY_TU) return `nội dung dài quá ${TRAN_KY_TU} ký tự`;
  const cuoc = danhBa[tin.threadId];
  if (!cuoc) return "threadId không có trong danh bạ của log";
  if (cuoc.laNhom !== (tin.loaiCuoc === "nhom")) return "loaiCuoc không khớp danh bạ (nhóm/riêng)";
  return null;
}

/** Bao lâu nữa mới được gửi tin kế tiếp (0 = gửi được ngay) */
export function thoiGianCho(tatCa: TinHopThu[], cauHinh: CauHinhGui, bayGio: number): number {
  const moc = tatCa
    .filter((t) => (t.trangThai === "da_gui" || t.trangThai === "loi") && t.guiLuc)
    .map((t) => Date.parse(t.guiLuc!))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  let cho = 0;
  const cuoi = moc.at(-1);
  if (cuoi !== undefined) cho = Math.max(cho, cuoi + cauHinh.cachNhauMs - bayGio);
  const trongGio = moc.filter((n) => n > bayGio - MOT_GIO);
  if (trongGio.length >= cauHinh.tranMoiGio) {
    // Tin cũ nhất trong cửa sổ trôi ra ngoài thì mới có suất
    cho = Math.max(cho, trongGio[trongGio.length - cauHinh.tranMoiGio]! + MOT_GIO - bayGio);
  }
  return Math.max(0, cho);
}

export async function xuLyHopThu(opts: {
  goc: string;
  accountId: string;
  gui: GuiTinVanBan;
  cauHinh: CauHinhGui;
  bayGio?: () => Date;
}): Promise<KetQuaLuot> {
  const { goc, accountId, gui, cauHinh } = opts;
  const bayGio = opts.bayGio ?? (() => new Date());
  let daGui = 0;

  for (const tin of danhSachTin(goc, accountId)) {
    if (tin.trangThai === "dang_gui" && !dangGui.has(tin.id)) {
      danhLoi(goc, tin, "bot dừng giữa lúc gửi - không rõ tin đã tới chưa, kiểm tra Zalo trước khi tạo lại");
    }
  }

  for (;;) {
    const tatCa = danhSachTin(goc, accountId);
    const tin = tatCa.find((t) => t.trangThai === "da_duyet");
    if (!tin) return { daGui };

    const cho = thoiGianCho(tatCa, cauHinh, bayGio().getTime());
    if (cho > 0) return { daGui, henLaiSauMs: cho };

    const lyDo = kiemTinTruocKhiGui(tin, docDanhBa(goc, accountId));
    if (lyDo) {
      danhLoi(goc, tin, lyDo);
      continue;
    }

    // Đọc lại ngay trước khi giành: lệnh hủy có thể vừa chen vào
    const moiNhat = docTin(goc, accountId, tin.id);
    if (!moiNhat || moiNhat.trangThai !== "da_duyet" || moiNhat.banBam !== tin.banBam) continue;

    dangGui.add(tin.id);
    const daGianh: TinHopThu = { ...moiNhat, trangThai: "dang_gui", guiLuc: bayGio().toISOString() };
    try {
      ghiTin(goc, daGianh);
      try {
        const msgId = await gui(daGianh.threadId, daGianh.loaiCuoc === "nhom", daGianh.noiDung);
        ghiTin(goc, {
          ...daGianh,
          trangThai: "da_gui",
          guiLuc: bayGio().toISOString(),
          ...(msgId ? { msgId } : {}),
        });
        daGui++;
      } catch (err) {
        const chiTiet = err instanceof Error ? err.message : String(err);
        danhLoi(goc, daGianh, `gửi thất bại: ${chiTiet.slice(0, 300)}`);
      }
    } finally {
      dangGui.delete(tin.id);
    }
  }
}

import {
  kiemChuKy,
  kiemTag,
  napTepDaDuyet,
  type TepGui,
  type TagTen,
  danhSachTin,
  docKhoa,
  docDanhBa,
  ghiTin,
  TRAN_KY_TU,
  type TinHopThu,
} from "./outbox-file-store.js";
import { laTrongThuMuc, type QuyDinhTep } from "./outbox-path-guard.js";
import { guiCoHan, hanGuiMacDinh } from "./outbox-send-deadline.js";
import { TIEN_TO_CHU_KY } from "./outbox-signature.js";
import { doiTrangThai } from "./outbox-transaction.js";

/**
 * Một lượt xử lý hộp thư đi của MỘT account. Chỉ gửi tin `da_duyet`.
 *
 * Chống gửi lặp: GIÀNH tin bằng cách ghi `dang_gui` TRƯỚC khi gọi API. Gặp
 * `dang_gui` mà tiến trình này không đang gửi (bot chết giữa chừng rồi bật
 * lại) thì KHÔNG gửi lại - chuyển `loi` để người dùng tự kiểm tra, vì tin có
 * thể đã tới nơi. Lỗi từ API cũng vậy: không bao giờ tự thử lại. Gửi quá hạn
 * (xem outbox-send-deadline.ts) cũng chuyển `loi`, kết quả đến muộn bị bỏ.
 */

/** `tep`: tệp đã nạp vào RAM và băm xong - gửi chính Buffer này (rỗng = chỉ gửi chữ) */
export type GuiTinVanBan = (
  threadId: string,
  laNhom: boolean,
  noiDung: string,
  tep: TepGui[],
  tag: TagTen[],
) => Promise<string | undefined>;

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

/**
 * Lý do không được gửi, hoặc null nếu hợp lệ. `khoa` null (thiếu khóa ký) thì
 * KHÔNG gửi, không lùi về hash trần. Phần tệp kiểm riêng ở `napTepDaDuyet`.
 */
export function kiemTinTruocKhiGui(tin: TinHopThu, danhBa: ReturnType<typeof docDanhBa>, khoa: Buffer | null): string | null {
  if (!khoa) return "thiếu khóa ký duyệt của bot (data/outbox-hmac.key) - duyệt lại bằng pnpm outbox approve";
  if (!tin.banBam) return "chưa duyệt qua lệnh approve - duyệt lại";
  if (!tin.banBam.startsWith(TIEN_TO_CHU_KY)) return "tin duyệt kiểu cũ (không có chữ ký HMAC) - duyệt lại";
  if (!kiemChuKy(tin, khoa)) {
    return "nội dung hoặc tệp đính kèm đã bị sửa sau khi duyệt (chữ ký duyệt không khớp) - duyệt lại";
  }
  const coTep = (tin.tepDinhKem ?? []).length > 0;
  if (!tin.noiDung.trim() && !coTep) return "nội dung rỗng";
  if (tin.noiDung.length > TRAN_KY_TU) return `nội dung dài quá ${TRAN_KY_TU} ký tự`;
  const cuoc = danhBa[tin.threadId];
  if (!cuoc) return "threadId không có trong danh bạ của log";
  if (cuoc.laNhom !== (tin.loaiCuoc === "nhom")) return "loaiCuoc không khớp danh bạ (nhóm/riêng)";
  return kiemTag(tin);
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
  /** Thư mục chứa khóa ký (DATA_DIR) - PHẢI nằm ngoài `goc` */
  thuMucKhoa: string;
  /** Thư mục được phép / bị chặn cho tệp đính kèm - kiểm lại ngay trước khi gửi */
  quyDinhTep: QuyDinhTep;
  gui: GuiTinVanBan;
  cauHinh: CauHinhGui;
  bayGio?: () => Date;
  /** Hạn chót một lần gửi theo tổng byte tệp; mặc định 5 phút + 1 phút/10 MB, trần 20 phút */
  hanGuiMs?: (tongBytes: number) => number;
  /** Chỉ test: chạy ngay trước khi giành tin, để dựng ca lệnh hủy chen vào khe đó */
  truocKhiGianh?: (tin: TinHopThu) => void | Promise<void>;
}): Promise<KetQuaLuot> {
  const { goc, accountId, gui, cauHinh } = opts;
  const bayGio = opts.bayGio ?? (() => new Date());
  let daGui = 0;
  // Khóa nằm trong vùng log (nơi AI khác ghi được) thì coi như không có khóa
  const khoa = laTrongThuMuc(opts.thuMucKhoa, goc) ? null : docKhoa(opts.thuMucKhoa);

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

    const lyDo = kiemTinTruocKhiGui(tin, docDanhBa(goc, accountId), khoa);
    if (lyDo) {
      danhLoi(goc, tin, lyDo);
      continue;
    }
    // Đọc tệp MỘT lần, băm đúng Buffer đó, gửi chính Buffer đó (không để zca-js đọc lại đường dẫn)
    const nap = await napTepDaDuyet(tin.tepDinhKem, opts.quyDinhTep);
    if ("loi" in nap) {
      danhLoi(goc, tin, nap.loi);
      continue;
    }

    await opts.truocKhiGianh?.(tin);

    // GIÀNH tin dưới khóa: đọc lại + đổi sang dang_gui là một bước nguyên tử, nên lệnh hủy của
    // CLI chen vào trước thì thấy `huy` và không gửi; chen vào sau thì CLI thấy `dang_gui` và báo hủy thất bại
    dangGui.add(tin.id);
    try {
      const gianh = doiTrangThai(
        goc,
        accountId,
        tin.id,
        (t) => (t.trangThai === "da_duyet" && t.banBam === tin.banBam ? null : `đã đổi sang ${t.trangThai}`),
        (t) => ({ ...t, trangThai: "dang_gui", guiLuc: bayGio().toISOString() }),
      );
      if (!gianh.ok) {
        if (gianh.banRon) return { daGui, henLaiSauMs: 1000 };
        continue;
      }
      const daGianh = gianh.tin;
      const tongBytes = nap.tep.reduce((n, t) => n + t.data.length, 0);
      const kq = await guiCoHan(
        () => gui(daGianh.threadId, daGianh.loaiCuoc === "nhom", daGianh.noiDung, nap.tep, daGianh.nhacTen ?? []),
        (opts.hanGuiMs ?? hanGuiMacDinh)(tongBytes),
      );
      if (kq.loai === "xong") {
        ghiTin(goc, { ...daGianh, trangThai: "da_gui", guiLuc: bayGio().toISOString(), ...(kq.msgId ? { msgId: kq.msgId } : {}) });
        daGui++;
      } else if (kq.loai === "het_gio") {
        danhLoi(goc, daGianh, "quá thời gian chờ gửi - không rõ tin đã tới chưa, kiểm tra Zalo trước khi tạo lại");
      } else {
        danhLoi(goc, daGianh, `gửi thất bại: ${kq.chiTiet.slice(0, 300)}`);
      }
    } finally {
      dangGui.delete(tin.id);
    }
  }
}

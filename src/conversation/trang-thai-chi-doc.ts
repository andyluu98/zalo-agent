import fs from "node:fs";
import path from "node:path";
import { DateTime, IANAZone } from "luxon";

/**
 * Sổ trạng thái của account chỉ đọc, ghi cạnh log tin nhắn:
 *
 *   <thuMucGoc>/<accountId>/_trang-thai.json   máy đọc + nguồn sự thật khi khởi động lại
 *   <thuMucGoc>/<accountId>/_trang-thai.md     người / AI đọc
 *
 * Hai việc:
 *   1. Cho AI tổng hợp báo cáo biết log có đáng tin không: bot đang kết nối, mất
 *      kết nối từ lúc nào, hay đã tắt hẳn (nhịp `capNhatLuc` ngừng tăng).
 *   2. Nhớ msgId cuối cùng đã ghi (riêng chat cá nhân / nhóm) để lần kết nối sau
 *      xin Zalo tải bù đúng phần còn thiếu và bỏ tin đã ghi rồi.
 *
 * Ghi đồng bộ mỗi lần đổi: file nhỏ, nhịp tin chat thấp, và mất msgId cuối do
 * process chết giữa chừng nghĩa là lần sau ghi trùng tin vào log.
 */

export type TinhTrang = "dang_ket_noi" | "mat_ket_noi" | "da_dung" | "loi_dang_nhap";
export type LoaiThread = "user" | "group";

export type TrangThaiLuu = {
  accountId: string;
  tinhTrang: TinhTrang;
  /** ISO UTC - đổi ở MỌI lần ghi, kể cả nhịp sống định kỳ */
  capNhatLuc: string;
  ketNoiLuc?: string;
  matKetNoiLuc?: string;
  chiTiet?: string;
  tinGanNhatLuc?: string;
  msgIdCuoi: Partial<Record<LoaiThread, string>>;
  taiBu?: { luc: string; soTin: number };
};

/** Nhịp sống mà caller hứa ghi lại (để file .md nói được "cũ quá X phút là bot đã tắt") */
export const NHIP_SONG_PHUT = 5;

export class SoTrangThai {
  private readonly bo = new Map<string, TrangThaiLuu>();

  constructor(
    private readonly thuMucGoc: string,
    private readonly muiGio: () => string,
    private readonly bayGio: () => Date = () => new Date(),
  ) {}

  doc(accountId: string): TrangThaiLuu {
    const daCo = this.bo.get(accountId);
    if (daCo) return daCo;
    let tt: TrangThaiLuu = { accountId, tinhTrang: "da_dung", capNhatLuc: this.bayGio().toISOString(), msgIdCuoi: {} };
    try {
      const raw = JSON.parse(fs.readFileSync(this.fileJson(accountId), "utf8")) as Partial<TrangThaiLuu>;
      tt = { ...tt, ...raw, accountId, msgIdCuoi: { ...(raw.msgIdCuoi ?? {}) } };
    } catch {
      /* chưa có file hoặc hỏng - bắt đầu trống */
    }
    this.bo.set(accountId, tt);
    return tt;
  }

  cap(accountId: string, patch: Partial<Omit<TrangThaiLuu, "accountId">>): void {
    const tt = { ...this.doc(accountId), ...patch, capNhatLuc: this.bayGio().toISOString() };
    this.bo.set(accountId, tt);
    this.ghi(tt);
  }

  /** Tin có mới hơn mọi tin đã ghi của loại thread này không (chống ghi trùng khi tải bù) */
  laTinMoi(accountId: string, loai: LoaiThread, msgId: string): boolean {
    const cuoi = this.doc(accountId).msgIdCuoi[loai];
    return !msgId || !cuoi || soSanhMsgId(msgId, cuoi) > 0;
  }

  ghiNhanTin(accountId: string, loai: LoaiThread, msgId: string, sentAt: string): void {
    const tt = this.doc(accountId);
    const cuoi = tt.msgIdCuoi[loai];
    const msgIdCuoi = { ...tt.msgIdCuoi };
    if (msgId && (!cuoi || soSanhMsgId(msgId, cuoi) > 0)) msgIdCuoi[loai] = msgId;
    const tinGanNhatLuc = !tt.tinGanNhatLuc || sentAt > tt.tinGanNhatLuc ? sentAt : tt.tinGanNhatLuc;
    this.cap(accountId, { msgIdCuoi, tinGanNhatLuc });
  }

  private fileJson(accountId: string): string {
    return path.join(this.thuMucGoc, sachTen(accountId), "_trang-thai.json");
  }

  private ghi(tt: TrangThaiLuu): void {
    const dir = path.join(this.thuMucGoc, sachTen(tt.accountId));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.fileJson(tt.accountId), `${JSON.stringify(tt, null, 2)}\n`, "utf8");
    fs.writeFileSync(path.join(dir, "_trang-thai.md"), this.veMd(tt), "utf8");
  }

  private gio(iso: string | undefined): string {
    if (!iso) return "chưa có";
    const zone = IANAZone.isValidZone(this.muiGio()) ? this.muiGio() : "UTC";
    const dt = DateTime.fromISO(iso, { zone: "utc" }).setZone(zone);
    return dt.isValid ? dt.toFormat("yyyy-MM-dd HH:mm") : iso;
  }

  private veMd(tt: TrangThaiLuu): string {
    const dong = [
      `# Trạng thái zalo-agent - ${tt.accountId}`,
      "",
      `- Tình trạng: **${TEN_TINH_TRANG[tt.tinhTrang]}**`,
      `- Cập nhật lúc: ${this.gio(tt.capNhatLuc)}`,
      `- Kết nối gần nhất: ${this.gio(tt.ketNoiLuc)}`,
      `- Mất kết nối gần nhất: ${this.gio(tt.matKetNoiLuc)}`,
      `- Tin gần nhất đã ghi: ${this.gio(tt.tinGanNhatLuc)}`,
      `- Tải bù gần nhất: ${tt.taiBu ? `${tt.taiBu.soTin} tin lúc ${this.gio(tt.taiBu.luc)}` : "chưa có"}`,
    ];
    if (tt.chiTiet) dong.push(`- Chi tiết: ${tt.chiTiet}`);
    dong.push(
      "",
      `Khi đang kết nối, bot ghi lại file này mỗi ${NHIP_SONG_PHUT} phút. "Cập nhật lúc" cũ hơn ${NHIP_SONG_PHUT * 3} phút`,
      "nghĩa là bot đã tắt hoặc treo: log từ mốc đó có thể thiếu tin.",
      "",
    );
    return dong.join("\n");
  }
}

const TEN_TINH_TRANG: Record<TinhTrang, string> = {
  dang_ket_noi: "Đang kết nối",
  mat_ket_noi: "Mất kết nối (đang thử nối lại)",
  da_dung: "Đã dừng",
  loi_dang_nhap: "Lỗi đăng nhập - cần quét QR lại",
};

/** msgId của Zalo là số nguyên dạng chuỗi, tăng dần - so độ dài trước rồi so chữ */
export function soSanhMsgId(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

function sachTen(s: string): string {
  return s.replace(/[^A-Za-z0-9_.-]/g, "_") || "_";
}

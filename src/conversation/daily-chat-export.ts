import fs from "node:fs";
import path from "node:path";
import { DateTime, IANAZone } from "luxon";
import { DanhBaLog } from "./danh-ba-log.js";
import { DAU_HIEU_HUONG_DAN, HUONG_DAN_AI } from "./daily-chat-export-guide.js";
import { DuongDanLog } from "./log-paths.js";
import { catNgan, chonTenFileThread, motDong } from "./log-text-utils.js";
import { MucLucNgay } from "./muc-luc-ngay.js";

/**
 * Ghi tin nhắn ra FILE theo ngày cho chế độ chỉ đọc, để một AI khác (Claude
 * Code, Antigravity...) mở thư mục ra đọc và lọc việc cần làm. Bố cục thư mục:
 * xem `log-paths.ts` (chỗ duy nhất biết đường dẫn).
 *
 * Ghi NỐI THÊM ngay khi tin đến (không gom cuối ngày): AI đọc lúc nào cũng có
 * dữ liệu mới nhất, và process chết giữa ngày không mất những gì đã ghi.
 * Ngày tính theo múi giờ bot (BOT_TIMEZONE), không theo UTC.
 *
 * Module không import env/DB để test chạy trên thư mục tạm; caller tự truyền
 * thư mục gốc + hàm đọc múi giờ.
 */

export type DongLogTin = {
  accountId: string;
  threadId: string;
  /** Tên nhóm / tên người; rỗng thì dùng threadId */
  tenThread: string;
  laNhom: boolean;
  /** ISO UTC - giờ người ta bấm gửi */
  sentAt: string;
  senderId: string;
  senderName: string;
  /** Tin do chính chủ tài khoản gửi (từ điện thoại / máy khác) */
  laToi: boolean;
  msgId: string;
  cliMsgId: string;
  loaiTin: string;
  /** msgType gốc của Zalo - để nhận ra loại tin bot chưa phân loại được (loaiTin "khac") */
  msgType?: string;
  noiDung: string;
  dinhKem?: { ten: string; url: string };
  trichDan?: { nguoiGui: string; noiDung: string };
  anh: string[];
  /** Tệp đã tải về `<ngày>/tep/` (đường dẫn tương đối với thư mục ngày) hoặc lỗi tải */
  tepDaLuu?: { loai: string; ten: string; duongDan?: string; loi?: string }[];
};

export type SuKienThuHoi = {
  accountId: string;
  threadId: string;
  tenThread: string;
  laNhom: boolean;
  sentAt: string;
  senderName: string;
  laToi: boolean;
  /** msgId của tin bị thu hồi */
  msgIdGoc: string;
};

/** Giữ bao nhiêu tin gần nhất trong RAM để tra lại khi có tin bị thu hồi */
const SO_TIN_NHO_DE_TRA_THU_HOI = 5_000;

export class BoGhiLogNgay {
  /** msgId -> giờ + trích đoạn, để dòng "đã thu hồi" nói được là tin nào */
  private readonly tinGanDay = new Map<string, { gio: string; trich: string }>();
  private readonly duongDan: DuongDanLog;
  private readonly danhBa: DanhBaLog;
  private readonly mucLuc: MucLucNgay;

  constructor(
    private readonly thuMucGoc: string,
    private readonly muiGio: () => string,
    private readonly bayGio: () => Date = () => new Date(),
  ) {
    this.duongDan = new DuongDanLog(thuMucGoc);
    this.danhBa = new DanhBaLog(this.duongDan);
    this.mucLuc = new MucLucNgay(this.duongDan);
  }

  /** Thư mục ngày + giờ hiển thị của một tin - để tải tệp vào đúng chỗ TRƯỚC khi ghi dòng log */
  viTriNgay(accountId: string, sentAt: string): { thuMucNgay: string; ngay: string; gio: string } {
    const { ngay, gio } = this.tachNgayGio(sentAt);
    return { thuMucNgay: this.duongDan.ngay(accountId, ngay), ngay, gio };
  }

  /** Tên thread đã nhớ trong danh bạ (rỗng nếu chưa gặp) */
  tenThreadDaBiet(accountId: string, threadId: string): string {
    return this.danhBa.tenThread(accountId, threadId);
  }

  /**
   * Tạo file hướng dẫn cho AI. Bản cũ chưa có dấu hiệu phiên bản hiện tại thì
   * CHUYỂN vào `_backup/` (không xóa - có thể người dùng đã sửa tay) rồi ghi bản mới.
   */
  damBaoHuongDan(): void {
    fs.mkdirSync(this.thuMucGoc, { recursive: true });
    const nhan = DateTime.fromJSDate(this.bayGio()).toFormat("yyMMdd-HHmm");
    for (const ten of ["CLAUDE.md", "AGENTS.md"]) {
      const p = path.join(this.thuMucGoc, ten);
      if (fs.existsSync(p)) {
        if (fs.readFileSync(p, "utf8").includes(DAU_HIEU_HUONG_DAN)) continue;
        const backup = path.join(this.thuMucGoc, "_backup");
        fs.mkdirSync(backup, { recursive: true });
        fs.renameSync(p, path.join(backup, `${path.parse(ten).name}_${nhan}.md`));
      }
      fs.writeFileSync(p, HUONG_DAN_AI, "utf8");
    }
  }

  ghiTin(d: DongLogTin): void {
    const { ngay, gio } = this.tachNgayGio(d.sentAt);
    const nguoiGui = d.laToi ? `Tôi (${d.senderName})` : d.senderName;
    const dong: string[] = [];
    const [dau = "", ...sau] = d.noiDung.split(/\r?\n/);
    dong.push(`- ${gio} **${motDong(nguoiGui)}**: ${dau}`);
    for (const l of sau) dong.push(`  ${l}`);
    if (d.trichDan) {
      dong.push(`  > Trả lời **${motDong(d.trichDan.nguoiGui) || "?"}**: ${catNgan(d.trichDan.noiDung, 200)}`);
    }
    if (d.dinhKem && (d.dinhKem.ten || d.dinhKem.url)) {
      dong.push(`  - Đính kèm (${d.loaiTin}): ${d.dinhKem.url ? `[${d.dinhKem.ten || "link"}](${d.dinhKem.url})` : d.dinhKem.ten}`);
    }
    const anhDaLuu = (d.tepDaLuu ?? []).filter((t) => t.loai === "anh" && t.duongDan);
    if (anhDaLuu.length === 0) for (const url of d.anh) dong.push(`  - Ảnh: ${url}`);
    for (const t of d.tepDaLuu ?? []) {
      // File chat nằm trong nhom/ hoặc rieng/, tệp nằm ở <ngày>/tep/ -> link đi lên một cấp
      if (t.duongDan) dong.push(`  - Đã lưu (${t.loai}): [${t.duongDan}](../${t.duongDan})`);
      else dong.push(`  - Không tải được ${t.loai} "${motDong(t.ten)}": ${motDong(t.loi ?? "")}`);
    }

    const file = this.fileMd(ngay, d);
    fs.appendFileSync(path.join(this.duongDan.ngay(d.accountId, ngay), file), `${dong.join("\n")}\n`, "utf8");
    this.ghiJsonl(d.accountId, ngay, { loai: "tin", ngay, gio, ...d });
    this.danhBa.ghiNhan({ ...d, file, ngay });
    this.mucLuc.ghiNhan(d.accountId, ngay, { ...d, gio, nguoiGui });

    if (d.msgId) {
      this.tinGanDay.set(d.msgId, { gio, trich: catNgan(d.noiDung, 80) });
      if (this.tinGanDay.size > SO_TIN_NHO_DE_TRA_THU_HOI) {
        const cuNhat = this.tinGanDay.keys().next().value;
        if (cuNhat !== undefined) this.tinGanDay.delete(cuNhat);
      }
    }
  }

  ghiThuHoi(e: SuKienThuHoi): void {
    const { ngay, gio } = this.tachNgayGio(e.sentAt);
    const goc = this.tinGanDay.get(e.msgIdGoc);
    const nguoiGui = e.laToi ? `Tôi (${e.senderName})` : e.senderName;
    const chiTiet = goc ? ` (tin lúc ${goc.gio}: "${goc.trich}")` : "";
    const file = this.fileMd(ngay, e);
    fs.appendFileSync(
      path.join(this.duongDan.ngay(e.accountId, ngay), file),
      `- ${gio} **${motDong(nguoiGui)}** đã thu hồi một tin${chiTiet}\n`,
      "utf8",
    );
    this.ghiJsonl(e.accountId, ngay, { loai: "thu_hoi", ngay, gio, ...e });
  }

  private ghiJsonl(accountId: string, ngay: string, ban: Record<string, unknown>): void {
    fs.mkdirSync(this.duongDan.duLieu(accountId), { recursive: true });
    fs.appendFileSync(this.duongDan.jsonl(accountId, ngay), `${JSON.stringify(ban)}\n`, "utf8");
  }

  private tachNgayGio(sentAt: string): { ngay: string; gio: string } {
    const zone = IANAZone.isValidZone(this.muiGio()) ? this.muiGio() : "UTC";
    let dt = DateTime.fromISO(sentAt, { zone: "utc" });
    if (!dt.isValid) dt = DateTime.utc();
    dt = dt.setZone(zone);
    return { ngay: dt.toFormat("yyyy-MM-dd"), gio: dt.toFormat("HH:mm") };
  }

  /**
   * File .md (tương đối với thư mục ngày) của cuộc trò chuyện. Chốt ở lần ghi
   * ĐẦU TIÊN trong ngày và nhớ trong mục lục, nên khởi động lại hay nhóm đổi tên
   * giữa ngày vẫn ghi tiếp đúng file đó.
   */
  private fileMd(ngay: string, t: { accountId: string; threadId: string; tenThread: string; laNhom: boolean }): string {
    const daChot = this.mucLuc.fileCua(t.accountId, ngay, t.threadId);
    if (daChot) return daChot;
    const thuMucNgay = this.duongDan.ngay(t.accountId, ngay);
    const file = chonTenFileThread(thuMucNgay, t);
    fs.mkdirSync(path.dirname(path.join(thuMucNgay, file)), { recursive: true });
    const ten = motDong(t.tenThread) || t.threadId;
    fs.writeFileSync(
      path.join(thuMucNgay, file),
      `# ${ten} (${t.laNhom ? "Nhóm" : "Chat riêng"}) - ${ngay}\n\n` +
        `- Tài khoản: ${t.accountId}\n- Thread ID: ${t.threadId}\n\n`,
      "utf8",
    );
    this.mucLuc.chotFile(t.accountId, ngay, { ...t, file });
    return file;
  }
}

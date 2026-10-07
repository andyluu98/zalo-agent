import fs from "node:fs";
import path from "node:path";
import { DateTime, IANAZone } from "luxon";
import { DanhBaLog } from "./danh-ba-log.js";
import { DAU_HIEU_HUONG_DAN, HUONG_DAN_AI } from "./daily-chat-export-guide.js";
import { catNgan, motDong, sachTen, tenFileThread } from "./log-text-utils.js";
import { MucLucNgay } from "./muc-luc-ngay.js";

/**
 * Ghi tin nhắn ra FILE theo ngày cho chế độ chỉ đọc, để một AI khác (Claude
 * Code, Antigravity...) mở thư mục ra đọc và lọc việc cần làm.
 *
 * Cấu trúc:
 *
 *   <thuMucGoc>/
 *     CLAUDE.md, AGENTS.md                hướng dẫn tra cứu cho AI
 *     <accountId>/
 *       _danh-ba.md                       mọi cuộc trò chuyện + mọi người (danh-ba-log.ts)
 *       <yyyy-MM-dd>/
 *         00_muc-luc.md                   mục lục của ngày (muc-luc-ngay.ts)
 *         nhom_<ten>_<id>.md / rieng_<ten>_<id>.md   mỗi cuộc trò chuyện một file
 *         tin-nhan.jsonl                  máy đọc: mọi tin trong ngày, một dòng một tin
 *
 * Ghi NỐI THÊM ngay khi tin đến (không gom cuối ngày): AI đọc lúc nào cũng có
 * dữ liệu mới nhất, và process chết giữa ngày không mất những gì đã ghi.
 *
 * Ngày tính theo múi giờ bot (BOT_TIMEZONE), không theo UTC: tin 6h sáng giờ
 * VN phải nằm ở file hôm nay, không phải hôm qua.
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
  noiDung: string;
  dinhKem?: { ten: string; url: string };
  trichDan?: { nguoiGui: string; noiDung: string };
  anh: string[];
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
  /** `<ngày>|<account>|<thread>` -> đường dẫn file .md, để cả ngày dùng đúng 1 file dù tên nhóm đổi */
  private readonly fileTheoThread = new Map<string, string>();
  /** msgId -> giờ + trích đoạn, để dòng "đã thu hồi" nói được là tin nào */
  private readonly tinGanDay = new Map<string, { gio: string; trich: string }>();
  private readonly danhBa: DanhBaLog;
  private readonly mucLuc = new MucLucNgay();

  constructor(
    private readonly thuMucGoc: string,
    private readonly muiGio: () => string,
    private readonly bayGio: () => Date = () => new Date(),
  ) {
    this.danhBa = new DanhBaLog(thuMucGoc);
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
    const thuMucNgay = path.join(this.thuMucGoc, sachTen(d.accountId), ngay);
    fs.mkdirSync(thuMucNgay, { recursive: true });

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
    for (const url of d.anh) dong.push(`  - Ảnh: ${url}`);

    const fileMd = this.fileMd(thuMucNgay, ngay, d);
    fs.appendFileSync(fileMd, `${dong.join("\n")}\n`, "utf8");
    fs.appendFileSync(
      path.join(thuMucNgay, "tin-nhan.jsonl"),
      `${JSON.stringify({ loai: "tin", ngay, gio, ...d })}\n`,
      "utf8",
    );

    this.danhBa.ghiNhan({ ...d, ngay });
    this.mucLuc.ghiNhan(thuMucNgay, ngay, { ...d, file: fileMd, gio, nguoiGui });

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
    const thuMucNgay = path.join(this.thuMucGoc, sachTen(e.accountId), ngay);
    fs.mkdirSync(thuMucNgay, { recursive: true });

    const goc = this.tinGanDay.get(e.msgIdGoc);
    const nguoiGui = e.laToi ? `Tôi (${e.senderName})` : e.senderName;
    const chiTiet = goc ? ` (tin lúc ${goc.gio}: "${goc.trich}")` : "";
    fs.appendFileSync(
      this.fileMd(thuMucNgay, ngay, e),
      `- ${gio} **${motDong(nguoiGui)}** đã thu hồi một tin${chiTiet}\n`,
      "utf8",
    );
    fs.appendFileSync(
      path.join(thuMucNgay, "tin-nhan.jsonl"),
      `${JSON.stringify({ loai: "thu_hoi", ngay, gio, ...e })}\n`,
      "utf8",
    );
  }

  private tachNgayGio(sentAt: string): { ngay: string; gio: string } {
    const zone = IANAZone.isValidZone(this.muiGio()) ? this.muiGio() : "UTC";
    let dt = DateTime.fromISO(sentAt, { zone: "utc" });
    if (!dt.isValid) dt = DateTime.utc();
    dt = dt.setZone(zone);
    return { ngay: dt.toFormat("yyyy-MM-dd"), gio: dt.toFormat("HH:mm") };
  }

  /**
   * File .md của thread trong ngày. Tên file chốt ở lần ghi ĐẦU TIÊN trong ngày
   * và tìm lại theo tiền tố `nhom_`/`rieng_` + đuôi `_<threadId>.md` khi process
   * khởi động lại, nên tên nhóm đổi giữa ngày cũng không tách thành hai file.
   * (File kiểu cũ không tiền tố bị bỏ qua: tin mới sang file đặt tên mới.)
   */
  private fileMd(
    thuMucNgay: string,
    ngay: string,
    t: { accountId: string; threadId: string; tenThread: string; laNhom: boolean },
  ): string {
    const khoa = `${ngay}|${t.accountId}|${t.threadId}`;
    const daBiet = this.fileTheoThread.get(khoa);
    if (daBiet) return daBiet;

    const duoi = `_${sachTen(t.threadId)}.md`;
    const tienTo = t.laNhom ? "nhom_" : "rieng_";
    const coSan = fs.readdirSync(thuMucNgay).find((f) => f.startsWith(tienTo) && f.endsWith(duoi));
    let p: string;
    if (coSan) {
      p = path.join(thuMucNgay, coSan);
    } else {
      p = path.join(thuMucNgay, tenFileThread(t));
      const ten = motDong(t.tenThread) || t.threadId;
      fs.writeFileSync(
        p,
        `# ${ten} (${t.laNhom ? "Nhóm" : "Chat riêng"}) - ${ngay}\n\n` +
          `- Tài khoản: ${t.accountId}\n- Thread ID: ${t.threadId}\n\n`,
        "utf8",
      );
    }
    this.fileTheoThread.set(khoa, p);
    return p;
  }
}

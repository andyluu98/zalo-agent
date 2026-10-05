import fs from "node:fs";
import path from "node:path";
import { DateTime, IANAZone } from "luxon";
import { boDauTiengViet } from "../shared/bo-dau-tieng-viet.js";
import { HUONG_DAN_AI } from "./daily-chat-export-guide.js";

/**
 * Ghi tin nhắn ra FILE theo ngày cho chế độ chỉ đọc, để một AI khác (Claude
 * Code, Antigravity...) mở thư mục ra đọc và lọc việc cần làm.
 *
 * Cấu trúc:
 *
 *   <thuMucGoc>/
 *     CLAUDE.md, AGENTS.md            hướng dẫn cho AI đọc log (chỉ tạo khi chưa có)
 *     <accountId>/<yyyy-MM-dd>/
 *       <ten-thread>_<threadId>.md    người đọc: mỗi cuộc trò chuyện một file
 *       tin-nhan.jsonl                máy đọc: mọi tin trong ngày, một dòng một tin
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

  constructor(
    private readonly thuMucGoc: string,
    private readonly muiGio: () => string,
  ) {}

  /** Tạo file hướng dẫn cho AI nếu chưa có - người dùng sửa tay thì giữ nguyên */
  damBaoHuongDan(): void {
    fs.mkdirSync(this.thuMucGoc, { recursive: true });
    for (const ten of ["CLAUDE.md", "AGENTS.md"]) {
      const p = path.join(this.thuMucGoc, ten);
      if (!fs.existsSync(p)) fs.writeFileSync(p, HUONG_DAN_AI, "utf8");
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

    fs.appendFileSync(this.fileMd(thuMucNgay, ngay, d), `${dong.join("\n")}\n`, "utf8");
    fs.appendFileSync(
      path.join(thuMucNgay, "tin-nhan.jsonl"),
      `${JSON.stringify({ loai: "tin", ngay, gio, ...d })}\n`,
      "utf8",
    );

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
   * và tìm lại theo đuôi `_<threadId>.md` khi process khởi động lại, nên tên
   * nhóm đổi giữa ngày cũng không tách thành hai file.
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
    const coSan = fs.readdirSync(thuMucNgay).find((f) => f.endsWith(duoi));
    let p: string;
    if (coSan) {
      p = path.join(thuMucNgay, coSan);
    } else {
      const slug = taoSlug(t.tenThread) || (t.laNhom ? "nhom" : "ca-nhan");
      p = path.join(thuMucNgay, `${slug}${duoi}`);
      const ten = motDong(t.tenThread) || t.threadId;
      fs.writeFileSync(
        p,
        `# ${ten} (${t.laNhom ? "Nhóm" : "Cá nhân"}) - ${ngay}\n\n` +
          `- Tài khoản: ${t.accountId}\n- Thread ID: ${t.threadId}\n\n`,
        "utf8",
      );
    }
    this.fileTheoThread.set(khoa, p);
    return p;
  }
}

function taoSlug(s: string): string {
  return boDauTiengViet(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
}

/** Chặn ký tự phá đường dẫn trong id dùng làm tên thư mục/file */
function sachTen(s: string): string {
  return s.replace(/[^A-Za-z0-9_.-]/g, "_") || "_";
}

function motDong(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function catNgan(s: string, toiDa: number): string {
  const g = motDong(s);
  return g.length > toiDa ? `${g.slice(0, toiDa)}...` : g;
}

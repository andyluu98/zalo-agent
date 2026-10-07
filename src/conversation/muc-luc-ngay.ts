import fs from "node:fs";
import path from "node:path";
import type { DuongDanLog } from "./log-paths.js";
import { motDong, oBang } from "./log-text-utils.js";

/**
 * Mục lục của một ngày: `<acc>/<ngày>/00_muc-luc.md`, dữ liệu ở
 * `<acc>/_du-lieu/muc-luc-<ngày>.json`.
 *
 * AI đọc file này TRƯỚC để biết hôm đó có những cuộc trò chuyện nào, bao nhiêu
 * tin, ai nhắn, giờ đầu - cuối, rồi chỉ mở đúng file cần thay vì đọc hết.
 * Đồng thời là nơi NHỚ cuộc trò chuyện nào đang ghi vào file nào trong ngày
 * (tên file không còn chứa ID nên không tìm lại được bằng tên).
 */

type MucThread = {
  /** Tương đối với thư mục ngày, vd `nhom/kinh-doanh.md` */
  file: string;
  ten: string;
  laNhom: boolean;
  soTin: number;
  gioDau: string;
  gioCuoi: string;
  nguoi: Record<string, number>;
};

export class MucLucNgay {
  /** `<account>|<ngày>` -> threadId -> mục */
  private readonly bo = new Map<string, Record<string, MucThread>>();

  constructor(private readonly duongDan: DuongDanLog) {}

  /** File đã chốt cho cuộc trò chuyện trong ngày (rỗng nếu chưa có tin nào) */
  fileCua(accountId: string, ngay: string, threadId: string): string {
    return this.doc(accountId, ngay)[threadId]?.file ?? "";
  }

  /** Chốt file cho cuộc trò chuyện ngay khi tạo, kể cả khi dòng đầu là "đã thu hồi" */
  chotFile(accountId: string, ngay: string, t: { threadId: string; file: string; tenThread: string; laNhom: boolean }): void {
    const d = this.doc(accountId, ngay);
    if (d[t.threadId]) return;
    d[t.threadId] = { file: t.file, ten: t.tenThread, laNhom: t.laNhom, soTin: 0, gioDau: "", gioCuoi: "", nguoi: {} };
    this.ghi(accountId, ngay, d);
  }

  ghiNhan(accountId: string, ngay: string, t: { threadId: string; tenThread: string; gio: string; nguoiGui: string }): void {
    const d = this.doc(accountId, ngay);
    const cu = d[t.threadId];
    if (!cu) return; // chotFile luôn chạy trước
    const ten = motDong(t.nguoiGui) || "?";
    cu.nguoi[ten] = (cu.nguoi[ten] ?? 0) + 1;
    cu.ten = t.tenThread || cu.ten;
    cu.soTin += 1;
    cu.gioDau = cu.gioDau && cu.gioDau < t.gio ? cu.gioDau : t.gio;
    cu.gioCuoi = cu.gioCuoi && cu.gioCuoi > t.gio ? cu.gioCuoi : t.gio;
    this.ghi(accountId, ngay, d);
  }

  private doc(accountId: string, ngay: string): Record<string, MucThread> {
    const khoa = `${accountId}|${ngay}`;
    const daCo = this.bo.get(khoa);
    if (daCo) return daCo;
    let d: Record<string, MucThread> = {};
    try {
      d = JSON.parse(fs.readFileSync(this.duongDan.mucLucJson(accountId, ngay), "utf8")) as Record<string, MucThread>;
    } catch {
      /* ngày mới hoặc file hỏng */
    }
    this.bo.set(khoa, d);
    return d;
  }

  private ghi(accountId: string, ngay: string, d: Record<string, MucThread>): void {
    fs.mkdirSync(this.duongDan.duLieu(accountId), { recursive: true });
    fs.mkdirSync(path.dirname(this.duongDan.mucLucMd(accountId, ngay)), { recursive: true });
    fs.writeFileSync(this.duongDan.mucLucJson(accountId, ngay), `${JSON.stringify(d, null, 2)}\n`, "utf8");
    fs.writeFileSync(this.duongDan.mucLucMd(accountId, ngay), veMd(ngay, d), "utf8");
  }
}

function veMd(ngay: string, d: Record<string, MucThread>): string {
  const ds = Object.entries(d).sort((a, b) => b[1].soTin - a[1].soTin);
  const tong = ds.reduce((s, [, m]) => s + m.soTin, 0);
  return [
    `# Mục lục ${ngay}`,
    "",
    `${ds.length} cuộc trò chuyện, ${tong} tin. Xếp theo số tin giảm dần.`,
    "",
    "| Cuộc trò chuyện | Loại | Số tin | Giờ đầu | Giờ cuối | Người nhắn (số tin) | File |",
    "|---|---|---|---|---|---|---|",
    ...ds.map(([id, m]) => {
      const nguoi = Object.entries(m.nguoi)
        .sort((a, b) => b[1] - a[1])
        .map(([ten, so]) => `${oBang(ten)} (${so})`)
        .join(", ");
      return `| ${oBang(m.ten) || id} | ${m.laNhom ? "Nhóm" : "Riêng"} | ${m.soTin} | ${m.gioDau} | ${m.gioCuoi} | ${nguoi} | [${m.file}](${m.file}) |`;
    }),
    "",
  ].join("\n");
}

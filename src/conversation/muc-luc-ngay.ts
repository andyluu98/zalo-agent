import fs from "node:fs";
import path from "node:path";
import { motDong, oBang } from "./log-text-utils.js";

/**
 * Mục lục của một thư mục ngày: `<thuMucNgay>/00_muc-luc.md` (+ `_muc-luc.json`).
 *
 * AI đọc file này TRƯỚC để biết hôm đó có những cuộc trò chuyện nào, bao nhiêu
 * tin, ai nhắn, giờ đầu - cuối, rồi chỉ mở đúng file cần thay vì đọc hết.
 */

type MucThread = {
  file: string;
  ten: string;
  laNhom: boolean;
  soTin: number;
  gioDau: string;
  gioCuoi: string;
  nguoi: Record<string, number>;
};

export class MucLucNgay {
  /** thuMucNgay -> threadId -> mục */
  private readonly bo = new Map<string, Record<string, MucThread>>();

  ghiNhan(
    thuMucNgay: string,
    ngay: string,
    t: { threadId: string; file: string; tenThread: string; laNhom: boolean; gio: string; nguoiGui: string },
  ): void {
    const d = this.doc(thuMucNgay);
    const cu = d[t.threadId];
    const nguoi = { ...(cu?.nguoi ?? {}) };
    const ten = motDong(t.nguoiGui) || "?";
    nguoi[ten] = (nguoi[ten] ?? 0) + 1;
    d[t.threadId] = {
      file: path.basename(t.file),
      ten: t.tenThread || cu?.ten || "",
      laNhom: t.laNhom,
      soTin: (cu?.soTin ?? 0) + 1,
      gioDau: cu?.gioDau && cu.gioDau < t.gio ? cu.gioDau : t.gio,
      gioCuoi: cu?.gioCuoi && cu.gioCuoi > t.gio ? cu.gioCuoi : t.gio,
      nguoi,
    };
    fs.writeFileSync(path.join(thuMucNgay, "_muc-luc.json"), `${JSON.stringify(d, null, 2)}\n`, "utf8");
    fs.writeFileSync(path.join(thuMucNgay, "00_muc-luc.md"), veMd(ngay, d), "utf8");
  }

  private doc(thuMucNgay: string): Record<string, MucThread> {
    const daCo = this.bo.get(thuMucNgay);
    if (daCo) return daCo;
    let d: Record<string, MucThread> = {};
    try {
      d = JSON.parse(fs.readFileSync(path.join(thuMucNgay, "_muc-luc.json"), "utf8")) as Record<string, MucThread>;
    } catch {
      /* ngày mới hoặc file hỏng */
    }
    this.bo.set(thuMucNgay, d);
    return d;
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

import fs from "node:fs";
import type { DuongDanLog } from "./log-paths.js";
import { motDong, oBang } from "./log-text-utils.js";

/**
 * Danh bạ của log chỉ đọc: `<acc>/00_danh-ba.md`, dữ liệu ở `<acc>/_du-lieu/danh-ba.json`.
 *
 * Trả lời hai câu hỏi tra cứu mà thư mục theo ngày không trả lời được:
 *   - Cuộc trò chuyện X (nhóm/riêng) là ID nào, file tên gì, có log từ ngày nào tới ngày nào.
 *   - Người Y là ai, có chat riêng không, xuất hiện trong những nhóm nào.
 *
 * Cũng là nơi nhớ tên thread cho bộ ghi log: thread chỉ có tin tự gửi không
 * có dòng trong bảng `threads` của DB, nên tên lấy được từ Zalo phải nhớ ở đây.
 */

type ThreadInfo = { ten: string; laNhom: boolean; file: string; ngayDau: string; ngayCuoi: string; soTin: number };
type NguoiInfo = { ten: string; laToi: boolean; chatRieng: boolean; nhom: Record<string, number> };
type DuLieu = { threads: Record<string, ThreadInfo>; nguoi: Record<string, NguoiInfo> };

export type TinChoDanhBa = {
  accountId: string;
  threadId: string;
  tenThread: string;
  laNhom: boolean;
  /** File của ngày gần nhất, tương đối với thư mục ngày (vd `nhom/kinh-doanh.md`) */
  file: string;
  ngay: string;
  senderId: string;
  senderName: string;
  laToi: boolean;
};

export class DanhBaLog {
  private readonly bo = new Map<string, DuLieu>();

  constructor(private readonly duongDan: DuongDanLog) {}

  tenThread(accountId: string, threadId: string): string {
    return this.doc(accountId).threads[threadId]?.ten ?? "";
  }

  ghiNhan(t: TinChoDanhBa): void {
    const d = this.doc(t.accountId);
    const cu = d.threads[t.threadId];
    d.threads[t.threadId] = {
      ten: t.tenThread || cu?.ten || "",
      laNhom: t.laNhom,
      file: cu?.ngayCuoi && cu.ngayCuoi > t.ngay ? cu.file : t.file,
      ngayDau: cu?.ngayDau && cu.ngayDau < t.ngay ? cu.ngayDau : t.ngay,
      ngayCuoi: cu?.ngayCuoi && cu.ngayCuoi > t.ngay ? cu.ngayCuoi : t.ngay,
      soTin: (cu?.soTin ?? 0) + 1,
    };
    if (t.senderId) {
      const n = d.nguoi[t.senderId] ?? { ten: "", laToi: t.laToi, chatRieng: false, nhom: {} };
      n.ten = motDong(t.senderName) || n.ten;
      n.laToi = n.laToi || t.laToi;
      if (t.laNhom) n.nhom[t.threadId] = (n.nhom[t.threadId] ?? 0) + 1;
      else if (!t.laToi) n.chatRieng = true;
      d.nguoi[t.senderId] = n;
    }
    this.ghi(t.accountId, d);
  }

  private doc(accountId: string): DuLieu {
    const daCo = this.bo.get(accountId);
    if (daCo) return daCo;
    let d: DuLieu = { threads: {}, nguoi: {} };
    for (const p of [this.duongDan.danhBaJson(accountId), this.duongDan.cuDanhBaJson(accountId)]) {
      try {
        const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<DuLieu>;
        d = { threads: raw.threads ?? {}, nguoi: raw.nguoi ?? {} };
        break;
      } catch {
        /* chưa có hoặc hỏng - thử chỗ kế tiếp */
      }
    }
    this.bo.set(accountId, d);
    return d;
  }

  private ghi(accountId: string, d: DuLieu): void {
    fs.mkdirSync(this.duongDan.duLieu(accountId), { recursive: true });
    fs.writeFileSync(this.duongDan.danhBaJson(accountId), `${JSON.stringify(d, null, 2)}\n`, "utf8");
    fs.writeFileSync(this.duongDan.danhBaMd(accountId), veMd(accountId, d), "utf8");
  }
}

function veMd(accountId: string, d: DuLieu): string {
  const threads = Object.entries(d.threads).sort((a, b) => b[1].ngayCuoi.localeCompare(a[1].ngayCuoi));
  const tenNhom = (id: string): string => d.threads[id]?.ten || id;
  return [
    `# Danh bạ log Zalo - ${accountId}`,
    "",
    "Tự cập nhật mỗi khi có tin. File nằm trong thư mục ngày, vd `2026-10-07/nhom/kinh-doanh.md`.",
    "",
    "## Cuộc trò chuyện",
    "",
    "| Tên | Loại | Thread ID | File (ngày gần nhất) | Ngày đầu | Ngày cuối | Số tin |",
    "|---|---|---|---|---|---|---|",
    ...threads.map(
      ([id, t]) =>
        `| ${oBang(t.ten) || "(chưa rõ tên)"} | ${t.laNhom ? "Nhóm" : "Riêng"} | ${id} | ${t.ngayCuoi}/${t.file} | ${t.ngayDau} | ${t.ngayCuoi} | ${t.soTin} |`,
    ),
    "",
    "## Người",
    "",
    "| Tên | User ID | Chat riêng | Có mặt trong nhóm (số tin) |",
    "|---|---|---|---|",
    ...Object.entries(d.nguoi)
      .sort((a, b) => a[1].ten.localeCompare(b[1].ten, "vi"))
      .map(([id, n]) => {
        const nhom = Object.entries(n.nhom)
          .map(([tid, so]) => `${oBang(tenNhom(tid))} (${so})`)
          .join(", ");
        return `| ${oBang(n.ten) || "?"}${n.laToi ? " (Tôi)" : ""} | ${id} | ${n.chatRieng ? "Có" : ""} | ${nhom} |`;
      }),
    "",
  ].join("\n");
}

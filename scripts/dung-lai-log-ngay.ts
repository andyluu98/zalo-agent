/**
 * Dựng lại log chỉ đọc của MỘT ngày theo bố cục hiện tại (xem src/conversation/log-paths.ts),
 * từ jsonl của ngày đó - nguồn đủ mọi tin. Dùng khi đổi định dạng / bố cục log. Đọc được cả
 * jsonl bố cục cũ (`<ngày>/tin-nhan.jsonl`) lẫn mới (`_du-lieu/<ngày>.jsonl`).
 *
 *   pnpm tsx scripts/dung-lai-log-ngay.ts <CHAT_EXPORT_DIR> <accountId> <yyyy-MM-dd> [muiGio] [--tai-tep]
 *
 * `--tai-tep`: tải bù ảnh / file / video / tin thoại của những tin CHƯA có bản trên máy vào
 * `<ngày>/tep/`, nếu link Zalo còn sống.
 *
 * KHÔNG xóa gì: file cũ của ngày đó + danh bạ / trạng thái bố cục cũ được CHUYỂN vào
 * `<CHAT_EXPORT_DIR>/_backup/<accountId>_<ngày>_truoc-dung-lai_<yyMMdd-HHmm>/`.
 * Giữ NGUYÊN tại chỗ: `<ngày>/tep/` và `_du-lieu/trang-thai.json` (msgId cuối cho tải bù);
 * trạng thái bố cục cũ được chép sang `_du-lieu/` nếu bản mới chưa có.
 * Phải TẮT bot trước khi chạy, nếu không bot có thể ghi chen vào giữa.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DateTime } from "luxon";
import { BoGhiLogNgay, type DongLogTin, type SuKienThuHoi } from "../src/conversation/daily-chat-export.js";
import { DuongDanLog } from "../src/conversation/log-paths.js";
import { taiTep, tepCanTaiTuDong } from "../src/zalo/read-only-attachments.js";

type Dong = { loai: "tin" | "thu_hoi" | "tep_bo_sung"; sentAt: string } & Record<string, unknown>;

const coTaiTep = process.argv.includes("--tai-tep");
const [goc, accountId, ngay, muiGio = "Asia/Ho_Chi_Minh"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!goc || !accountId || !ngay || !/^\d{4}-\d{2}-\d{2}$/.test(ngay)) {
  console.error("Cách dùng: tsx scripts/dung-lai-log-ngay.ts <CHAT_EXPORT_DIR> <accountId> <yyyy-MM-dd> [muiGio] [--tai-tep]");
  process.exit(1);
}
const dd = new DuongDanLog(goc);
const thuMucAcc = dd.acc(accountId);
const thuMucNgay = dd.ngay(accountId, ngay);
const jsonlCu = (n: string): string => path.join(dd.ngay(accountId, n), "tin-nhan.jsonl");

const docJsonl = (f: string): Dong[] =>
  fs.existsSync(f)
    ? fs
        .readFileSync(f, "utf8")
        .split(/\r?\n/)
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as Dong)
    : [];

// Mọi ngày có jsonl (bố cục cũ hoặc mới): danh bạ phải đếm đủ, không chỉ ngày đang dựng
const cacNgay = new Set<string>();
for (const d of fs.readdirSync(thuMucAcc)) if (/^\d{4}-\d{2}-\d{2}$/.test(d) && fs.existsSync(jsonlCu(d))) cacNgay.add(d);
if (fs.existsSync(dd.duLieu(accountId))) {
  for (const f of fs.readdirSync(dd.duLieu(accountId))) {
    const m = /^(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f);
    if (m) cacNgay.add(m[1]!);
  }
}
if (!cacNgay.has(ngay)) {
  console.error(`Không có jsonl nào của ngày ${ngay}`);
  process.exit(1);
}

// Gộp cũ + mới, bỏ trùng (bot có thể đã ghi cùng tin vào cả hai trước khi chuyển bố cục)
const daThay = new Set<string>();
const tatCa: Dong[] = [];
for (const n of [...cacNgay].sort()) {
  for (const d of [...docJsonl(jsonlCu(n)), ...docJsonl(dd.jsonl(accountId, n))]) {
    const khoa = `${d.loai}|${String(d.msgId ?? d.msgIdGoc ?? "")}|${d.sentAt}|${String(d.threadId)}`;
    if (daThay.has(khoa)) continue;
    daThay.add(khoa);
    tatCa.push(d);
  }
}

// Tên tốt nhất cho mỗi thread: tên KHÁC RỖNG gặp sau cùng
const tenTot = new Map<string, string>();
for (const d of tatCa) if (String(d.tenThread ?? "")) tenTot.set(String(d.threadId), String(d.tenThread));

// Bản ghi "tep_bo_sung" (tệp tải xong sau dòng tin) gộp ngược vào dòng tin cùng msgId
const boSung = new Map<string, unknown>();
for (const d of tatCa) if (d.loai === "tep_bo_sung") boSung.set(String(d.msgId), d.tepDaLuu);
for (const d of tatCa) if (d.loai === "tin" && boSung.has(String(d.msgId))) d.tepDaLuu = boSung.get(String(d.msgId));
const theoGio = tatCa.filter((d) => d.loai !== "tep_bo_sung").sort((a, b) => a.sentAt.localeCompare(b.sentAt));
if (coTaiTep) {
  let ok = 0;
  let loi = 0;
  for (const d of theoGio) {
    if (d.loai !== "tin" || d.ngay !== ngay || (Array.isArray(d.tepDaLuu) && d.tepDaLuu.some((t: { dangTai?: boolean }) => !t.dangTai))) continue;
    const ds = tepCanTaiTuDong({
      msgId: String(d.msgId ?? ""),
      anh: Array.isArray(d.anh) ? (d.anh as string[]) : [],
      loaiTin: String(d.loaiTin ?? ""),
      dinhKem: d.dinhKem as { ten: string; url: string } | undefined,
    });
    if (ds.length === 0) continue;
    const kq = await taiTep(thuMucNgay, String(d.gio ?? "0000"), ds, { maxBytes: 100 * 1024 * 1024 });
    d.tepDaLuu = kq;
    ok += kq.filter((t) => t.duongDan).length;
    loi += kq.filter((t) => t.loi).length;
  }
  console.log(`Tải bù tệp: ${ok} thành công, ${loi} lỗi`);
}

// Dựng vào thư mục tạm trước, xong mới đổi chỗ: hỏng giữa chừng thì dữ liệu thật còn nguyên
const tam = fs.mkdtempSync(path.join(os.tmpdir(), "dung-lai-log-"));
const bo = new BoGhiLogNgay(tam, () => muiGio);
for (const d of theoGio) {
  const { loai: _loai, ngay: _ngay, gio: _gio, ...con } = d;
  const tenThread = tenTot.get(String(d.threadId)) ?? "";
  if (d.loai === "thu_hoi") bo.ghiThuHoi({ ...(con as unknown as SuKienThuHoi), tenThread });
  else bo.ghiTin({ ...(con as unknown as DongLogTin), tenThread });
}
const ddTam = new DuongDanLog(tam);

// Chuyển bản cũ vào backup (KHÔNG xóa)
const backup = path.join(goc, "_backup", `${accountId}_${ngay}_truoc-dung-lai_${DateTime.now().toFormat("yyMMdd-HHmm")}`);
fs.mkdirSync(backup, { recursive: true });
const chuyen = (p: string, ten = path.basename(p)): void => {
  if (fs.existsSync(p)) fs.renameSync(p, path.join(backup, ten));
};
for (const f of fs.readdirSync(thuMucNgay)) if (f !== "tep") chuyen(path.join(thuMucNgay, f));
// Trạng thái bố cục cũ: giữ msgId cuối bằng cách chép sang _du-lieu trước khi chuyển đi
fs.mkdirSync(dd.duLieu(accountId), { recursive: true });
if (fs.existsSync(dd.cuTrangThaiJson(accountId)) && !fs.existsSync(dd.trangThaiJson(accountId))) {
  fs.copyFileSync(dd.cuTrangThaiJson(accountId), dd.trangThaiJson(accountId));
}
for (const f of ["_danh-ba.md", "_danh-ba.json", "_trang-thai.md", "_trang-thai.json", "00_danh-ba.md"]) {
  chuyen(path.join(thuMucAcc, f));
}
chuyen(dd.danhBaJson(accountId), "du-lieu_danh-ba.json");
chuyen(dd.jsonl(accountId, ngay), `du-lieu_${ngay}.jsonl`);
chuyen(dd.mucLucJson(accountId, ngay), `du-lieu_muc-luc-${ngay}.json`);

// Chép bản mới vào chỗ
fs.cpSync(ddTam.ngay(accountId, ngay), thuMucNgay, { recursive: true });
fs.copyFileSync(ddTam.danhBaMd(accountId), dd.danhBaMd(accountId));
fs.copyFileSync(ddTam.danhBaJson(accountId), dd.danhBaJson(accountId));
fs.copyFileSync(ddTam.jsonl(accountId, ngay), dd.jsonl(accountId, ngay));
fs.copyFileSync(ddTam.mucLucJson(accountId, ngay), dd.mucLucJson(accountId, ngay));

console.log(`Đã dựng lại ${ngay}: ${theoGio.filter((d) => d.ngay === ngay).length} dòng. Bản cũ ở ${backup}`);

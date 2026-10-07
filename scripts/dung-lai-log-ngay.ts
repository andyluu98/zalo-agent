/**
 * Dựng lại log chỉ đọc của MỘT ngày theo định dạng hiện tại, từ `tin-nhan.jsonl`
 * của chính ngày đó (nguồn đủ mọi tin). Dùng khi đổi định dạng file log.
 *
 *   pnpm tsx scripts/dung-lai-log-ngay.ts <CHAT_EXPORT_DIR> <accountId> <yyyy-MM-dd> [muiGio]
 *
 * KHÔNG xóa gì: mọi file cũ của ngày đó + danh bạ cũ được CHUYỂN vào
 * `<CHAT_EXPORT_DIR>/_backup/<accountId>_<ngày>_truoc-dung-lai_<yyMMdd-HHmm>/`.
 * Danh bạ được dựng lại từ jsonl của TẤT CẢ các ngày có trong thư mục account.
 * Phải TẮT bot trước khi chạy, nếu không bot có thể ghi chen vào giữa.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DateTime } from "luxon";
import { BoGhiLogNgay, type DongLogTin, type SuKienThuHoi } from "../src/conversation/daily-chat-export.js";

type Dong = { loai: "tin" | "thu_hoi"; sentAt: string } & Record<string, unknown>;

const [goc, accountId, ngay, muiGio = "Asia/Ho_Chi_Minh"] = process.argv.slice(2);
if (!goc || !accountId || !/^\d{4}-\d{2}-\d{2}$/.test(ngay ?? "")) {
  console.error("Cách dùng: tsx scripts/dung-lai-log-ngay.ts <CHAT_EXPORT_DIR> <accountId> <yyyy-MM-dd> [muiGio]");
  process.exit(1);
}
const thuMucAcc = path.join(goc, accountId);
const thuMucNgay = path.join(thuMucAcc, ngay!);
if (!fs.existsSync(path.join(thuMucNgay, "tin-nhan.jsonl"))) {
  console.error(`Không có ${path.join(thuMucNgay, "tin-nhan.jsonl")}`);
  process.exit(1);
}

const docJsonl = (f: string): Dong[] =>
  fs
    .readFileSync(f, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Dong);

// Mọi ngày của account: danh bạ phải đếm đủ, không chỉ ngày đang dựng
const cacNgay = fs
  .readdirSync(thuMucAcc)
  .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && fs.existsSync(path.join(thuMucAcc, d, "tin-nhan.jsonl")))
  .sort();
const tatCa = cacNgay.flatMap((d) => docJsonl(path.join(thuMucAcc, d, "tin-nhan.jsonl")));

// Tên tốt nhất cho mỗi thread: tên KHÁC RỖNG gặp sau cùng (bản cũ có thể ghi rỗng cho chat riêng)
const tenTot = new Map<string, string>();
for (const d of tatCa) {
  const ten = String(d.tenThread ?? "");
  if (ten) tenTot.set(String(d.threadId), ten);
}

// Dựng vào thư mục tạm trước, xong mới đổi chỗ: hỏng giữa chừng thì dữ liệu thật còn nguyên
const tam = fs.mkdtempSync(path.join(os.tmpdir(), "dung-lai-log-"));
const bo = new BoGhiLogNgay(tam, () => muiGio);
const theoGio = [...tatCa].sort((a, b) => a.sentAt.localeCompare(b.sentAt));
for (const d of theoGio) {
  const { loai: _loai, ngay: _ngay, gio: _gio, ...con } = d;
  const tenThread = tenTot.get(String(d.threadId)) ?? "";
  if (d.loai === "thu_hoi") bo.ghiThuHoi({ ...(con as unknown as SuKienThuHoi), tenThread });
  else bo.ghiTin({ ...(con as unknown as DongLogTin), tenThread });
}

const nhan = DateTime.now().toFormat("yyMMdd-HHmm");
const backup = path.join(goc, "_backup", `${accountId}_${ngay}_truoc-dung-lai_${nhan}`);
fs.mkdirSync(backup, { recursive: true });
for (const f of fs.readdirSync(thuMucNgay)) fs.renameSync(path.join(thuMucNgay, f), path.join(backup, f));
for (const f of ["_danh-ba.md", "_danh-ba.json"]) {
  if (fs.existsSync(path.join(thuMucAcc, f))) fs.renameSync(path.join(thuMucAcc, f), path.join(backup, f));
}

const tamNgay = path.join(tam, accountId, ngay!);
for (const f of fs.readdirSync(tamNgay)) fs.copyFileSync(path.join(tamNgay, f), path.join(thuMucNgay, f));
for (const f of ["_danh-ba.md", "_danh-ba.json"]) {
  fs.copyFileSync(path.join(tam, accountId, f), path.join(thuMucAcc, f));
}
// Các ngày KHÁC được phát lại chỉ để đếm danh bạ; file của chúng trong thư mục tạm bị bỏ qua
console.log(`Đã dựng lại ${ngay}: ${theoGio.filter((d) => d.ngay === ngay).length} dòng. Bản cũ ở ${backup}`);
console.log(fs.readdirSync(thuMucNgay).join("\n"));

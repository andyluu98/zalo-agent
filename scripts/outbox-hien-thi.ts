import type { TinHopThu } from "../src/outbox/outbox-file-store.js";

/** In lỗi rồi thoát mã 1 */
export function thoat(msg: string): never {
  console.error(msg);
  process.exit(1);
}

/** In một tin cho người duyệt đọc */
export function inTin(t: TinHopThu): void {
  console.log(`id:        ${t.id}`);
  console.log(`trạng thái: ${t.trangThai}${t.loi ? ` (${t.loi})` : ""}`);
  console.log(`gửi tới:   ${t.tenCuoc} [${t.loaiCuoc}] threadId ${t.threadId}`);
  for (const x of t.nhacTen ?? []) {
    console.log(`tag:       ${t.noiDung.slice(x.pos, x.pos + x.len)} (uid ${x.uid})`);
  }
  for (const f of t.tepDinhKem ?? []) {
    console.log(`đính kèm:  ${f.duongDan} (${(f.kichThuoc / 1024 / 1024).toFixed(2)} MB)`);
  }
  if (t.msgId) console.log(`msgId:     ${t.msgId} lúc ${t.guiLuc}`);
  console.log("----- nguyên văn -----");
  console.log(t.noiDung);
  console.log("----------------------");
}

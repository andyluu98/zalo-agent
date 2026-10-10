// Hộp thư đi có duyệt - CLI cho người/Claude soạn và duyệt từng tin.
// Cách dùng:
//   pnpm outbox add --thread <threadId> --text "..."   (hoặc --file <đường dẫn .txt>)
//                   [--attach <đường dẫn tệp>]...     đính kèm tệp, lặp lại cho nhiều tệp
//   pnpm outbox approve <id>      duyệt ĐÚNG một tin (in lại nguyên văn)
//   pnpm outbox cancel <id>
//   pnpm outbox show <id>
//   pnpm outbox list [--all]
// Mọi lệnh nhận --account <id>; bỏ trống thì tự chọn khi máy chỉ có một account có log.
// Không có lệnh duyệt nhiều tin một lúc - cố ý.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { chatExportDir } from "../src/config/env.js";
import {
  bamTin,
  kiemTepConNguyen,
  moTaTep,
  TRAN_SO_TEP,
  danhSachTin,
  docDanhBa,
  docTin,
  ghiTin,
  laIdHopLe,
  taoIdTin,
  THU_MUC_HOP_THU,
  TRAN_KY_TU,
  type TinHopThu,
} from "../src/outbox/outbox-file-store.js";

const goc = chatExportDir;

function thoat(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function chonAccount(chiDinh: string | undefined): string {
  if (chiDinh) return chiDinh;
  const coLog = fs
    .readdirSync(goc, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== THU_MUC_HOP_THU)
    .map((e) => e.name)
    .filter((ten) => fs.existsSync(path.join(goc, ten, "_du-lieu", "danh-ba.json")));
  if (coLog.length === 1) return coLog[0]!;
  thoat(`Cần --account <id>. Các account có log: ${coLog.join(", ") || "(không có)"}`);
}

function inTin(t: TinHopThu): void {
  console.log(`id:        ${t.id}`);
  console.log(`trạng thái: ${t.trangThai}${t.loi ? ` (${t.loi})` : ""}`);
  console.log(`gửi tới:   ${t.tenCuoc} [${t.loaiCuoc}] threadId ${t.threadId}`);
  for (const f of t.tepDinhKem ?? []) {
    console.log(`đính kèm:  ${f.duongDan} (${(f.kichThuoc / 1024 / 1024).toFixed(2)} MB)`);
  }
  if (t.msgId) console.log(`msgId:     ${t.msgId} lúc ${t.guiLuc}`);
  console.log("----- nguyên văn -----");
  console.log(t.noiDung);
  console.log("----------------------");
}

function layTin(account: string, id: string | undefined): TinHopThu {
  if (!id || !laIdHopLe(id)) thoat("Thiếu hoặc sai <id>");
  const t = docTin(goc, account, id);
  if (!t) thoat(`Không thấy tin ${id} (hoặc file sai định dạng)`);
  return t;
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    account: { type: "string" },
    thread: { type: "string" },
    text: { type: "string" },
    file: { type: "string" },
    attach: { type: "string", multiple: true },
    all: { type: "boolean", default: false },
  },
});
const [lenh, id] = positionals;
const account = chonAccount(values.account);

switch (lenh) {
  case "add": {
    const threadId = values.thread ?? thoat("Thiếu --thread <threadId> (lấy ở 00_danh-ba.md)");
    const noiDung = values.file ? fs.readFileSync(values.file, "utf8").replace(/\r\n/g, "\n").trimEnd() : values.text;
    const duongDanTep = (values.attach ?? []).map((p) => path.resolve(p));
    if (duongDanTep.length > TRAN_SO_TEP) thoat(`Tối đa ${TRAN_SO_TEP} tệp mỗi tin`);
    let tepDinhKem;
    try {
      tepDinhKem = duongDanTep.map(moTaTep);
    } catch (err) {
      thoat(`Tệp đính kèm không hợp lệ: ${(err as Error).message}`);
    }
    if (!noiDung?.trim() && tepDinhKem.length === 0) thoat("Thiếu --text / --file, hoặc --attach");
    if ((noiDung ?? "").length > TRAN_KY_TU) thoat(`Nội dung dài quá ${TRAN_KY_TU} ký tự`);
    const cuoc = docDanhBa(goc, account)[threadId];
    if (!cuoc) thoat(`threadId ${threadId} không có trong danh bạ log của ${account}`);
    const bayGio = new Date();
    const tin: TinHopThu = {
      id: taoIdTin(bayGio),
      accountId: account,
      threadId,
      loaiCuoc: cuoc.laNhom ? "nhom" : "rieng",
      tenCuoc: cuoc.ten,
      noiDung: noiDung ?? "",
      ...(tepDinhKem.length > 0 ? { tepDinhKem } : {}),
      trangThai: "cho_duyet",
      taoLuc: bayGio.toISOString(),
    };
    ghiTin(goc, tin);
    console.log("Đã tạo tin CHỜ DUYỆT (chưa gửi):");
    inTin(tin);
    break;
  }
  case "approve": {
    const t = layTin(account, id);
    if (t.trangThai !== "cho_duyet") thoat(`Tin ${t.id} đang ở trạng thái ${t.trangThai}, chỉ duyệt được cho_duyet`);
    const tepDoi = kiemTepConNguyen(t.tepDinhKem);
    if (tepDoi) thoat(`Không duyệt được: ${tepDoi}`);
    const daDuyet: TinHopThu = {
      ...t,
      trangThai: "da_duyet",
      duyetLuc: new Date().toISOString(),
      banBam: bamTin(t),
    };
    ghiTin(goc, daDuyet);
    console.log("Đã DUYỆT, bot sẽ gửi (nếu đang bật OUTBOX_ENABLED):");
    inTin(daDuyet);
    break;
  }
  case "cancel": {
    const t = layTin(account, id);
    if (t.trangThai !== "cho_duyet" && t.trangThai !== "da_duyet") thoat(`Tin ${t.id} đã ${t.trangThai}, không hủy được`);
    ghiTin(goc, { ...t, trangThai: "huy" });
    console.log(`Đã hủy tin ${t.id}`);
    break;
  }
  case "show":
    inTin(layTin(account, id));
    break;
  case "list": {
    const ds = danhSachTin(goc, account).filter((t) => values.all || !["da_gui", "huy"].includes(t.trangThai));
    if (ds.length === 0) console.log("(không có tin nào)");
    for (const t of ds) {
      const soTep = (t.tepDinhKem ?? []).length;
      const tom = t.noiDung.replace(/\s+/g, " ").slice(0, 60) + (soTep ? `  [+${soTep} tệp]` : "");
      console.log(`${t.id}  ${t.trangThai.padEnd(9)}  ${t.tenCuoc} [${t.loaiCuoc}]  ${tom}${t.loi ? `  LỖI: ${t.loi}` : ""}`);
    }
    break;
  }
  default:
    thoat("Lệnh: add | approve <id> | cancel <id> | show <id> | list [--all]");
}

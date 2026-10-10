// Hộp thư đi có duyệt - CLI cho người/Claude soạn và duyệt từng tin.
// Cách dùng:
//   pnpm outbox add --thread <threadId> --text "..."   (hoặc --file <đường dẫn .txt>)
//                   [--attach <đường dẫn tệp>]...     đính kèm tệp, lặp lại cho nhiều tệp
//                   [--mention <uid>|<uid>=<Tên>|all]...  tag người trong NHÓM (uid ở bảng Người, 00_danh-ba.md)
//   pnpm outbox approve <id>      duyệt ĐÚNG một tin (in lại nguyên văn)
//   pnpm outbox cancel <id>
//   pnpm outbox show <id>
//   pnpm outbox list [--all]
// Mọi lệnh nhận --account <id>; bỏ trống thì tự chọn khi máy chỉ có một account có log.
// Không có lệnh duyệt nhiều tin một lúc - cố ý.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { chatExportDir, dataDir } from "../src/config/env.js";
import {
  bamTin,
  kyDuyet,
  laAccountIdHopLe,
  layHoacTaoKhoa,
  kiemTag,
  kiemTepConNguyen,
  danhSachTin,
  docTin,
  laIdHopLe,
  THU_MUC_HOP_THU,
  type TinHopThu,
} from "../src/outbox/outbox-file-store.js";
import { doiTrangThai } from "../src/outbox/outbox-transaction.js";
import { quyDinhTepTuEnv } from "../src/outbox/outbox-attachment-policy.js";
import { lenhAdd } from "./outbox-lenh-add.js";
import { inTin, thoat } from "./outbox-hien-thi.js";

const goc = chatExportDir;
const quyDinhTep = quyDinhTepTuEnv();


function chonAccount(chiDinh: string | undefined): string {
  if (chiDinh) {
    if (!laAccountIdHopLe(chiDinh)) thoat(`--account sai: "${chiDinh}" (chỉ chữ thường, số, dấu gạch ngang)`);
    return chiDinh;
  }
  const coLog = fs
    .readdirSync(goc, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== THU_MUC_HOP_THU)
    .map((e) => e.name)
    .filter((ten) => fs.existsSync(path.join(goc, ten, "_du-lieu", "danh-ba.json")));
  if (coLog.length === 1) return coLog[0]!;
  thoat(`Cần --account <id>. Các account có log: ${coLog.join(", ") || "(không có)"}`);
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
    mention: { type: "string", multiple: true },
    attach: { type: "string", multiple: true },
    all: { type: "boolean", default: false },
  },
});
const [lenh, id] = positionals;
const account = chonAccount(values.account);

switch (lenh) {
  case "add": {
    await lenhAdd(goc, account, quyDinhTep, values);
    break;
  }
  case "approve": {
    const t = layTin(account, id);
    if (t.trangThai !== "cho_duyet") thoat(`Tin ${t.id} đang ở trạng thái ${t.trangThai}, chỉ duyệt được cho_duyet`);
    const tepDoi = (await kiemTepConNguyen(t.tepDinhKem, quyDinhTep)) ?? kiemTag(t);
    if (tepDoi) thoat(`Không duyệt được: ${tepDoi}`);
    // Khóa HMAC nằm trong DATA_DIR (ngoài vùng log); chưa có thì sinh ở lần duyệt đầu tiên
    const khoa = layHoacTaoKhoa(dataDir);
    // Duyệt dưới khóa tin: hủy / bot giành chen vào giữa thì thấy trạng thái thật, không ghi đè
    const kq = doiTrangThai(
      goc,
      account,
      t.id,
      (cur) =>
        cur.trangThai !== "cho_duyet"
          ? `đang ở trạng thái ${cur.trangThai}`
          : bamTin(cur) !== bamTin(t)
            ? "tin vừa bị sửa trong lúc duyệt - xem lại rồi duyệt lại"
            : null,
      (cur) => ({ ...cur, trangThai: "da_duyet", duyetLuc: new Date().toISOString(), banBam: kyDuyet(cur, khoa) }),
    );
    if (!kq.ok) thoat(`Không duyệt được tin ${t.id}: ${kq.lyDo}`);
    console.log("Đã DUYỆT, bot sẽ gửi (nếu đang bật OUTBOX_ENABLED):");
    inTin(kq.tin);
    break;
  }
  case "cancel": {
    const t = layTin(account, id);
    // Đọc - kiểm - ghi dưới khóa tin (bot cũng giành tin qua khóa này) rồi đọc lại để báo ĐÚNG trạng thái thật
    const kq = doiTrangThai(
      goc,
      account,
      t.id,
      (cur) => (cur.trangThai === "cho_duyet" || cur.trangThai === "da_duyet" ? null : `đã ${cur.trangThai}`),
      (cur) => ({ ...cur, trangThai: "huy" }),
    );
    if (!kq.ok) thoat(`Tin ${t.id} ${kq.lyDo}, không hủy được${kq.hienTai?.trangThai === "dang_gui" ? " (bot đã giành để gửi, kiểm tra Zalo)" : ""}`);
    const sau = docTin(goc, account, t.id);
    if (sau?.trangThai !== "huy") thoat(`Hủy không thành: trạng thái thật của tin ${t.id} là ${sau?.trangThai ?? "(không đọc được)"}`);
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

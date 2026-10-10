import fs from "node:fs";
import path from "node:path";
import {
  docNguoiTrongDanhBa,
  dungTag,
  moTaTep,
  TRAN_SO_TAG,
  TRAN_SO_TEP,
  UID_TAG_TAT_CA,
  docDanhBa,
  ghiTin,
  taoIdTin,
  TRAN_KY_TU,
  type TinHopThu,
  type QuyDinhTep,
} from "../src/outbox/outbox-file-store.js";
import { inTin, thoat } from "./outbox-hien-thi.js";

/** Lệnh `add`: tạo tin CHỜ DUYỆT (chưa gửi). Mọi lỗi người dùng đi qua `thoat`. */
export async function lenhAdd(
  goc: string,
  account: string,
  quyDinhTep: QuyDinhTep,
  values: { thread?: string; text?: string; file?: string; mention?: string[]; attach?: string[] },
): Promise<void> {
  const threadId = values.thread ?? thoat("Thiếu --thread <threadId> (lấy ở 00_danh-ba.md)");
  const noiDung = values.file ? fs.readFileSync(values.file, "utf8").replace(/\r\n/g, "\n").trimEnd() : values.text;
  const duongDanTep = (values.attach ?? []).map((p) => path.resolve(p));
  if (duongDanTep.length > TRAN_SO_TEP) thoat(`Tối đa ${TRAN_SO_TEP} tệp mỗi tin`);
  let tepDinhKem;
  try {
    tepDinhKem = [];
    for (const p of duongDanTep) tepDinhKem.push(await moTaTep(p, quyDinhTep));
  } catch (err) {
    thoat(`Tệp đính kèm không hợp lệ: ${(err as Error).message}`);
  }
  if (!noiDung?.trim() && tepDinhKem.length === 0) thoat("Thiếu --text / --file, hoặc --attach");
  const cuoc = docDanhBa(goc, account)[threadId];
  if (!cuoc) thoat(`threadId ${threadId} không có trong danh bạ log của ${account}`);
  let chu = noiDung ?? "";
  let nhacTen;
  const yeuCauTag = values.mention ?? [];
  if (yeuCauTag.length > 0) {
    if (!cuoc.laNhom) thoat("Chỉ tag được trong tin nhóm");
    if (yeuCauTag.length > TRAN_SO_TAG) thoat(`Tối đa ${TRAN_SO_TAG} người được tag mỗi tin`);
    const danhBaNguoi = docNguoiTrongDanhBa(goc, account);
    const nguoi = yeuCauTag.map((m) => {
      if (m.toLowerCase() === "all") return { uid: UID_TAG_TAT_CA, ten: "All" };
      const [uid = "", tenTay] = m.split("=");
      if (!/^\d+$/.test(uid)) thoat(`--mention sai: "${m}" (cần <uid>, <uid>=<Tên> hoặc all)`);
      const ten = tenTay?.trim() || danhBaNguoi[uid];
      if (!ten) thoat(`uid ${uid} chưa có trong bảng Người của danh bạ - dùng --mention ${uid}=<Tên hiển thị>`);
      return { uid, ten };
    });
    try {
      ({ noiDung: chu, nhacTen } = dungTag(chu, nguoi));
    } catch (err) {
      thoat(`Không dựng được tag: ${(err as Error).message}`);
    }
  }
  if (chu.length > TRAN_KY_TU) thoat(`Nội dung dài quá ${TRAN_KY_TU} ký tự`);
  const bayGio = new Date();
  const tin: TinHopThu = {
    id: taoIdTin(bayGio),
    accountId: account,
    threadId,
    loaiCuoc: cuoc.laNhom ? "nhom" : "rieng",
    tenCuoc: cuoc.ten,
    noiDung: chu,
    ...(tepDinhKem.length > 0 ? { tepDinhKem } : {}),
    ...(nhacTen && nhacTen.length > 0 ? { nhacTen } : {}),
    trangThai: "cho_duyet",
    taoLuc: bayGio.toISOString(),
  };
  ghiTin(goc, tin);
  console.log("Đã tạo tin CHỜ DUYỆT (chưa gửi):");
  inTin(tin);
}

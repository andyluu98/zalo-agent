import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  bamTin,
  docKhoa,
  docTin,
  duongDanKhoa,
  ghiTin,
  kiemChuKy,
  kyDuyet,
  layHoacTaoKhoa,
  TIEN_TO_CHU_KY,
  type TinHopThu,
} from "./outbox-file-store.js";
import { laTrongThuMuc } from "./outbox-path-guard.js";
import { xuLyHopThu } from "./outbox-sender.js";
import { ACC, NHOM_2, taoMoiTruong, type MoiTruong } from "./outbox-test-helper.js";

let mt: MoiTruong;
beforeEach(() => {
  mt = taoMoiTruong();
});
afterEach(() => mt.don());

async function chay(): Promise<string[]> {
  const { daGoi, gui } = mt.guiGia();
  await xuLyHopThu({ ...mt.chung, gui });
  return daGoi.map((d) => d.noiDung);
}
const loiCua = (id: string) => docTin(mt.goc, ACC, id)?.loi ?? "";

describe("A1 - chữ ký HMAC của dấu duyệt", () => {
  it("hash sha256 không khóa (cách duyệt cũ) KHÔNG gửi được, báo duyệt lại", async () => {
    const t = mt.tin("a");
    ghiTin(mt.goc, { ...t, banBam: bamTin(t) });
    assert.deepEqual(await chay(), []);
    assert.match(loiCua("a"), /kiểu cũ.*duyệt lại/);
  });

  it("dấu có tiền tố hmac1 nhưng ký bằng khóa khác bị từ chối", async () => {
    const t = mt.tin("a");
    const khoaLa = crypto.randomBytes(32);
    ghiTin(mt.goc, { ...t, banBam: kyDuyet(t, khoaLa) });
    assert.deepEqual(await chay(), []);
    assert.match(loiCua("a"), /chữ ký duyệt không khớp/);
  });

  it("sửa nội dung rồi tự băm lại bị từ chối (cả sha256 trần lẫn tiền tố giả)", async () => {
    const t = mt.tin("a");
    const sua: TinHopThu = { ...t, noiDung: "gửi tiền vào tài khoản X" };
    ghiTin(mt.goc, { ...sua, banBam: bamTin(sua) });
    const sua2: TinHopThu = { ...t, id: "bb", noiDung: "nội dung bị thay" };
    ghiTin(mt.goc, { ...sua2, banBam: `${TIEN_TO_CHU_KY}${bamTin(sua2)}` });
    assert.deepEqual(await chay(), []);
    assert.match(loiCua("a"), /duyệt lại/);
    assert.match(loiCua("bb"), /chữ ký duyệt không khớp/);
  });

  it("đổi threadId của tin đã duyệt (sang cuộc khác hợp lệ trong danh bạ) bị từ chối", async () => {
    const t = mt.tin("a");
    ghiTin(mt.goc, { ...t, threadId: NHOM_2 }); // cùng loại nhóm, chỉ đổi nơi nhận
    assert.deepEqual(await chay(), []);
    assert.match(loiCua("a"), /chữ ký duyệt không khớp/);
  });

  it("chữ ký đúng thì gửi đúng 1 lần", async () => {
    mt.tin("a");
    assert.deepEqual(await chay(), ["chào a"]);
    assert.deepEqual(await chay(), []);
    assert.equal(docTin(mt.goc, ACC, "a")?.trangThai, "da_gui");
  });

  it("thiếu khóa thì KHÔNG gửi và không lùi về hash cũ (kể cả tin ký đúng bằng khóa đã mất)", async () => {
    mt.tin("a");
    const t = mt.tin("bb");
    ghiTin(mt.goc, { ...t, banBam: bamTin(t) });
    const khoaThieu = fs.mkdtempSync(path.join(os.tmpdir(), "outbox-khongkhoa-"));
    const { daGoi, gui } = mt.guiGia();
    await xuLyHopThu({ ...mt.chung, thuMucKhoa: khoaThieu, gui });
    assert.equal(daGoi.length, 0);
    assert.match(loiCua("a"), /thiếu khóa ký/);
    assert.match(loiCua("bb"), /thiếu khóa ký/);
    assert.equal(fs.existsSync(duongDanKhoa(khoaThieu)), false, "bot không tự sinh khóa");
  });

  it("khóa nằm ngoài hop-thu-di; khóa đặt trong vùng log bị coi như không có", async () => {
    assert.equal(laTrongThuMuc(mt.thuMucKhoa, mt.goc), false);
    const trongLog = path.join(mt.goc, "khoa");
    layHoacTaoKhoa(trongLog);
    mt.tin("a");
    const { daGoi, gui } = mt.guiGia();
    await xuLyHopThu({ ...mt.chung, thuMucKhoa: trongLog, gui });
    assert.equal(daGoi.length, 0);
    assert.match(loiCua("a"), /thiếu khóa ký/);
  });

  it("layHoacTaoKhoa: sinh 32 byte ngẫu nhiên một lần, lần sau trả đúng khóa đó; file hỏng thì ném, không ghi đè", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "outbox-k-"));
    const k1 = layHoacTaoKhoa(dir);
    assert.equal(k1.length, 32);
    assert.deepEqual(layHoacTaoKhoa(dir), k1);
    assert.deepEqual(docKhoa(dir), k1);
    fs.writeFileSync(duongDanKhoa(dir), "hong");
    assert.equal(docKhoa(dir), null);
    assert.throws(() => layHoacTaoKhoa(dir), /hỏng/);
    assert.equal(fs.readFileSync(duongDanKhoa(dir), "utf8"), "hong");
  });

  it("kiemChuKy: đúng khóa và đúng tin mới đúng", () => {
    const t = mt.tin("a");
    assert.equal(kiemChuKy(t, mt.khoa), true);
    assert.equal(kiemChuKy({ ...t, id: "b" }, mt.khoa), false);
    assert.equal(kiemChuKy({ ...t, banBam: undefined }, mt.khoa), false);
    assert.equal(kiemChuKy(t, crypto.randomBytes(32)), false);
  });
});

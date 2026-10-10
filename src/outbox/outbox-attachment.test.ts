import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { bamBuffer, bamTepTheoLuong, kiemTepConNguyen, moTaTep, napTepDaDuyet } from "./outbox-attachment.js";
import type { QuyDinhTep } from "./outbox-path-guard.js";
import { TRAN_MB_TEP } from "./outbox-types.js";

let dir: string;
let q: QuyDinhTep;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "outbox-att-"));
  q = { thuMucDuocPhep: [dir], thuMucChan: [] };
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
function tao(ten: string, nd: Buffer | string): string {
  const p = path.join(dir, ten);
  fs.writeFileSync(p, nd);
  return p;
}
function taoCoKichThuoc(ten: string, byte: number): string {
  const p = path.join(dir, ten);
  const fd = fs.openSync(p, "w");
  fs.ftruncateSync(fd, byte);
  fs.closeSync(fd);
  return p;
}

describe("A7 - băm theo luồng", () => {
  it("hash luồng khớp hash đọc trọn (nhiều miếng 64 KB), và bamBuffer khớp cả hai", async () => {
    const data = crypto.randomBytes(3 * 1024 * 1024 + 17);
    const p = tao("lon.bin", data);
    assert.equal(await bamTepTheoLuong(p), sha(data));
    assert.equal(await bamBuffer(data), sha(data));
    assert.equal(await bamBuffer(crypto.randomBytes(40 * 1024 * 1024)).then((h) => h.length), 64);
  });

  it("biên 100 MB nhận, 100 MB + 1 byte từ chối", async () => {
    const dung = taoCoKichThuoc("dung-tran.bin", TRAN_MB_TEP * 1024 * 1024);
    const qua = taoCoKichThuoc("qua-tran.bin", TRAN_MB_TEP * 1024 * 1024 + 1);
    const mo = await moTaTep(dung, q);
    assert.equal(mo.kichThuoc, TRAN_MB_TEP * 1024 * 1024);
    assert.equal(mo.bam, await bamTepTheoLuong(dung));
    await assert.rejects(moTaTep(qua, q), /lớn quá 100 MB/);
  });

  it("ĐỔI 1 BYTE giữ nguyên kích thước bị phát hiện ở cả kiemTepConNguyen và napTepDaDuyet", async () => {
    const p = tao("hop-dong.pdf", Buffer.from("0123456789"));
    const mo = await moTaTep(p, q);
    assert.equal(await kiemTepConNguyen([mo], q), null);
    assert.ok("tep" in (await napTepDaDuyet([mo], q)));
    fs.writeFileSync(p, Buffer.from("0123456788"));
    assert.equal(fs.statSync(p).size, mo.kichThuoc);
    assert.match((await kiemTepConNguyen([mo], q)) ?? "", /bị sửa hoặc thay/);
    const nap = await napTepDaDuyet([mo], q);
    assert.match("loi" in nap ? nap.loi : "", /bị sửa hoặc thay/);
  });

  it("gửi đúng Buffer đã băm: data trả về có sha256 bằng mã lưu trong tin", async () => {
    const p = tao("bao-gia.xlsx", crypto.randomBytes(100_000));
    const mo = await moTaTep(p, q);
    const nap = await napTepDaDuyet([mo], q);
    assert.ok("tep" in nap);
    assert.equal(sha(nap.tep[0]!.data), mo.bam);
    assert.equal(nap.tep[0]!.filename, "bao-gia.xlsx");
  });
});

describe("A2 - kiểm lại thư mục cho phép lúc duyệt và lúc gửi", () => {
  it("tệp đã vào tin nhưng sau đó thư mục bị bỏ khỏi danh sách được phép -> không duyệt, không gửi", async () => {
    const p = tao("a.docx", "noi dung");
    const mo = await moTaTep(p, q);
    const chat: QuyDinhTep = { thuMucDuocPhep: [dir], thuMucChan: [dir] };
    assert.match((await kiemTepConNguyen([mo], chat)) ?? "", /thư mục bị chặn/);
    const nap = await napTepDaDuyet([mo], chat);
    assert.match("loi" in nap ? nap.loi : "", /thư mục bị chặn/);
    const khac: QuyDinhTep = { thuMucDuocPhep: [path.join(dir, "thu-muc-khac")], thuMucChan: [] };
    fs.mkdirSync(khac.thuMucDuocPhep[0]!);
    assert.match((await kiemTepConNguyen([mo], khac)) ?? "", /ngoài các thư mục được phép/);
  });

  it("tin lưu đường dẫn đi QUA junction (không phải đường thật) -> không gửi dù tệp giống hệt", async () => {
    const a = path.join(dir, "a");
    fs.mkdirSync(a);
    fs.writeFileSync(path.join(a, "f.txt"), "noi dung");
    const noi = path.join(dir, "noi");
    fs.symlinkSync(a, noi, "junction");
    const mo = await moTaTep(path.join(noi, "f.txt"), q);
    assert.ok(mo.duongDan.toLowerCase().includes(`${path.sep}a${path.sep}`), "moTaTep lưu đường dẫn THẬT");
    const nap = await napTepDaDuyet([{ ...mo, duongDan: path.join(noi, "f.txt") }], q);
    assert.match("loi" in nap ? nap.loi : "", /đường dẫn thật của tệp đã đổi/);
  });
});

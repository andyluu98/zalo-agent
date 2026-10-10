import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { bamBuffer, bamNoiDung, bamTin, docTin, ghiTin, moTaTep, type TepGui } from "./outbox-file-store.js";
import { xuLyHopThu } from "./outbox-sender.js";
import { ACC, taoMoiTruong, type MoiTruong } from "./outbox-test-helper.js";

let mt: MoiTruong;
beforeEach(() => {
  mt = taoMoiTruong();
});
afterEach(() => mt.don());

function taoTep(ten: string, noiDung: string | Buffer = "noi dung tep"): string {
  const p = path.join(mt.goc, ten);
  fs.writeFileSync(p, noiDung);
  return p;
}
function tinCoTep(id: string, tep: string[], noiDung = "gửi kèm file") {
  return mt.tin(id, { noiDung, tepDinhKem: tep.map(moTaTep) });
}

describe("xuLyHopThu - tệp đính kèm", () => {
  it("gửi kèm Buffer đúng nội dung + tên tệp; tin chỉ có tệp (không chữ) vẫn gửi được", async () => {
    const f1 = taoTep("bao-gia.xlsx", "AAA");
    const f2 = taoTep("hop-dong.pdf", "BBB");
    tinCoTep("a", [f1, f2]);
    tinCoTep("bb", [f1], "");
    const daGoi: { ten: string; byte: string }[][] = [];
    const gui = async (_t: string, _n: boolean, _c: string, tep: TepGui[]) => {
      daGoi.push(tep.map((x) => ({ ten: x.filename, byte: x.data.toString() })));
      return "1";
    };
    const kq = await xuLyHopThu({ ...mt.chung, gui });
    assert.equal(kq.daGui, 2);
    assert.deepEqual(daGoi, [
      [{ ten: "bao-gia.xlsx", byte: "AAA" }, { ten: "hop-dong.pdf", byte: "BBB" }],
      [{ ten: "bao-gia.xlsx", byte: "AAA" }],
    ]);
  });

  it("gửi ĐÚNG Buffer đã băm: bytes trao cho gui khớp mã băm lúc tạo tin, đổi tệp sau đó không lọt vào", async () => {
    const f = taoTep("bao-gia.xlsx", "ban goc");
    const t = tinCoTep("a", [f]);
    let khop = false;
    let byte = "";
    const gui = async (_t: string, _n: boolean, _c: string, tep: TepGui[]) => {
      fs.writeFileSync(f, "ban bi doi trong luc gui"); // đổi tệp NGAY khi đang gửi
      khop = (await bamBuffer(tep[0]!.data)) === t.tepDinhKem![0]!.bam;
      byte = tep[0]!.data.toString();
      return "1";
    };
    await xuLyHopThu({ ...mt.chung, gui });
    assert.equal(khop, true);
    assert.equal(byte, "ban goc");
  });

  it("đổi 1 byte GIỮ NGUYÊN kích thước sau khi duyệt -> loi, không gửi (nhánh so hash)", async () => {
    const f = taoTep("bao-gia.xlsx", "0123456789");
    tinCoTep("a", [f]);
    fs.writeFileSync(f, "0123456780");
    assert.equal(fs.statSync(f).size, 10);
    const { daGoi, gui } = mt.guiGia();
    await xuLyHopThu({ ...mt.chung, gui });
    assert.equal(daGoi.length, 0);
    assert.match(docTin(mt.goc, ACC, "a")?.loi ?? "", /bị sửa hoặc thay/);
  });

  it("tệp đổi kích thước hoặc bị xóa trước khi gửi -> loi", async () => {
    const f = taoTep("x.docx");
    const g = taoTep("y.docx");
    tinCoTep("a", [f]);
    tinCoTep("bb", [g]);
    fs.appendFileSync(f, "them");
    fs.unlinkSync(g);
    const { daGoi, gui } = mt.guiGia();
    await xuLyHopThu({ ...mt.chung, gui });
    assert.equal(daGoi.length, 0);
    assert.match(docTin(mt.goc, ACC, "a")?.loi ?? "", /bị sửa hoặc thay/);
    assert.match(docTin(mt.goc, ACC, "bb")?.loi ?? "", /không còn tệp/);
  });

  it("thêm tệp vào tin đã duyệt (không duyệt lại) -> loi vì chữ ký lệch", async () => {
    const f = taoTep("x.docx");
    const t = mt.tin("a");
    ghiTin(mt.goc, { ...t, tepDinhKem: [moTaTep(f)] });
    const { daGoi, gui } = mt.guiGia();
    await xuLyHopThu({ ...mt.chung, gui });
    assert.equal(daGoi.length, 0);
    assert.match(docTin(mt.goc, ACC, "a")?.loi ?? "", /đã bị sửa sau khi duyệt/);
  });

  it("tổng tệp quá trần của một tin -> loi, không nạp", async () => {
    const f = taoTep("x.docx");
    const mo = moTaTep(f);
    mt.tin("a", { tepDinhKem: [{ ...mo, kichThuoc: 301 * 1024 * 1024 }] });
    const { daGoi, gui } = mt.guiGia();
    await xuLyHopThu({ ...mt.chung, gui });
    assert.equal(daGoi.length, 0);
    assert.match(docTin(mt.goc, ACC, "a")?.loi ?? "", /tổng tệp đính kèm lớn quá/);
  });

  it("bamTin của tin không tệp = bamNoiDung cũ", () => {
    assert.equal(bamTin({ noiDung: "abc" }), bamNoiDung("abc"));
  });

  it("moTaTep chặn đường dẫn tương đối, tệp không tồn tại, tệp rỗng", () => {
    assert.throws(() => moTaTep("bao-gia.xlsx"), /tuyệt đối/);
    assert.throws(() => moTaTep(path.join(mt.goc, "khong-co.pdf")), /không thấy/);
    assert.throws(() => moTaTep(taoTep("rong.txt", "")), /rỗng/);
  });
});

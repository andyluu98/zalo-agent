import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as nghi } from "node:timers/promises";
import { afterEach, beforeEach, describe, it } from "node:test";
import { docTin, moTaTep } from "./outbox-file-store.js";
import { guiCoHan, hanGuiMacDinh } from "./outbox-send-deadline.js";
import { xuLyHopThu } from "./outbox-sender.js";
import { ACC, taoMoiTruong, type MoiTruong } from "./outbox-test-helper.js";

const PHUT = 60_000;
const MB = 1024 * 1024;

describe("hanGuiMacDinh: 5 phút + 1 phút mỗi 10 MB, trần 20 phút", () => {
  it("các mốc", () => {
    assert.equal(hanGuiMacDinh(0), 5 * PHUT);
    assert.equal(hanGuiMacDinh(1), 6 * PHUT);
    assert.equal(hanGuiMacDinh(10 * MB), 6 * PHUT);
    assert.equal(hanGuiMacDinh(10 * MB + 1), 7 * PHUT);
    assert.equal(hanGuiMacDinh(100 * MB), 15 * PHUT);
    assert.equal(hanGuiMacDinh(300 * MB), 20 * PHUT);
  });
});

describe("guiCoHan", () => {
  it("treo thì het_gio; xong trước hạn thì xong; ném (kể cả đồng bộ) thì loi", async () => {
    assert.deepEqual(await guiCoHan(() => new Promise(() => {}), 20), { loai: "het_gio" });
    assert.deepEqual(await guiCoHan(async () => "m1", 1000), { loai: "xong", msgId: "m1" });
    assert.deepEqual(await guiCoHan(async () => undefined, 1000), { loai: "xong" });
    assert.deepEqual(await guiCoHan(async () => { throw new Error("mạng đứt"); }, 1000), { loai: "loi", chiTiet: "mạng đứt" });
    assert.deepEqual(await guiCoHan(() => { throw new Error("ném đồng bộ"); }, 1000), { loai: "loi", chiTiet: "ném đồng bộ" });
  });

  it("lời gọi đến muộn ném lỗi sau khi quá hạn không thành unhandled rejection", async () => {
    let hong: (e: Error) => void = () => {};
    const kq = await guiCoHan(() => new Promise<string>((_, tu) => { hong = tu; }), 10);
    assert.equal(kq.loai, "het_gio");
    hong(new Error("muộn")); // không được làm sập tiến trình test
    await nghi(20);
  });
});

describe("A3 / B9 - gửi quá hạn trong xuLyHopThu", () => {
  let mt: MoiTruong;
  beforeEach(() => {
    mt = taoMoiTruong();
  });
  afterEach(() => mt.don());
  const HAN = () => 40;

  it("treo quá hạn thì loi 'không rõ đã gửi chưa', KHÔNG gửi lần 2 ở lượt sau, lượt trả về (không kẹt)", async () => {
    mt.tin("a");
    let lan = 0;
    const gui = () => {
      lan++;
      return new Promise<string>(() => {});
    };
    const kq = await xuLyHopThu({ ...mt.chung, gui, hanGuiMs: HAN });
    assert.equal(kq.daGui, 0);
    const a = docTin(mt.goc, ACC, "a")!;
    assert.equal(a.trangThai, "loi");
    assert.match(a.loi ?? "", /quá thời gian.*không rõ tin đã tới chưa, kiểm tra Zalo/);
    assert.ok(a.guiLuc, "giữ guiLuc để giãn nhịp tính đúng");
    await xuLyHopThu({ ...mt.chung, gui, hanGuiMs: HAN });
    assert.equal(lan, 1);
  });

  it("xong trước hạn thì da_gui kèm msgId", async () => {
    mt.tin("a");
    const gui = async () => {
      await nghi(5);
      return "777";
    };
    const kq = await xuLyHopThu({ ...mt.chung, gui, hanGuiMs: () => 2000 });
    assert.equal(kq.daGui, 1);
    assert.equal(docTin(mt.goc, ACC, "a")?.trangThai, "da_gui");
    assert.equal(docTin(mt.goc, ACC, "a")?.msgId, "777");
  });

  it("tin treo không chặn tin sau: tin kế tiếp vẫn được gửi trong cùng lượt", async () => {
    mt.tin("a");
    mt.tin("bb");
    let lan = 0;
    const gui = async (_t: string, _n: boolean, noiDung: string) => {
      lan++;
      if (noiDung === "chào a") return new Promise<string>(() => {});
      return "2";
    };
    const kq = await xuLyHopThu({ ...mt.chung, gui, hanGuiMs: HAN });
    assert.equal(kq.daGui, 1);
    assert.equal(lan, 2);
    assert.equal(docTin(mt.goc, ACC, "a")?.trangThai, "loi");
    assert.equal(docTin(mt.goc, ACC, "bb")?.trangThai, "da_gui");
  });

  it("trả lời đến muộn (sau quá hạn) KHÔNG ghi đè loi thành da_gui", async () => {
    mt.tin("a");
    let xongMuon: (id: string) => void = () => {};
    const gui = () => new Promise<string>((ok) => { xongMuon = ok; });
    await xuLyHopThu({ ...mt.chung, gui, hanGuiMs: HAN });
    xongMuon("999");
    await nghi(30);
    await xuLyHopThu({ ...mt.chung, gui, hanGuiMs: HAN });
    const a = docTin(mt.goc, ACC, "a")!;
    assert.equal(a.trangThai, "loi");
    assert.equal(a.msgId, undefined);
  });

  it("hạn tính theo tổng byte tệp của tin", async () => {
    const f = path.join(mt.goc, "a.txt");
    fs.writeFileSync(f, "12345");
    mt.tin("a", { tepDinhKem: [await moTaTep(f, mt.quyDinhTep)] });
    const thay: number[] = [];
    const { gui } = mt.guiGia();
    await xuLyHopThu({ ...mt.chung, gui, hanGuiMs: (b) => (thay.push(b), 1000) });
    assert.deepEqual(thay, [5]);
  });
});

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { docTin, type TinHopThu } from "./outbox-file-store.js";
import { thoiGianCho, xuLyHopThu } from "./outbox-sender.js";
import { ACC, CAU_HINH, NHOM, RIENG, taoMoiTruong, type MoiTruong } from "./outbox-test-helper.js";

let mt: MoiTruong;
beforeEach(() => {
  mt = taoMoiTruong();
});
afterEach(() => mt.don());

describe("xuLyHopThu", () => {
  it("chỉ gửi da_duyet, KHÔNG gửi cho_duyet / huy", async () => {
    mt.tin("a", { trangThai: "cho_duyet", banBam: undefined });
    mt.tin("b", { trangThai: "huy" });
    mt.tin("c");
    const { daGoi, gui } = mt.guiGia();
    const kq = await xuLyHopThu({ ...mt.chung, gui });
    assert.equal(kq.daGui, 1);
    assert.deepEqual(daGoi, [{ threadId: NHOM, laNhom: true, noiDung: "chào c" }]);
    assert.equal(docTin(mt.goc, ACC, "a")?.trangThai, "cho_duyet");
    const c = docTin(mt.goc, ACC, "c")!;
    assert.equal(c.trangThai, "da_gui");
    assert.equal(c.msgId, "999");
    assert.ok(c.guiLuc);
  });

  it("giành tin bằng dang_gui TRƯỚC khi gọi API; mỗi tin gửi đúng một lần dù chạy nhiều lượt", async () => {
    mt.tin("a");
    const trangThaiLucGui: (string | undefined)[] = [];
    const daGoi: string[] = [];
    const gui = async (_t: string, _n: boolean, noiDung: string) => {
      trangThaiLucGui.push(docTin(mt.goc, ACC, "a")?.trangThai);
      daGoi.push(noiDung);
      return "1";
    };
    await xuLyHopThu({ ...mt.chung, gui });
    await xuLyHopThu({ ...mt.chung, gui });
    assert.deepEqual(daGoi, ["chào a"]);
    assert.deepEqual(trangThaiLucGui, ["dang_gui"]);
  });

  it("dang_gui sót từ lần chạy trước -> loi, KHÔNG gửi lại", async () => {
    mt.tin("a", { trangThai: "dang_gui" });
    const { daGoi, gui } = mt.guiGia();
    await xuLyHopThu({ ...mt.chung, gui });
    assert.equal(daGoi.length, 0);
    assert.match(docTin(mt.goc, ACC, "a")!.loi!, /bot dừng giữa lúc gửi/);
  });

  it("nội dung bị sửa sau khi duyệt -> loi, không gửi", async () => {
    const t = mt.tin("a");
    mt.tin("a", { ...t, noiDung: "đã sửa", banBam: t.banBam });
    const { daGoi, gui } = mt.guiGia();
    await xuLyHopThu({ ...mt.chung, gui });
    assert.equal(daGoi.length, 0);
    assert.match(docTin(mt.goc, ACC, "a")!.loi!, /sửa sau khi duyệt/);
  });

  it("threadId lạ hoặc sai loại nhóm/riêng -> loi kèm đúng lý do", async () => {
    mt.tin("a", { threadId: "3333" });
    mt.tin("b", { threadId: RIENG, loaiCuoc: "nhom" });
    const { daGoi, gui } = mt.guiGia();
    await xuLyHopThu({ ...mt.chung, gui });
    assert.equal(daGoi.length, 0);
    assert.match(docTin(mt.goc, ACC, "a")?.loi ?? "", /threadId không có trong danh bạ/);
    assert.match(docTin(mt.goc, ACC, "b")?.loi ?? "", /loaiCuoc không khớp/);
  });

  it("nội dung rỗng hoặc dài quá 2000 ký tự -> loi", async () => {
    mt.tin("a", { noiDung: "   " });
    mt.tin("bb", { noiDung: "x".repeat(2001) });
    mt.tin("ccc", { noiDung: "x".repeat(2000) });
    const { daGoi, gui } = mt.guiGia();
    await xuLyHopThu({ ...mt.chung, gui });
    assert.match(docTin(mt.goc, ACC, "a")?.loi ?? "", /nội dung rỗng/);
    assert.match(docTin(mt.goc, ACC, "bb")?.loi ?? "", /dài quá 2000/);
    assert.deepEqual(daGoi.map((d) => d.noiDung.length), [2000]);
  });

  it("chat riêng gửi với laNhom=false", async () => {
    mt.tin("a", { threadId: RIENG, loaiCuoc: "rieng" });
    const { daGoi, gui } = mt.guiGia();
    await xuLyHopThu({ ...mt.chung, gui });
    assert.equal(daGoi[0]?.laNhom, false);
  });

  it("API ném lỗi -> loi, không thử lại ở lượt sau", async () => {
    mt.tin("a");
    let lan = 0;
    const gui = async (): Promise<string> => {
      lan++;
      throw new Error("mạng đứt");
    };
    await xuLyHopThu({ ...mt.chung, gui });
    await xuLyHopThu({ ...mt.chung, gui });
    assert.equal(lan, 1);
    assert.match(docTin(mt.goc, ACC, "a")!.loi!, /mạng đứt/);
  });

  it("giãn nhịp: tin thứ hai chờ, trả henLaiSauMs", async () => {
    mt.tin("a");
    mt.tin("bb");
    const { daGoi, gui } = mt.guiGia();
    const bayGio = () => new Date("2026-10-09T02:00:00.000Z");
    const kq = await xuLyHopThu({ ...mt.chung, gui, cauHinh: { cachNhauMs: 20_000, tranMoiGio: 100 }, bayGio });
    assert.equal(daGoi.length, 1);
    assert.equal(kq.henLaiSauMs, 20_000);
    assert.equal(docTin(mt.goc, ACC, "bb")?.trangThai, "da_duyet");
  });
});

describe("thoiGianCho", () => {
  it("chạm trần mỗi giờ thì chờ tới khi tin cũ nhất trôi khỏi cửa sổ", () => {
    const bayGio = Date.parse("2026-10-09T02:00:00.000Z");
    const daGui = (guiLuc: string): TinHopThu => ({ ...mt.tin(`x${guiLuc.length}`), trangThai: "da_gui", guiLuc });
    const ds = [daGui("2026-10-09T01:10:00.000Z"), daGui("2026-10-09T01:30:00.000Z")];
    assert.equal(thoiGianCho(ds, { cachNhauMs: 0, tranMoiGio: 2 }, bayGio), 10 * 60_000);
    assert.equal(thoiGianCho(ds, { ...CAU_HINH, tranMoiGio: 3 }, bayGio), 0);
  });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { bamNoiDung, docTin, ghiTin, type TinHopThu } from "./outbox-file-store.js";
import { thoiGianCho, xuLyHopThu } from "./outbox-sender.js";

const ACC = "acc-test";
const NHOM = "1111";
const RIENG = "2222";
let goc: string;

function ghiDanhBa(): void {
  const p = path.join(goc, ACC, "_du-lieu");
  fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(
    path.join(p, "danh-ba.json"),
    JSON.stringify({ threads: { [NHOM]: { ten: "Nhóm A", laNhom: true }, [RIENG]: { ten: "Người B", laNhom: false } } }),
  );
}

function tin(id: string, sua: Partial<TinHopThu> = {}): TinHopThu {
  const noiDung = sua.noiDung ?? `chào ${id}`;
  const t: TinHopThu = {
    id,
    accountId: ACC,
    threadId: NHOM,
    loaiCuoc: "nhom",
    tenCuoc: "Nhóm A",
    noiDung,
    trangThai: "da_duyet",
    taoLuc: `2026-10-09T01:00:0${id.length % 10}.000Z`,
    banBam: bamNoiDung(noiDung),
    ...sua,
  };
  ghiTin(goc, t);
  return t;
}

const CAU_HINH = { cachNhauMs: 0, tranMoiGio: 100 };

function guiGia() {
  const daGoi: { threadId: string; laNhom: boolean; noiDung: string }[] = [];
  const gui = async (threadId: string, laNhom: boolean, noiDung: string) => {
    daGoi.push({ threadId, laNhom, noiDung });
    return "999";
  };
  return { daGoi, gui };
}

beforeEach(() => {
  goc = fs.mkdtempSync(path.join(os.tmpdir(), "outbox-"));
  ghiDanhBa();
});
afterEach(() => fs.rmSync(goc, { recursive: true, force: true }));

describe("xuLyHopThu", () => {
  it("chỉ gửi da_duyet, KHÔNG gửi cho_duyet / huy", async () => {
    tin("a", { trangThai: "cho_duyet", banBam: undefined });
    tin("b", { trangThai: "huy" });
    tin("c");
    const { daGoi, gui } = guiGia();
    const kq = await xuLyHopThu({ goc, accountId: ACC, gui, cauHinh: CAU_HINH });
    assert.equal(kq.daGui, 1);
    assert.deepEqual(daGoi, [{ threadId: NHOM, laNhom: true, noiDung: "chào c" }]);
    assert.equal(docTin(goc, ACC, "a")?.trangThai, "cho_duyet");
    const c = docTin(goc, ACC, "c")!;
    assert.equal(c.trangThai, "da_gui");
    assert.equal(c.msgId, "999");
    assert.ok(c.guiLuc);
  });

  it("mỗi tin gửi đúng một lần dù chạy nhiều lượt", async () => {
    tin("a");
    const { daGoi, gui } = guiGia();
    await xuLyHopThu({ goc, accountId: ACC, gui, cauHinh: CAU_HINH });
    await xuLyHopThu({ goc, accountId: ACC, gui, cauHinh: CAU_HINH });
    assert.equal(daGoi.length, 1);
  });

  it("dang_gui sót từ lần chạy trước -> loi, KHÔNG gửi lại", async () => {
    tin("a", { trangThai: "dang_gui" });
    const { daGoi, gui } = guiGia();
    await xuLyHopThu({ goc, accountId: ACC, gui, cauHinh: CAU_HINH });
    assert.equal(daGoi.length, 0);
    assert.equal(docTin(goc, ACC, "a")?.trangThai, "loi");
  });

  it("nội dung bị sửa sau khi duyệt -> loi, không gửi", async () => {
    tin("a", { noiDung: "đã sửa", banBam: bamNoiDung("bản gốc") });
    const { daGoi, gui } = guiGia();
    await xuLyHopThu({ goc, accountId: ACC, gui, cauHinh: CAU_HINH });
    assert.equal(daGoi.length, 0);
    assert.match(docTin(goc, ACC, "a")!.loi!, /sửa sau khi duyệt/);
  });

  it("threadId lạ hoặc sai loại nhóm/riêng -> loi", async () => {
    tin("a", { threadId: "3333" });
    tin("b", { threadId: RIENG, loaiCuoc: "nhom" });
    const { daGoi, gui } = guiGia();
    await xuLyHopThu({ goc, accountId: ACC, gui, cauHinh: CAU_HINH });
    assert.equal(daGoi.length, 0);
    assert.equal(docTin(goc, ACC, "a")?.trangThai, "loi");
    assert.equal(docTin(goc, ACC, "b")?.trangThai, "loi");
  });

  it("chat riêng gửi với laNhom=false", async () => {
    tin("a", { threadId: RIENG, loaiCuoc: "rieng" });
    const { daGoi, gui } = guiGia();
    await xuLyHopThu({ goc, accountId: ACC, gui, cauHinh: CAU_HINH });
    assert.equal(daGoi[0]?.laNhom, false);
  });

  it("API ném lỗi -> loi, không thử lại ở lượt sau", async () => {
    tin("a");
    let lan = 0;
    const gui = async () => {
      lan++;
      throw new Error("mạng đứt");
    };
    await xuLyHopThu({ goc, accountId: ACC, gui, cauHinh: CAU_HINH });
    await xuLyHopThu({ goc, accountId: ACC, gui, cauHinh: CAU_HINH });
    assert.equal(lan, 1);
    assert.match(docTin(goc, ACC, "a")!.loi!, /mạng đứt/);
  });

  it("giãn nhịp: tin thứ hai chờ, trả henLaiSauMs", async () => {
    tin("a");
    tin("bb");
    const { daGoi, gui } = guiGia();
    const bayGio = () => new Date("2026-10-09T02:00:00.000Z");
    const kq = await xuLyHopThu({ goc, accountId: ACC, gui, cauHinh: { cachNhauMs: 20_000, tranMoiGio: 100 }, bayGio });
    assert.equal(daGoi.length, 1);
    assert.equal(kq.henLaiSauMs, 20_000);
    assert.equal(docTin(goc, ACC, "bb")?.trangThai, "da_duyet");
  });
});

describe("thoiGianCho", () => {
  const daGui = (guiLuc: string) => ({ ...tin(`x${guiLuc.length}`), trangThai: "da_gui" as const, guiLuc });
  it("chạm trần mỗi giờ thì chờ tới khi tin cũ nhất trôi khỏi cửa sổ", () => {
    const bayGio = Date.parse("2026-10-09T02:00:00.000Z");
    const ds = [daGui("2026-10-09T01:10:00.000Z"), daGui("2026-10-09T01:30:00.000Z")];
    assert.equal(thoiGianCho(ds, { cachNhauMs: 0, tranMoiGio: 2 }, bayGio), 10 * 60_000);
    assert.equal(thoiGianCho(ds, { cachNhauMs: 0, tranMoiGio: 3 }, bayGio), 0);
  });
});

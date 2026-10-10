import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { bamNoiDung, bamTin, docTin, dungTag, ghiTin, moTaTep, type TinHopThu } from "./outbox-file-store.js";
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

describe("xuLyHopThu - tệp đính kèm", () => {
  function taoTep(ten: string, noiDung = "noi dung tep"): string {
    const p = path.join(goc, ten);
    fs.writeFileSync(p, noiDung);
    return p;
  }
  function tinCoTep(id: string, tep: string[], noiDung = "gửi kèm file") {
    const tepDinhKem = tep.map(moTaTep);
    return tin(id, { noiDung, tepDinhKem, banBam: bamTin({ noiDung, tepDinhKem }) });
  }

  it("gửi kèm đúng đường dẫn tệp; tin chỉ có tệp (không chữ) vẫn gửi được", async () => {
    const f1 = taoTep("bao-gia.xlsx");
    const f2 = taoTep("hop-dong.pdf");
    tinCoTep("a", [f1, f2]);
    tinCoTep("b", [f1], "");
    const daGoi: string[][] = [];
    const gui = async (_t: string, _n: boolean, _c: string, tep: string[]) => {
      daGoi.push(tep);
      return "1";
    };
    const kq = await xuLyHopThu({ goc, accountId: ACC, gui, cauHinh: CAU_HINH });
    assert.equal(kq.daGui, 2);
    assert.deepEqual(daGoi, [[f1, f2], [f1]]);
  });

  it("tệp bị sửa SAU khi duyệt -> loi, không gửi", async () => {
    const f = taoTep("bao-gia.xlsx");
    tinCoTep("a", [f]);
    fs.writeFileSync(f, "noi dung DA DOI");
    const { daGoi, gui } = guiGia();
    await xuLyHopThu({ goc, accountId: ACC, gui, cauHinh: CAU_HINH });
    assert.equal(daGoi.length, 0);
    assert.match(docTin(goc, ACC, "a")?.loi ?? "", /bị sửa hoặc thay/);
  });

  it("tệp bị xóa trước khi gửi -> loi", async () => {
    const f = taoTep("x.docx");
    tinCoTep("a", [f]);
    fs.unlinkSync(f);
    const { gui } = guiGia();
    await xuLyHopThu({ goc, accountId: ACC, gui, cauHinh: CAU_HINH });
    assert.match(docTin(goc, ACC, "a")?.loi ?? "", /không còn tệp/);
  });

  it("thêm tệp vào tin đã duyệt (không duyệt lại) -> loi vì mã duyệt lệch", async () => {
    const f = taoTep("x.docx");
    const t = tin("a");
    ghiTin(goc, { ...t, tepDinhKem: [moTaTep(f)] });
    const { daGoi, gui } = guiGia();
    await xuLyHopThu({ goc, accountId: ACC, gui, cauHinh: CAU_HINH });
    assert.equal(daGoi.length, 0);
    assert.match(docTin(goc, ACC, "a")?.loi ?? "", /đã bị sửa sau khi duyệt/);
  });

  it("bamTin của tin không tệp = bamNoiDung cũ (tin duyệt từ bản trước vẫn hợp lệ)", () => {
    assert.equal(bamTin({ noiDung: "abc" }), bamNoiDung("abc"));
  });

  it("moTaTep chặn đường dẫn tương đối, tệp không tồn tại, tệp rỗng", () => {
    assert.throws(() => moTaTep("bao-gia.xlsx"), /tuyệt đối/);
    assert.throws(() => moTaTep(path.join(goc, "khong-co.pdf")), /không thấy/);
    assert.throws(() => moTaTep(taoTep("rong.txt", "")), /rỗng/);
  });
});

describe("xuLyHopThu - tag tên", () => {
  function tinCoTag(id: string, noiDung: string, nguoi: { uid: string; ten: string }[], sua: Partial<TinHopThu> = {}) {
    const d = dungTag(noiDung, nguoi);
    return tin(id, { noiDung: d.noiDung, nhacTen: d.nhacTen, banBam: bamTin(d), ...sua });
  }

  it("dungTag: tìm @Tên có sẵn, chèn @Tên còn thiếu vào đầu, hai người trùng tên lấy hai vị trí", () => {
    const a = dungTag("@Hải xem giúp nhé", [{ uid: "1", ten: "Hải" }]);
    assert.deepEqual(a, { noiDung: "@Hải xem giúp nhé", nhacTen: [{ uid: "1", pos: 0, len: 4 }] });
    const b = dungTag("xem giúp nhé", [{ uid: "1", ten: "Hải" }, { uid: "-1", ten: "All" }]);
    assert.equal(b.noiDung, "@Hải @All xem giúp nhé");
    assert.deepEqual(b.nhacTen, [{ uid: "1", pos: 0, len: 4 }, { uid: "-1", pos: 5, len: 4 }]);
    const c = dungTag("@An và @An", [{ uid: "1", ten: "An" }, { uid: "2", ten: "An" }]);
    assert.deepEqual(c.nhacTen.map((x) => x.pos), [0, 7]);
  });

  it("gửi kèm danh sách tag đúng vị trí", async () => {
    tinCoTag("a", "anh xem giúp", [{ uid: "123", ten: "Hải" }]);
    const daGoi: unknown[] = [];
    const gui = async (_t: string, _n: boolean, c: string, _f: string[], tag: unknown[]) => {
      daGoi.push({ c, tag });
      return "1";
    };
    await xuLyHopThu({ goc, accountId: ACC, gui, cauHinh: CAU_HINH });
    assert.deepEqual(daGoi, [{ c: "@Hải anh xem giúp", tag: [{ uid: "123", pos: 0, len: 4 }] }]);
  });

  it("tag trong chat riêng -> loi, không gửi", async () => {
    tinCoTag("a", "chào", [{ uid: "123", ten: "B" }], { threadId: RIENG, loaiCuoc: "rieng", tenCuoc: "Người B" });
    const { daGoi, gui } = guiGia();
    await xuLyHopThu({ goc, accountId: ACC, gui, cauHinh: CAU_HINH });
    assert.equal(daGoi.length, 0);
    assert.match(docTin(goc, ACC, "a")?.loi ?? "", /chỉ tag được trong tin nhóm/);
  });

  it("sửa chữ sau khi duyệt làm lệch tag -> loi (mã duyệt không khớp)", async () => {
    const t = tinCoTag("a", "anh xem giúp", [{ uid: "123", ten: "Hải" }]);
    ghiTin(goc, { ...t, noiDung: "Chú ý: " + t.noiDung });
    const { daGoi, gui } = guiGia();
    await xuLyHopThu({ goc, accountId: ACC, gui, cauHinh: CAU_HINH });
    assert.equal(daGoi.length, 0);
    assert.match(docTin(goc, ACC, "a")?.loi ?? "", /đã bị sửa sau khi duyệt/);
  });
});

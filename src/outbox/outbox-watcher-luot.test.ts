import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ThreadType, type API } from "zca-js";
import { doiChoDenKhi } from "../shared/doi-cho-den-khi.js";
import { docTin, ghiTin, kyDuyet, moTaTep } from "./outbox-file-store.js";
import { ACC, CAU_HINH, NHOM, RIENG, taoMoiTruong, type MoiTruong } from "./outbox-test-helper.js";
import { motLuot, taoBoKichHoat, type PhuThuocLuot } from "./outbox-watcher-luot.js";

type Goi = { tin: unknown; threadId: string; loai: ThreadType };

let mt: MoiTruong;
beforeEach(() => {
  mt = taoMoiTruong();
});
afterEach(() => mt.don());

/** zca-js giả: ghi lại mọi lời gọi `sendMessage` */
function apiGia(tra: (t: unknown) => Promise<unknown> = async () => ({ message: { msgId: 55 } })) {
  const goi: Goi[] = [];
  const api = {
    sendMessage: async (tin: unknown, threadId: string, loai: ThreadType) => {
      goi.push({ tin, threadId, loai });
      return tra(tin);
    },
  } as unknown as Pick<API, "sendMessage">;
  return { api, goi };
}

function phuThuoc(api: Pick<API, "sendMessage"> | undefined, sua: Partial<PhuThuocLuot> = {}): PhuThuocLuot {
  return {
    goc: mt.goc,
    thuMucKhoa: mt.thuMucKhoa,
    quyDinhTep: () => mt.quyDinhTep,
    hopThuBat: () => true,
    cauHinh: () => CAU_HINH,
    accountDangChay: () => [ACC],
    laChiDoc: () => true,
    layApi: () => api,
    log: { info: () => {}, error: () => {} },
    ...sua,
  };
}

describe("motLuot với zca-js giả", () => {
  it("account chỉ đọc, đang chạy, có api: gửi đúng một lần (chữ thuần = một chuỗi), ghi da_gui + msgId", async () => {
    mt.tin("a");
    const { api, goi } = apiGia();
    await motLuot(phuThuoc(api));
    await motLuot(phuThuoc(api));
    assert.equal(goi.length, 1);
    assert.deepEqual(goi[0], { tin: "chào a", threadId: NHOM, loai: ThreadType.Group });
    assert.equal(docTin(mt.goc, ACC, "a")?.trangThai, "da_gui");
    assert.equal(docTin(mt.goc, ACC, "a")?.msgId, "55");
  });

  it("tin có tệp + tag: một lời gọi {msg, attachments: Buffer, mentions}", async () => {
    const f = path.join(mt.goc, "bao-gia.xlsx");
    fs.writeFileSync(f, "ABC");
    mt.tin("a", {
      noiDung: "@Hải xem giúp",
      tepDinhKem: [await moTaTep(f, mt.quyDinhTep)],
      nhacTen: [{ uid: "123", pos: 0, len: 4 }],
    });
    const { api, goi } = apiGia();
    await motLuot(phuThuoc(api));
    const tin = goi[0]!.tin as { msg: string; attachments: { data: Buffer; filename: string; metadata: object }[]; mentions: object[] };
    assert.equal(tin.msg, "@Hải xem giúp");
    assert.equal(tin.attachments[0]!.data.toString(), "ABC");
    assert.equal(tin.attachments[0]!.filename, "bao-gia.xlsx");
    assert.deepEqual(tin.attachments[0]!.metadata, { totalSize: 3 });
    assert.deepEqual(tin.mentions, [{ pos: 0, uid: "123", len: 4 }]);
  });

  it("R5: OUTBOX_ENABLED tắt thì không gửi gì và không đụng tin", async () => {
    mt.tin("a");
    const { api, goi } = apiGia();
    assert.equal(await motLuot(phuThuoc(api, { hopThuBat: () => false })), undefined);
    assert.equal(goi.length, 0);
    assert.equal(docTin(mt.goc, ACC, "a")?.trangThai, "da_duyet");
  });

  it("R6: account KHÔNG chỉ đọc, không chạy, hoặc không có api cá nhân (kênh bot) thì không gửi", async () => {
    mt.tin("a");
    const { api, goi } = apiGia();
    await motLuot(phuThuoc(api, { laChiDoc: () => false }));
    await motLuot(phuThuoc(api, { accountDangChay: () => [] }));
    await motLuot(phuThuoc(undefined));
    assert.equal(goi.length, 0);
    assert.equal(docTin(mt.goc, ACC, "a")?.trangThai, "da_duyet");
  });

  it("A3/B9: sendMessage treo thì loi sau hạn, lượt TRẢ VỀ, tin sau vẫn gửi được", async () => {
    mt.tin("a");
    mt.tin("bb");
    const { api, goi } = apiGia((t) => (t === "chào a" ? new Promise(() => {}) : Promise.resolve({ message: { msgId: 9 } })));
    await motLuot(phuThuoc(api, { hanGuiMs: () => 40 }));
    assert.equal(goi.length, 2);
    assert.match(docTin(mt.goc, ACC, "a")?.loi ?? "", /quá thời gian/);
    assert.equal(docTin(mt.goc, ACC, "bb")?.trangThai, "da_gui");
  });

  it("một account ném lỗi không chặn account sau nó", async () => {
    const hai = "acc-hai";
    fs.mkdirSync(path.join(mt.goc, hai, "_du-lieu"), { recursive: true });
    fs.writeFileSync(path.join(mt.goc, hai, "_du-lieu", "danh-ba.json"), JSON.stringify({ threads: { [RIENG]: { ten: "B", laNhom: false } } }));
    const t = { id: "x", accountId: hai, threadId: RIENG, loaiCuoc: "rieng" as const, tenCuoc: "B", noiDung: "chào hai", trangThai: "da_duyet" as const, taoLuc: "2026-10-09T01:00:00.000Z" };
    ghiTin(mt.goc, { ...t, banBam: kyDuyet(t, mt.khoa) });
    mt.tin("a");
    const { api, goi } = apiGia();
    const loi: string[] = [];
    const p = phuThuoc(undefined, {
      accountDangChay: () => [ACC, hai],
      layApi: (id) => {
        if (id === ACC) throw new Error("nổ ở account đầu");
        return api;
      },
      log: { info: () => {}, error: (o) => loi.push(String((o as { accountId: string }).accountId)) },
    });
    await motLuot(p);
    assert.deepEqual(loi, [ACC]);
    assert.equal(goi.length, 1);
    assert.equal(docTin(mt.goc, hai, "x")?.trangThai, "da_gui");
  });

  it("còn tin đang chờ giãn nhịp thì trả số ms hẹn lượt sau", async () => {
    mt.tin("a");
    mt.tin("bb");
    const { api } = apiGia();
    const hen = await motLuot(phuThuoc(api, { cauHinh: () => ({ cachNhauMs: 60_000, tranMoiGio: 100 }) }));
    assert.ok(hen !== undefined && hen > 50_000 && hen <= 60_000, `hen=${hen}`);
  });
});

describe("taoBoKichHoat - cờ dangChay được nhả", () => {
  it("lượt ném lỗi hay hỏng không làm kẹt: lần kích hoạt sau vẫn chạy", async () => {
    let lan = 0;
    const loi: unknown[] = [];
    const bo = taoBoKichHoat(async () => {
      lan++;
      if (lan === 1) throw new Error("lượt đầu hỏng");
    }, (e) => loi.push(e));
    bo.kichHoat();
    await doiChoDenKhi(() => lan === 1 && !bo.dangChay(), { moTa: "lượt đầu xong" });
    assert.equal(loi.length, 1);
    bo.kichHoat();
    await doiChoDenKhi(() => lan === 2 && !bo.dangChay(), { moTa: "lượt hai chạy" });
  });

  it("kích hoạt khi đang chạy thì chạy thêm đúng MỘT lượt sau đó (gom nhiều lần thành một)", async () => {
    let lan = 0;
    let mo: () => void = () => {};
    const bo = taoBoKichHoat(async () => {
      lan++;
      if (lan === 1) await new Promise<void>((r) => { mo = r; });
    }, () => {});
    bo.kichHoat();
    bo.kichHoat();
    bo.kichHoat();
    assert.equal(lan, 1);
    mo();
    await doiChoDenKhi(() => lan === 2 && !bo.dangChay(), { moTa: "lượt bù" });
    assert.equal(lan, 2);
  });
});

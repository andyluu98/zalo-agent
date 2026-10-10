import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  danhSachAccountCoHopThu,
  danhSachTin,
  docTin,
  ghiTin,
  thuMucHopThu,
  THU_MUC_HOP_THU,
} from "./outbox-file-store.js";
import { ACC, taoMoiTruong, type MoiTruong } from "./outbox-test-helper.js";

let mt: MoiTruong;
beforeEach(() => {
  mt = taoMoiTruong();
});
afterEach(() => mt.don());

/** Ghi tay một file JSON vào thư mục `thuMuc`, không qua ghiTin (như kẻ ghi được vào hop-thu-di/) */
function ghiTay(thuMuc: string, tenFile: string, tin: object): void {
  const dir = path.join(mt.goc, THU_MUC_HOP_THU, thuMuc);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, tenFile), JSON.stringify(tin));
}

describe("A6 - tin đọc đúng chỗ", () => {
  it("tin hợp lệ đọc được", () => {
    const t = mt.tin("a");
    assert.equal(docTin(mt.goc, ACC, "a")?.noiDung, t.noiDung);
    assert.equal(danhSachTin(mt.goc, ACC).length, 1);
  });

  it("tin ở thư mục A khai accountId B bị bỏ (không gửi bằng nick B)", () => {
    const t = mt.tin("a");
    ghiTay("acc-khac", "a.json", { ...t, accountId: ACC });
    assert.equal(docTin(mt.goc, "acc-khac", "a"), null);
    assert.deepEqual(danhSachTin(mt.goc, "acc-khac"), []);
  });

  it("tên file khác id trong tin bị bỏ", () => {
    const t = mt.tin("a");
    ghiTay(ACC, "bb.json", t);
    assert.equal(docTin(mt.goc, ACC, "bb"), null);
    assert.deepEqual(danhSachTin(mt.goc, ACC).map((x) => x.id), ["a"]);
  });

  it("accountId chứa ../ hoặc không phải kebab-case bị từ chối khi ghi, đọc, liệt kê", () => {
    const t = mt.tin("a");
    assert.throws(() => ghiTin(mt.goc, { ...t, accountId: "../ngoai" }), /accountId không hợp lệ/);
    assert.throws(() => thuMucHopThu(mt.goc, ".."), /accountId không hợp lệ/);
    assert.throws(() => thuMucHopThu(mt.goc, "A/b"), /accountId không hợp lệ/);
    assert.equal(docTin(mt.goc, "../x", "a"), null);
    assert.deepEqual(danhSachTin(mt.goc, ".."), []);
    // file tin tự khai accountId độc hại, nằm trong thư mục hợp lệ -> schema loại
    ghiTay(ACC, "c.json", { ...t, id: "c", accountId: "../ngoai" });
    assert.equal(docTin(mt.goc, ACC, "c"), null);
  });

  it("thư mục tên lạ trong hop-thu-di không được coi là account", () => {
    mt.tin("a");
    fs.mkdirSync(path.join(mt.goc, THU_MUC_HOP_THU, "Tên Lạ"), { recursive: true });
    assert.deepEqual(danhSachAccountCoHopThu(mt.goc), [ACC]);
  });
});

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { docTin, dungTag, ghiTin, type TinHopThu } from "./outbox-file-store.js";
import { xuLyHopThu } from "./outbox-sender.js";
import { ACC, RIENG, taoMoiTruong, type MoiTruong } from "./outbox-test-helper.js";

let mt: MoiTruong;
beforeEach(() => {
  mt = taoMoiTruong();
});
afterEach(() => mt.don());

function tinCoTag(id: string, noiDung: string, nguoi: { uid: string; ten: string }[], sua: Partial<TinHopThu> = {}) {
  const d = dungTag(noiDung, nguoi);
  return mt.tin(id, { noiDung: d.noiDung, nhacTen: d.nhacTen, ...sua });
}

describe("xuLyHopThu - tag tên", () => {
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
    const gui = async (_t: string, _n: boolean, c: string, _f: unknown[], tag: unknown[]) => {
      daGoi.push({ c, tag });
      return "1";
    };
    await xuLyHopThu({ ...mt.chung, gui });
    assert.deepEqual(daGoi, [{ c: "@Hải anh xem giúp", tag: [{ uid: "123", pos: 0, len: 4 }] }]);
  });

  it("tag trong chat riêng -> loi, không gửi", async () => {
    tinCoTag("a", "chào", [{ uid: "123", ten: "B" }], { threadId: RIENG, loaiCuoc: "rieng", tenCuoc: "Người B" });
    const { daGoi, gui } = mt.guiGia();
    await xuLyHopThu({ ...mt.chung, gui });
    assert.equal(daGoi.length, 0);
    assert.match(docTin(mt.goc, ACC, "a")?.loi ?? "", /chỉ tag được trong tin nhóm/);
  });

  it("sửa chữ sau khi duyệt làm lệch tag -> loi (chữ ký không khớp)", async () => {
    const t = tinCoTag("a", "anh xem giúp", [{ uid: "123", ten: "Hải" }]);
    ghiTin(mt.goc, { ...t, noiDung: "Chú ý: " + t.noiDung });
    const { daGoi, gui } = mt.guiGia();
    await xuLyHopThu({ ...mt.chung, gui });
    assert.equal(daGoi.length, 0);
    assert.match(docTin(mt.goc, ACC, "a")?.loi ?? "", /đã bị sửa sau khi duyệt/);
  });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { docTin, thuMucHopThu } from "./outbox-file-store.js";
import { xuLyHopThu } from "./outbox-sender.js";
import { ACC, taoMoiTruong, type MoiTruong } from "./outbox-test-helper.js";
import { doiTrangThai } from "./outbox-transaction.js";

let mt: MoiTruong;
beforeEach(() => {
  mt = taoMoiTruong();
});
afterEach(() => mt.don());

const huy = (id: string, choMs = 50) =>
  doiTrangThai(
    mt.goc,
    ACC,
    id,
    (t) => (t.trangThai === "cho_duyet" || t.trangThai === "da_duyet" ? null : `đã ${t.trangThai}`),
    (t) => ({ ...t, trangThai: "huy" }),
    choMs,
  );
const khoaCua = (id: string) => path.join(thuMucHopThu(mt.goc, ACC), `${id}.lock`);

describe("A5 - hủy tin an toàn", () => {
  it("hủy tin cho_duyet / da_duyet thành công", () => {
    mt.tin("a", { trangThai: "cho_duyet", banBam: undefined });
    mt.tin("bb");
    assert.equal(huy("a").ok, true);
    assert.equal(huy("bb").ok, true);
    assert.equal(docTin(mt.goc, ACC, "a")?.trangThai, "huy");
    assert.equal(docTin(mt.goc, ACC, "bb")?.trangThai, "huy");
  });

  it("hủy tin dang_gui / da_gui / loi bị từ chối, file giữ nguyên, báo đúng trạng thái thật", () => {
    for (const [id, tt] of [["a", "dang_gui"], ["bb", "da_gui"], ["ccc", "loi"]] as const) {
      mt.tin(id, { trangThai: tt });
      const truoc = fs.readFileSync(path.join(thuMucHopThu(mt.goc, ACC), `${id}.json`), "utf8");
      const kq = huy(id);
      assert.equal(kq.ok, false);
      assert.equal(!kq.ok && kq.hienTai?.trangThai, tt);
      assert.equal(fs.readFileSync(path.join(thuMucHopThu(mt.goc, ACC), `${id}.json`), "utf8"), truoc);
    }
  });

  it("bot giành tin (dang_gui) TRƯỚC thì lệnh hủy dựa trên bản đọc cũ thất bại, tin vẫn dang_gui", () => {
    const t = mt.tin("a");
    const gianh = doiTrangThai(mt.goc, ACC, "a", (x) => (x.trangThai === "da_duyet" ? null : "đổi"), (x) => ({ ...x, trangThai: "dang_gui" }));
    assert.equal(gianh.ok, true);
    assert.equal(t.trangThai, "da_duyet", "bản CLI đã đọc trước đó vẫn là da_duyet");
    const kq = huy("a");
    assert.equal(kq.ok, false);
    assert.equal(docTin(mt.goc, ACC, "a")?.trangThai, "dang_gui");
  });

  it("đang giữ khóa thì bên kia bận (không đọc, không ghi) - hủy và giành không thể đan xen", () => {
    mt.tin("a");
    let long: ReturnType<typeof huy> | undefined;
    const ngoai = doiTrangThai(
      mt.goc,
      ACC,
      "a",
      () => null,
      (t) => {
        long = huy("a", 30); // bên kia chen vào giữa lúc ta đang đọc-kiểm-ghi
        return { ...t, trangThai: "dang_gui" };
      },
    );
    assert.equal(ngoai.ok, true);
    assert.equal(long?.ok, false);
    assert.equal(long && !long.ok && long.banRon, true);
    assert.equal(docTin(mt.goc, ACC, "a")?.trangThai, "dang_gui", "lệnh hủy chen vào không ghi đè");
  });

  it("khóa luôn được nhả (kể cả khi callback ném); khóa bỏ quên quá 30 giây bị cướp lại", () => {
    mt.tin("a");
    assert.throws(() => doiTrangThai(mt.goc, ACC, "a", () => null, () => { throw new Error("hỏng"); }), /hỏng/);
    assert.equal(fs.existsSync(khoaCua("a")), false);
    huy("a");
    assert.equal(fs.existsSync(khoaCua("a")), false);
    mt.tin("bb");
    fs.writeFileSync(khoaCua("bb"), "tien trinh da chet");
    const ron = huy("bb");
    assert.equal(!ron.ok && ron.banRon, true, "khóa mới vẫn còn hiệu lực");
    const cu = new Date(Date.now() - 60_000);
    fs.utimesSync(khoaCua("bb"), cu, cu);
    assert.equal(huy("bb").ok, true);
  });

  it("tin bị hủy chen vào TRƯỚC khi bot giành thì bot không gửi", async () => {
    mt.tin("a");
    const { daGoi, gui } = mt.guiGia();
    await xuLyHopThu({ ...mt.chung, gui, truocKhiGianh: () => void huy("a") });
    assert.equal(daGoi.length, 0);
    assert.equal(docTin(mt.goc, ACC, "a")?.trangThai, "huy");
  });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { SoTrangThai, soSanhMsgId } from "./trang-thai-chi-doc.js";

const taoThuMuc = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "zalo-trangthai-"));

describe("soSanhMsgId", () => {
  it("so theo giá trị số, không theo chữ (chuỗi dài hơn là số lớn hơn)", () => {
    assert.ok(soSanhMsgId("10", "9") > 0);
    assert.ok(soSanhMsgId("7000000000001", "7000000000002") < 0);
    assert.equal(soSanhMsgId("123", "123"), 0);
  });
});

describe("SoTrangThai", () => {
  it("ghi .json + .md, giờ hiển thị theo múi giờ bot", () => {
    const goc = taoThuMuc();
    const so = new SoTrangThai(goc, () => "Asia/Ho_Chi_Minh", () => new Date("2026-10-06T02:00:00Z"));
    so.cap("acc", { tinhTrang: "dang_ket_noi", ketNoiLuc: "2026-10-06T01:55:00Z" });
    const md = fs.readFileSync(path.join(goc, "acc", "00_trang-thai.md"), "utf8");
    assert.match(md, /Tình trạng: \*\*Đang kết nối\*\*/);
    assert.match(md, /Cập nhật lúc: 2026-10-06 09:00/);
    assert.match(md, /Kết nối gần nhất: 2026-10-06 08:55/);
    const json = JSON.parse(fs.readFileSync(path.join(goc, "acc", "_du-lieu", "trang-thai.json"), "utf8"));
    assert.equal(json.tinhTrang, "dang_ket_noi");
  });

  it("msgId cuối chỉ tăng, tách riêng user / group, và sống qua khởi động lại", () => {
    const goc = taoThuMuc();
    const so = new SoTrangThai(goc, () => "UTC");
    so.ghiNhanTin("acc", "user", "100", "2026-10-06T01:00:00Z");
    so.ghiNhanTin("acc", "user", "99", "2026-10-06T00:59:00Z");
    so.ghiNhanTin("acc", "group", "50", "2026-10-06T01:01:00Z");

    const moi = new SoTrangThai(goc, () => "UTC");
    assert.deepEqual(moi.doc("acc").msgIdCuoi, { user: "100", group: "50" });
    assert.equal(moi.doc("acc").tinGanNhatLuc, "2026-10-06T01:01:00Z");
    assert.equal(moi.laTinMoi("acc", "user", "100"), false);
    assert.equal(moi.laTinMoi("acc", "user", "101"), true);
    assert.equal(moi.laTinMoi("acc", "group", "49"), false);
  });

  it("chưa có msgId cuối thì mọi tin đều mới; file hỏng không làm sập", () => {
    const goc = taoThuMuc();
    fs.mkdirSync(path.join(goc, "acc", "_du-lieu"), { recursive: true });
    fs.writeFileSync(path.join(goc, "acc", "_du-lieu", "trang-thai.json"), "{hỏng");
    const so = new SoTrangThai(goc, () => "UTC");
    assert.equal(so.laTinMoi("acc", "user", "1"), true);
  });

  it("nâng cấp: đọc msgId cuối từ file bố cục cũ (_trang-thai.json) khi bản mới chưa có", () => {
    const goc = taoThuMuc();
    fs.mkdirSync(path.join(goc, "acc"));
    fs.writeFileSync(path.join(goc, "acc", "_trang-thai.json"), JSON.stringify({ msgIdCuoi: { user: "500" } }));
    const so = new SoTrangThai(goc, () => "UTC");
    assert.equal(so.laTinMoi("acc", "user", "500"), false);
    assert.equal(so.laTinMoi("acc", "user", "501"), true);
  });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { docKhoa, duongDanKhoa, kiemChuKy, TIEN_TO_CHU_KY } from "./outbox-file-store.js";
import { taoMoiTruongCli, type MoiTruongCli } from "./outbox-cli-test-helper.js";
import { NHOM } from "./outbox-test-helper.js";

let cli: MoiTruongCli;
beforeEach(() => {
  cli = taoMoiTruongCli();
});
afterEach(() => cli.don());

describe("CLI outbox (tiến trình con, thư mục tạm)", () => {
  it("add threadId lạ: thoát lỗi, không tạo tin", () => {
    const r = cli.chay(["add", "--thread", "9999", "--text", "xin chào"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /threadId 9999 không có trong danh bạ log/);
    assert.deepEqual(cli.dsFile(), []);
  });

  it("add + approve: dấu duyệt là HMAC, khóa sinh trong DATA_DIR (ngoài vùng log), bot-side kiểm khớp", () => {
    assert.equal(cli.chay(["add", "--thread", NHOM, "--text", "báo giá đây"]).status, 0);
    const id = cli.idDauTien();
    assert.equal(cli.docTin(id).trangThai, "cho_duyet");
    assert.equal(cli.docTin(id).banBam, undefined);

    const r = cli.chay(["approve", id]);
    assert.equal(r.status, 0, r.stderr);
    const t = cli.docTin(id);
    assert.equal(t.trangThai, "da_duyet");
    assert.ok(t.banBam?.startsWith(TIEN_TO_CHU_KY));
    assert.ok(fs.existsSync(duongDanKhoa(cli.duLieu)), "khóa nằm trong DATA_DIR");
    assert.equal(fs.existsSync(duongDanKhoa(cli.goc)), false);
    assert.equal(fs.existsSync(duongDanKhoa(path.join(cli.goc, "hop-thu-di"))), false);
    const khoa = docKhoa(cli.duLieu)!;
    assert.equal(kiemChuKy(t, khoa), true);
  });

  it("approve tin không ở cho_duyet: thoát lỗi, không đổi tin", () => {
    cli.chay(["add", "--thread", NHOM, "--text", "một"]);
    const id = cli.idDauTien();
    assert.equal(cli.chay(["approve", id]).status, 0);
    const truoc = fs.readFileSync(path.join(cli.hopThu, `${id}.json`), "utf8");
    const r = cli.chay(["approve", id]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /chỉ duyệt được cho_duyet/);
    assert.equal(fs.readFileSync(path.join(cli.hopThu, `${id}.json`), "utf8"), truoc);
  });

  it("--mention uid sai: thoát lỗi đúng thông báo, không tạo tin", () => {
    const r = cli.chay(["add", "--thread", NHOM, "--text", "xin chào", "--mention", "abc"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--mention sai: "abc"/);
    assert.deepEqual(cli.dsFile(), []);
  });

  it("--account không phải kebab-case (../x) bị từ chối", () => {
    const r = cli.chay(["list", "--account", "../x"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--account sai/);
  });
});

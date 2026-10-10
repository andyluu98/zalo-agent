import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

  it("--attach ngoài vùng cho phép / trong repo / .env: thoát lỗi, không tạo tin", () => {
    const ngoai = fs.mkdtempSync(path.join(os.tmpdir(), "outbox-cli-ngoai-"));
    const bi = path.join(ngoai, "bi-mat.txt");
    fs.writeFileSync(bi, "x");
    const r = cli.chay(["add", "--thread", NHOM, "--text", "kèm file", "--attach", bi]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Tệp đính kèm không hợp lệ: ngoài các thư mục được phép/);
    const repo = path.resolve(fileURLToPath(import.meta.url), "../../../package.json");
    const r2 = cli.chay(["add", "--thread", NHOM, "--text", "kèm file", "--attach", repo]);
    assert.equal(r2.status, 1);
    assert.match(r2.stderr, /thư mục bị chặn/);
    const env = path.join(cli.goc, ".env");
    fs.writeFileSync(env, "KHOA=1");
    const r3 = cli.chay(["add", "--thread", NHOM, "--text", "kèm file", "--attach", env]);
    assert.match(r3.stderr, /tệp nhạy cảm/);
    assert.deepEqual(cli.dsFile(), []);
    fs.rmSync(ngoai, { recursive: true, force: true });
  });

  it("--attach trong CHAT_EXPORT_DIR (mặc định cho phép) tạo tin; OUTBOX_ATTACH_ALLOWED_DIRS đổi vùng cho phép", () => {
    const f = path.join(cli.goc, "bao-gia.xlsx");
    fs.writeFileSync(f, "noi dung");
    assert.equal(cli.chay(["add", "--thread", NHOM, "--text", "ok", "--attach", f]).status, 0);
    assert.equal(cli.docTin(cli.idDauTien()).tepDinhKem?.length, 1);
    const hep = taoMoiTruongCli({ OUTBOX_ATTACH_ALLOWED_DIRS: path.join(os.tmpdir(), "khong-ton-tai-xyz") });
    try {
      const g = path.join(hep.goc, "a.txt");
      fs.writeFileSync(g, "x");
      const r = hep.chay(["add", "--thread", NHOM, "--text", "ok", "--attach", g]);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /ngoài các thư mục được phép/);
    } finally {
      hep.don();
    }
  });

  it("DATA_DIR và repo bị chặn cứng dù OUTBOX_ATTACH_ALLOWED_DIRS cho phép cả thư mục cha", () => {
    const rong = taoMoiTruongCli({ OUTBOX_ATTACH_ALLOWED_DIRS: os.tmpdir() });
    try {
      const khoa = path.join(rong.duLieu, "zalo-agent.db");
      fs.writeFileSync(khoa, "sqlite");
      const bThuong = path.join(rong.duLieu, "ghi-chu.txt");
      fs.writeFileSync(bThuong, "x");
      for (const f of [khoa, bThuong]) {
        const r = rong.chay(["add", "--thread", NHOM, "--text", "ok", "--attach", f]);
        assert.equal(r.status, 1, f);
        assert.match(r.stderr, /thư mục bị chặn|tệp nhạy cảm/);
      }
      assert.match(
        rong.chay(["add", "--thread", NHOM, "--text", "ok", "--attach", bThuong]).stderr,
        /thư mục bị chặn/,
        "tệp thường trong DATA_DIR bị chặn vì thư mục, không phải vì tên",
      );
      assert.deepEqual(rong.dsFile(), []);
    } finally {
      rong.don();
    }
  });

  it("approve từ chối tin có tệp ngoài vùng cho phép (kiểm lại lúc duyệt), chưa sinh khóa", () => {
    const f = path.join(cli.goc, "a.txt");
    fs.writeFileSync(f, "noi dung");
    cli.chay(["add", "--thread", NHOM, "--text", "ok", "--attach", f]);
    const id = cli.idDauTien();
    const tin = cli.docTin(id);
    const ngoai = path.join(fs.realpathSync.native(os.tmpdir()), `ngoai-${id}.txt`);
    fs.writeFileSync(ngoai, "noi dung");
    tin.tepDinhKem = [{ ...tin.tepDinhKem![0]!, duongDan: ngoai }];
    fs.writeFileSync(path.join(cli.hopThu, `${id}.json`), JSON.stringify(tin));
    const r = cli.chay(["approve", id]);
    fs.rmSync(ngoai, { force: true });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Không duyệt được: ngoài các thư mục được phép/);
    assert.equal(cli.docTin(id).trangThai, "cho_duyet");
    assert.equal(fs.existsSync(duongDanKhoa(cli.duLieu)), false);
  });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { cungDuongDan, kiemDuongDanTep, kiemTepTrongThuMuc, laTrongThuMuc, type QuyDinhTep } from "./outbox-path-guard.js";

/** Cây thư mục tạm: duocPhep/ (gốc cho phép), repo/ và data/ (chặn cứng), ngoai/ (không ai cho phép) */
let cay: { goc: string; duocPhep: string; repo: string; data: string; ngoai: string; q: QuyDinhTep };

function tao(dir: string, ten: string, nd = "noi dung"): string {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, ten);
  fs.writeFileSync(p, nd);
  return p;
}

beforeEach(() => {
  const goc = fs.mkdtempSync(path.join(os.tmpdir(), "outbox-guard-"));
  const d = (x: string) => path.join(goc, x);
  fs.mkdirSync(d("duoc-phep"));
  fs.mkdirSync(d("repo"));
  fs.mkdirSync(d("data"));
  fs.mkdirSync(d("ngoai"));
  cay = { goc, duocPhep: d("duoc-phep"), repo: d("repo"), data: d("data"), ngoai: d("ngoai"), q: { thuMucDuocPhep: [d("duoc-phep")], thuMucChan: [d("repo"), d("data")] } };
});
afterEach(() => fs.rmSync(cay.goc, { recursive: true, force: true }));

describe("A2 - tệp đính kèm chỉ trong thư mục cho phép", () => {
  it("tệp trong vùng cho phép được nhận, trả đường dẫn thật", () => {
    const f = tao(cay.duocPhep, "bao-gia.xlsx");
    assert.ok(cungDuongDan(kiemDuongDanTep(f, cay.q), f));
  });

  it("repo, data/*.db và .env bị từ chối; chặn cứng thắng cả khi nằm trong thư mục được phép", () => {
    assert.throws(() => kiemDuongDanTep(tao(cay.repo, "main.ts"), cay.q), /thư mục bị chặn/);
    assert.throws(() => kiemDuongDanTep(tao(cay.data, "zalo-agent.db"), cay.q), /thư mục bị chặn|nhạy cảm/);
    assert.throws(() => kiemDuongDanTep(tao(cay.duocPhep, ".env"), cay.q), /nhạy cảm/);
    assert.throws(() => kiemDuongDanTep(tao(cay.duocPhep, ".env.production"), cay.q), /nhạy cảm/);
    assert.throws(() => kiemDuongDanTep(tao(cay.duocPhep, "credentials.enc"), cay.q), /nhạy cảm/);
    const rong: QuyDinhTep = { thuMucDuocPhep: [cay.goc], thuMucChan: [cay.repo, cay.data] };
    assert.throws(() => kiemDuongDanTep(tao(cay.repo, "b.ts"), rong), /thư mục bị chặn/);
    assert.ok(kiemDuongDanTep(tao(cay.ngoai, "a.txt"), rong));
  });

  it("tệp ngoài mọi thư mục được phép bị từ chối; .. thoát ra ngoài bị chặn", () => {
    const f = tao(cay.ngoai, "bi-mat.txt");
    assert.throws(() => kiemDuongDanTep(f, cay.q), /ngoài các thư mục được phép/);
    const vong = path.join(cay.duocPhep, "..", "ngoai", "bi-mat.txt");
    assert.throws(() => kiemDuongDanTep(vong, cay.q), /ngoài các thư mục được phép/);
    assert.throws(() => kiemDuongDanTep("bi-mat.txt", cay.q), /tuyệt đối/);
    assert.throws(() => kiemDuongDanTep(path.join(cay.duocPhep, "khong-co.txt"), cay.q), /không thấy tệp/);
  });

  it("junction trong vùng cho phép trỏ ra ngoài bị chặn (giải đường dẫn thật)", () => {
    tao(cay.ngoai, "bi-mat.txt");
    const noi = path.join(cay.duocPhep, "loi-tat");
    fs.symlinkSync(cay.ngoai, noi, "junction");
    assert.throws(() => kiemDuongDanTep(path.join(noi, "bi-mat.txt"), cay.q), /ngoài các thư mục được phép/);
    // junction trỏ vào repo cũng bị chặn cứng
    tao(cay.repo, "ma-nguon.ts");
    const noiRepo = path.join(cay.duocPhep, "vao-repo");
    fs.symlinkSync(cay.repo, noiRepo, "junction");
    assert.throws(() => kiemDuongDanTep(path.join(noiRepo, "ma-nguon.ts"), cay.q), /thư mục bị chặn/);
  });

  it("symlink tệp trỏ ra ngoài bị chặn (bỏ qua nếu máy không cho tạo symlink)", (t) => {
    const dich = tao(cay.ngoai, "bi-mat.txt");
    const lk = path.join(cay.duocPhep, "lk.txt");
    try {
      fs.symlinkSync(dich, lk, "file");
    } catch {
      t.skip("không tạo được symlink trên máy này (cần quyền)");
      return;
    }
    assert.throws(() => kiemDuongDanTep(lk, cay.q), /ngoài các thư mục được phép/);
  });

  it("hoa/thường ổ đĩa và UNC", { skip: process.platform !== "win32" }, () => {
    const f = tao(cay.duocPhep, "a.txt");
    assert.ok(kiemDuongDanTep(f.toUpperCase(), cay.q));
    assert.equal(laTrongThuMuc("C:\\Du\\Lieu\\a.txt", "c:\\du\\lieu"), true);
    assert.equal(laTrongThuMuc("D:\\Du\\Lieu\\a.txt", "c:\\du\\lieu"), false);
    assert.equal(laTrongThuMuc("\\\\srv\\chia-se\\a.txt", "C:\\du\\lieu"), false);
    assert.equal(laTrongThuMuc("C:\\du\\lieu-khac\\a.txt", "C:\\du\\lieu"), false);
  });

  it("tên có dấu tiếng Việt, khoảng trắng, ngoặc và tên dài đều nhận", () => {
    const co = tao(cay.duocPhep, "Báo giá tháng 10 (bản cuối) đã chỉnh.xlsx");
    const dai = tao(cay.duocPhep, `${"d".repeat(150)}.pdf`);
    assert.ok(kiemDuongDanTep(co, cay.q));
    assert.ok(kiemDuongDanTep(dai, cay.q));
  });
});

describe("kiemTepTrongThuMuc (tool send_file của agent)", () => {
  it("tệp trong kho được nhận; tệp nhạy cảm và junction trỏ ra ngoài kho bị từ chối", () => {
    const kho = path.join(cay.goc, "shared-files");
    const f = tao(kho, "bao-gia.pdf");
    assert.ok(cungDuongDan(kiemTepTrongThuMuc(f, kho), f));
    assert.throws(() => kiemTepTrongThuMuc(tao(kho, ".env"), kho), /ngoài kho/);
    tao(cay.ngoai, "bi-mat.txt");
    fs.symlinkSync(cay.ngoai, path.join(kho, "loi-tat"), "junction");
    assert.throws(() => kiemTepTrongThuMuc(path.join(kho, "loi-tat", "bi-mat.txt"), kho), /ngoài kho/);
  });
});

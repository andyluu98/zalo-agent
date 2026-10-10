import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { chonDuoiAnToan, ghiDauTaiTuInternet, laHostCdnZalo } from "./attachment-safety.js";
import { HanMucTaiTep } from "./attachment-quota.js";

describe("laHostCdnZalo", () => {
  it("nhận host CDN thật lấy từ log (zdn.vn, dlfl.vn, dlmd.me)", () => {
    for (const u of [
      "https://photo-stal-13.zdn.vn/no/bb88/2HGb.jpg",
      "https://f64-zpg-r.zdn.vn/a.jpg",
      "https://f2-voice-aac-dl.zdn.vn/x",
      "https://file-stal-13.dlfl.vn/no/9c6b/2aOb",
      "https://ot146.dlfl.vn/no/1",
      "https://video-stal-10.dlmd.me/no/1",
      "https://PHOTO-STAL-1.ZDN.VN/a.jpg",
    ]) {
      assert.equal(laHostCdnZalo(u), true, u);
    }
  });

  it("từ chối host lạ và mọi mẹo giả tên miền", () => {
    for (const u of [
      "https://evil.example/hoa-don.hta",
      "https://zdn.vn.evil.example/a.jpg",
      "https://evilzdn.vn/a.jpg",
      "https://zdn.vn/a.jpg", // không có tiền tố con
      "https://photo.zdn.vn.evil.example/a.jpg",
      "https://a.zdn.vn@evil.example/a.jpg", // userinfo: host thật là evil.example
      "https://user:pw@a.zdn.vn/a.jpg",
      "https://a.zdn.vn:8443/a.jpg",
      "http://a.zdn.vn/a.jpg",
      "https://a.zdn.vn./a.jpg",
      "https://127.0.0.1/a.jpg",
      "file:///c:/a.jpg",
      "khong-phai-url",
      "",
    ]) {
      assert.equal(laHostCdnZalo(u), false, u);
    }
  });
});

describe("chonDuoiAnToan", () => {
  it("đuôi an toàn thì giữ (không phân biệt hoa thường)", () => {
    assert.equal(chonDuoiAnToan("Bao gia.XLSX", "application/octet-stream", "https://a.zdn.vn/x"), ".xlsx");
    assert.equal(chonDuoiAnToan("a.mp4", "", "https://a.zdn.vn/x"), ".mp4");
    assert.equal(chonDuoiAnToan("a.amr", "", "https://a.zdn.vn/x"), ".amr");
  });

  it("đuôi nguy hiểm đổi thành .bin, KỂ CẢ khi MIME khai là ảnh", () => {
    for (const ten of ["hoa-don.hta", "a.bat", "a.lnk", "a.html", "a.htm", "a.svg", "a.exe", "a.ps1", "a.js", "a.vbs", "a.docm", "a.xlsm", "a.scr", "a.cmd", "a.jar", "a.msi"]) {
      assert.equal(chonDuoiAnToan(ten, "image/jpeg", "https://a.zdn.vn/x.jpg"), ".bin", ten);
    }
  });

  it("không có đuôi trong tên thì theo MIME, rồi theo URL, còn lại .bin", () => {
    assert.equal(chonDuoiAnToan("anh_m1", "image/jpeg; charset=x", "https://a.zdn.vn/abc"), ".jpg");
    assert.equal(chonDuoiAnToan("anh_m1", "application/octet-stream", "https://a.zdn.vn/abc.png"), ".png");
    assert.equal(chonDuoiAnToan("anh_m1", "application/octet-stream", "https://a.zdn.vn/abc.hta"), ".bin");
    assert.equal(chonDuoiAnToan("anh_m1", "text/html", "https://a.zdn.vn/abc"), ".bin");
  });
});

describe("ghiDauTaiTuInternet", () => {
  it("Windows: ghi Zone.Identifier ZoneId=3; nền khác: bỏ qua, không ném", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zone-"));
    const f = path.join(dir, "a.pdf");
    fs.writeFileSync(f, "x");
    const ok = ghiDauTaiTuInternet(f);
    if (process.platform === "win32") {
      assert.equal(ok, true);
      assert.equal(fs.readFileSync(`${f}:Zone.Identifier`, "utf8"), "[ZoneTransfer]\r\nZoneId=3\r\n");
    } else {
      assert.equal(ok, false);
    }
  });

  it("đường dẫn không ghi được thì trả false, không ném", () => {
    assert.equal(ghiDauTaiTuInternet(path.join(os.tmpdir(), "khong-co-thu-muc-nay-zz", "a.pdf")), false);
  });
});

describe("HanMucTaiTep", () => {
  it("vượt hạn mức tài khoản hoặc người gửi thì có lý do; người khác vẫn tải được", () => {
    const q = new HanMucTaiTep(10, 4);
    const MB = 1024 * 1024;
    assert.equal(q.kiem("2026-10-10", "a", "u1"), null);
    q.ghi("2026-10-10", "a", "u1", 4 * MB);
    assert.match(q.kiem("2026-10-10", "a", "u1") ?? "", /người gửi/);
    assert.equal(q.kiem("2026-10-10", "a", "u2"), null);
    q.ghi("2026-10-10", "a", "u2", 3 * MB);
    q.ghi("2026-10-10", "a", "u3", 3 * MB);
    assert.match(q.kiem("2026-10-10", "a", "u4") ?? "", /tài khoản/);
    assert.equal(q.kiem("2026-10-10", "b", "u4"), null, "tài khoản khác độc lập");
  });

  it("sang ngày mới thì đếm lại; 0 = không giới hạn", () => {
    const q = new HanMucTaiTep(1, 1);
    q.ghi("2026-10-10", "a", "u", 5 * 1024 * 1024);
    assert.notEqual(q.kiem("2026-10-10", "a", "u"), null);
    assert.equal(q.kiem("2026-10-11", "a", "u"), null);
    const khongGioiHan = new HanMucTaiTep(0, 0);
    khongGioiHan.ghi("d", "a", "u", 1e12);
    assert.equal(khongGioiHan.kiem("d", "a", "u"), null);
  });
});

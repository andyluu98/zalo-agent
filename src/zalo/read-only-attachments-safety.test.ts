import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { taiTep } from "./read-only-attachments.js";

const CDN = "https://file-stal-1.dlfl.vn/f";
const taiGia = (mediaType: string, kichThuoc = 4) => async () => ({
  data: Buffer.alloc(kichThuoc, 1),
  mediaType,
  fileName: "x",
});
const thuMucTam = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "tep-"));

describe("taiTep: an toàn (B2)", () => {
  it("host ngoài CDN Zalo KHÔNG được tải (không gọi bộ tải, không lộ IP), ghi lỗi", async () => {
    const ngay = thuMucTam();
    let goi = 0;
    const kq = await taiTep(
      ngay,
      "10:00",
      [
        { loai: "video", url: "https://evil.example/hoa-don.hta", ten: "hoa-don.hta" },
        { loai: "file", url: "http://file-stal-1.dlfl.vn/f", ten: "a.pdf" },
      ],
      {
        maxBytes: 100,
        tai: async () => {
          goi++;
          return { data: Buffer.alloc(4), mediaType: "video/mp4", fileName: "x" };
        },
      },
    );
    assert.equal(goi, 0);
    assert.equal(kq.length, 2);
    for (const k of kq) assert.match(k.loi ?? "", /CDN Zalo/);
    assert.equal(fs.existsSync(path.join(ngay, "tep")), false);
  });

  it("tên .hta/.bat/.lnk/.html/.svg lưu thành .bin (kể cả MIME khai là ảnh)", async () => {
    const ngay = thuMucTam();
    for (const ten of ["hoa-don.hta", "a.bat", "b.lnk", "c.html", "d.svg"]) {
      const kq = await taiTep(ngay, "10:00", [{ loai: "file", url: CDN, ten }], { maxBytes: 100, tai: taiGia("image/jpeg") });
      assert.match(kq[0]?.duongDan ?? "", /\.bin$/, ten);
    }
    const kq = await taiTep(ngay, "10:00", [{ loai: "file", url: CDN, ten: "bao-cao.pdf" }], {
      maxBytes: 100,
      tai: taiGia("application/pdf"),
    });
    assert.match(kq[0]?.duongDan ?? "", /\.pdf$/);
    assert.deepEqual(fs.readdirSync(path.join(ngay, "tep")).filter((f) => /\.(hta|bat|lnk|html|svg)$/.test(f)), []);
  });

  it("Windows: tệp đã lưu có Zone.Identifier ZoneId=3", { skip: process.platform !== "win32" }, async () => {
    const ngay = thuMucTam();
    const kq = await taiTep(ngay, "10:00", [{ loai: "file", url: CDN, ten: "a.pdf" }], {
      maxBytes: 100,
      tai: taiGia("application/pdf"),
    });
    const f = path.join(ngay, kq[0]!.duongDan!);
    assert.match(fs.readFileSync(`${f}:Zone.Identifier`, "utf8"), /ZoneId=3/);
  });
});

describe("taiTep: hạn tổng và hạn mức (B3)", () => {
  it("nguồn nhỏ giọt bị cắt theo hạn tổng: signal bị hủy, tệp sau vẫn được tải", async () => {
    const ngay = thuMucTam();
    let signalDaHuy = false;
    let lan = 0;
    const t0 = Date.now();
    const kq = await taiTep(
      ngay,
      "10:00",
      [
        { loai: "file", url: CDN, ten: "treo.pdf" },
        { loai: "file", url: CDN, ten: "ok.pdf" },
      ],
      {
        maxBytes: 100,
        hanTongMs: 60,
        tai: (_url, o) => {
          if (++lan === 2) return Promise.resolve({ data: Buffer.alloc(4, 1), mediaType: "application/pdf", fileName: "x" });
          return new Promise((_, reject) => {
            o.signal.addEventListener("abort", () => {
              signalDaHuy = true;
              reject(new Error("bị hủy"));
            });
          });
        },
      },
    );
    assert.ok(Date.now() - t0 < 3000);
    assert.equal(signalDaHuy, true);
    assert.match(kq[0]?.loi ?? "", /quá hạn|hủy/);
    assert.match(kq[1]?.duongDan ?? "", /ok\.pdf$/);
  });

  it("bộ tải lờ signal (treo vĩnh viễn) vẫn bị cắt đúng hạn, không treo vòng lặp", async () => {
    const kq = await taiTep(thuMucTam(), "10:00", [{ loai: "file", url: CDN, ten: "treo.pdf" }], {
      maxBytes: 100,
      hanTongMs: 50,
      tai: () => new Promise(() => {}),
    });
    assert.match(kq[0]?.loi ?? "", /quá hạn tải/);
  });

  it("hết hạn mức thì KHÔNG tải, ghi lý do; tải xong thì báo số byte về sổ hạn mức", async () => {
    const ngay = thuMucTam();
    let goi = 0;
    const tai = async () => {
      goi++;
      return { data: Buffer.alloc(7, 1), mediaType: "application/pdf", fileName: "x" };
    };
    const daGhi: number[] = [];
    const ds = [{ loai: "file" as const, url: CDN, ten: "a.pdf" }];
    const het = await taiTep(ngay, "10:00", ds, {
      maxBytes: 100,
      tai,
      hanMuc: { kiem: () => "hết hạn mức 1 MB/ngày của người gửi", ghi: (b) => void daGhi.push(b) },
    });
    assert.equal(goi, 0);
    assert.match(het[0]?.loi ?? "", /hết hạn mức/);
    const con = await taiTep(ngay, "10:00", ds, {
      maxBytes: 100,
      tai,
      hanMuc: { kiem: () => null, ghi: (b) => void daGhi.push(b) },
    });
    assert.equal(goi, 1);
    assert.ok(con[0]?.duongDan);
    assert.deepEqual(daGhi, [7]);
  });
});

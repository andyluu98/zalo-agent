import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { xepHangTheoKhoa } from "../shared/xep-hang-theo-khoa.js";
import { BoGhiLogNgay, type DongLogTin } from "./daily-chat-export.js";

function taoThuMuc(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "zalo-export-"));
}

function dong(over: Partial<DongLogTin> = {}): DongLogTin {
  return {
    accountId: "acc",
    threadId: "g123",
    tenThread: "Nhóm Kinh Doanh",
    laNhom: true,
    sentAt: "2026-10-05T02:15:00.000Z",
    senderId: "u1",
    senderName: "Anh B",
    laToi: false,
    msgId: "m1",
    cliMsgId: "c1",
    loaiTin: "chu",
    noiDung: "Gửi báo giá cho khách A trước 17h nhé",
    anh: [],
    ...over,
  };
}

describe("BoGhiLogNgay", () => {
  it("ghi .md theo ngày giờ VN + .jsonl, tạo file hướng dẫn", () => {
    const goc = taoThuMuc();
    const bo = new BoGhiLogNgay(goc, () => "Asia/Ho_Chi_Minh");
    bo.damBaoHuongDan();
    bo.ghiTin(dong());

    assert.ok(fs.existsSync(path.join(goc, "CLAUDE.md")));
    assert.ok(fs.existsSync(path.join(goc, "AGENTS.md")));
    const md = fs.readFileSync(path.join(goc, "acc", "2026-10-05", "nhom-kinh-doanh_g123.md"), "utf8");
    assert.match(md, /^# Nhóm Kinh Doanh \(Nhóm\) - 2026-10-05/);
    assert.match(md, /- 09:15 \*\*Anh B\*\*: Gửi báo giá cho khách A trước 17h nhé/);
    const json = JSON.parse(fs.readFileSync(path.join(goc, "acc", "2026-10-05", "tin-nhan.jsonl"), "utf8").trim());
    assert.equal(json.gio, "09:15");
    assert.equal(json.msgId, "m1");
  });

  it("tin 23h UTC hôm trước rơi vào file ngày hôm sau theo giờ VN", () => {
    const goc = taoThuMuc();
    new BoGhiLogNgay(goc, () => "Asia/Ho_Chi_Minh").ghiTin(dong({ sentAt: "2026-10-04T23:30:00.000Z" }));
    assert.ok(fs.existsSync(path.join(goc, "acc", "2026-10-05")));
  });

  it("đổi tên nhóm giữa ngày / khởi động lại vẫn ghi chung một file", () => {
    const goc = taoThuMuc();
    new BoGhiLogNgay(goc, () => "Asia/Ho_Chi_Minh").ghiTin(dong());
    new BoGhiLogNgay(goc, () => "Asia/Ho_Chi_Minh").ghiTin(dong({ tenThread: "Tên Mới", msgId: "m2" }));
    const files = fs.readdirSync(path.join(goc, "acc", "2026-10-05")).filter((f) => f.endsWith(".md"));
    assert.deepEqual(files, ["nhom-kinh-doanh_g123.md"]);
  });

  it("tin tự gửi, trích dẫn, đính kèm, nhiều dòng và thu hồi", () => {
    const goc = taoThuMuc();
    const bo = new BoGhiLogNgay(goc, () => "Asia/Ho_Chi_Minh");
    bo.ghiTin(
      dong({
        laToi: true,
        senderName: "Andy",
        noiDung: "ok anh\nchiều em gửi",
        trichDan: { nguoiGui: "Anh B", noiDung: "Gửi báo giá" },
        dinhKem: { ten: "bao-gia.xlsx", url: "https://f/x" },
        loaiTin: "file",
      }),
    );
    bo.ghiThuHoi({
      accountId: "acc",
      threadId: "g123",
      tenThread: "",
      laNhom: true,
      sentAt: "2026-10-05T02:20:00.000Z",
      senderName: "Andy",
      laToi: true,
      msgIdGoc: "m1",
    });
    const md = fs.readFileSync(path.join(goc, "acc", "2026-10-05", "nhom-kinh-doanh_g123.md"), "utf8");
    assert.match(md, /\*\*Tôi \(Andy\)\*\*: ok anh\n  chiều em gửi/);
    assert.match(md, /  > Trả lời \*\*Anh B\*\*: Gửi báo giá/);
    assert.match(md, /  - Đính kèm \(file\): \[bao-gia.xlsx\]\(https:\/\/f\/x\)/);
    assert.match(md, /- 09:20 \*\*Tôi \(Andy\)\*\* đã thu hồi một tin \(tin lúc 09:15: "ok anh chiều em gửi"\)/);
  });

  it("không ghi đè file hướng dẫn người dùng đã sửa", () => {
    const goc = taoThuMuc();
    fs.writeFileSync(path.join(goc, "CLAUDE.md"), "của tôi");
    new BoGhiLogNgay(goc, () => "UTC").damBaoHuongDan();
    assert.equal(fs.readFileSync(path.join(goc, "CLAUDE.md"), "utf8"), "của tôi");
  });
});

describe("xepHangTheoKhoa", () => {
  it("chạy nối tiếp theo khóa, lỗi một việc không chặn việc sau", async () => {
    const thuTu: number[] = [];
    const a = xepHangTheoKhoa("k", async () => {
      await new Promise((r) => setTimeout(r, 20));
      thuTu.push(1);
    });
    const b = xepHangTheoKhoa("k", () => {
      throw new Error("hỏng");
    });
    const c = xepHangTheoKhoa("k", () => {
      thuTu.push(3);
    });
    await a;
    await assert.rejects(b);
    await c;
    assert.deepEqual(thuTu, [1, 3]);
  });
});

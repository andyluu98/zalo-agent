import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { ThreadType } from "zca-js";
import { danhSachTepCanTai, taiTep } from "./read-only-attachments.js";
import type { ParsedMessage } from "./zalo-message-parser.js";

const tin = (over: Partial<ParsedMessage>): ParsedMessage => ({
  accountId: "acc",
  threadId: "t",
  threadType: ThreadType.User,
  isGroup: false,
  senderId: "u",
  senderName: "A",
  text: "",
  images: [],
  msgId: "m1",
  cliMsgId: "c1",
  isSelf: false,
  mentionsMe: false,
  sentAt: "2026-10-07T04:00:00Z",
  rawData: {},
  ...over,
});

const taiGia = (mediaType: string, kichThuoc = 4) => async () => ({
  data: Buffer.alloc(kichThuoc, 1),
  mediaType,
  fileName: "x",
});

describe("danhSachTepCanTai", () => {
  it("ảnh + file/video/thoại thì tải; liên kết web thì không", () => {
    assert.deepEqual(
      danhSachTepCanTai(tin({ images: [{ url: "https://z/a.jpg" }, { url: "https://z/b.jpg" }] })).map((t) => t.ten),
      ["anh_m1-1", "anh_m1-2"],
    );
    assert.equal(danhSachTepCanTai(tin({ loaiTin: "file", dinhKem: { ten: "Báo giá.xlsx", url: "https://file-stal-1.dlfl.vn/f" } }))[0]?.loai, "file");
    assert.deepEqual(danhSachTepCanTai(tin({ loaiTin: "lien_ket", dinhKem: { ten: "bài báo", url: "https://vnexpress.net" } })), []);
  });
});

describe("taiTep", () => {
  it("lưu vào <ngày>/tep/HHmm_ten, giữ đuôi gốc, bỏ dấu tên; trùng tên thêm -2", async () => {
    const ngay = fs.mkdtempSync(path.join(os.tmpdir(), "tep-"));
    const ds = [{ loai: "file" as const, url: "https://file-stal-1.dlfl.vn/f", ten: "Báo giá Khách A.xlsx" }];
    const a = await taiTep(ngay, "11:30", ds, { maxBytes: 100, tai: taiGia("application/octet-stream") });
    const b = await taiTep(ngay, "11:30", ds, { maxBytes: 100, tai: taiGia("application/octet-stream") });
    assert.equal(a[0]?.duongDan, "tep/1130_bao-gia-khach-a.xlsx");
    assert.equal(b[0]?.duongDan, "tep/1130_bao-gia-khach-a-2.xlsx");
    assert.equal(fs.readFileSync(path.join(ngay, "tep", "1130_bao-gia-khach-a.xlsx")).length, 4);
  });

  it("ảnh không có đuôi thì lấy đuôi theo mediaType", async () => {
    const ngay = fs.mkdtempSync(path.join(os.tmpdir(), "tep-"));
    const kq = await taiTep(ngay, "09:05", [{ loai: "anh", url: "https://photo-stal-1.zdn.vn/abc", ten: "anh_m9" }], {
      maxBytes: 100,
      tai: taiGia("image/jpeg"),
    });
    assert.equal(kq[0]?.duongDan, "tep/0905_anh-m9.jpg");
  });

  it("tải hỏng (vd quá cỡ) thì trả lỗi, không ném, không tạo file", async () => {
    const ngay = fs.mkdtempSync(path.join(os.tmpdir(), "tep-"));
    const kq = await taiTep(ngay, "10:00", [{ loai: "video", url: "https://video-stal-1.dlmd.me/v", ten: "video_m1" }], {
      maxBytes: 100,
      tai: async () => {
        throw new Error("vượt quá 100 byte");
      },
    });
    assert.equal(kq[0]?.duongDan, undefined);
    assert.match(kq[0]?.loi ?? "", /vượt quá/);
    assert.equal(fs.existsSync(path.join(ngay, "tep")), false);
  });

  it("maxBytes = 0 nghĩa là tắt tải tệp", async () => {
    const kq = await taiTep("/khong-dung", "10:00", [{ loai: "anh", url: "https://photo-stal-1.zdn.vn/a", ten: "a" }], {
      maxBytes: 0,
      tai: taiGia("image/png"),
    });
    assert.deepEqual(kq, []);
  });
});

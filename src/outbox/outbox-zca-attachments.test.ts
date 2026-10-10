import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { kichThuocWebp, sangNguonZca } from "./outbox-zca-attachments.js";

function png(w: number, h: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}
function webpVp8x(w: number, h: number): Buffer {
  const b = Buffer.alloc(30);
  b.write("RIFF", 0, "ascii");
  b.write("WEBP", 8, "ascii");
  b.write("VP8X", 12, "ascii");
  b.writeUIntLE(w - 1, 24, 3);
  b.writeUIntLE(h - 1, 27, 3);
  return b;
}

describe("sangNguonZca - Buffer đã băm sang nguồn zca-js", () => {
  it("tệp thường: data + filename + totalSize, không width/height", () => {
    const data = Buffer.from("abc");
    const [nguon] = sangNguonZca([{ duongDan: "C:\\x\\Báo giá.xlsx", filename: "Báo giá.xlsx", data }]);
    assert.deepEqual(nguon, { data, filename: "Báo giá.xlsx", metadata: { totalSize: 3 } });
  });

  it("ảnh png / webp có width, height; ảnh đo không ra kích thước thì ném lỗi (chưa gửi gì)", () => {
    const [p] = sangNguonZca([{ duongDan: "C:\\a.png", filename: "a.png", data: png(640, 480) }]);
    assert.deepEqual((p as { metadata: unknown }).metadata, { totalSize: 33, width: 640, height: 480 });
    assert.deepEqual(kichThuocWebp(webpVp8x(1024, 768)), { width: 1024, height: 768 });
    const [w] = sangNguonZca([{ duongDan: "C:\\a.webp", filename: "a.webp", data: webpVp8x(100, 50) }]);
    assert.deepEqual((w as { metadata: unknown }).metadata, { totalSize: 30, width: 100, height: 50 });
    assert.throws(() => sangNguonZca([{ duongDan: "C:\\a.png", filename: "a.png", data: Buffer.from("khong phai anh") }]), /không đọc được kích thước ảnh/);
    assert.throws(() => sangNguonZca([{ duongDan: "C:\\README", filename: "README", data: Buffer.from("x") }]), /không có đuôi/);
  });
});

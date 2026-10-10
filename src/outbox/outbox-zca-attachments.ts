import path from "node:path";
import type { AttachmentSource } from "zca-js";
import { readImageSize } from "../zalo/zalo-image-variant.js";
import type { TepGui } from "./outbox-file-store.js";

/**
 * Đổi tệp đã nạp-và-băm (Buffer) sang dạng zca-js nhận: `{data, filename, metadata}`.
 * zca-js KHÔNG đọc lại đường dẫn nên đổi tệp trên đĩa lúc gửi không còn tác dụng.
 * Ảnh jpg/jpeg/png/webp bắt buộc có width/height trong metadata (zca-js không tự đo
 * với Buffer); đo không ra thì ném lỗi - tin chuyển `loi`, chưa gửi gì.
 */

const DUOI_ANH = new Set(["jpg", "jpeg", "png", "webp"]);

/** Kích thước WebP (VP8 / VP8L / VP8X) từ vài byte đầu */
export function kichThuocWebp(b: Buffer): { width: number; height: number } | null {
  if (b.length < 30 || b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WEBP") return null;
  const loai = b.toString("ascii", 12, 16);
  if (loai === "VP8X") return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  if (loai === "VP8L") {
    const bit = b.readUInt32LE(21);
    return { width: 1 + (bit & 0x3fff), height: 1 + ((bit >> 14) & 0x3fff) };
  }
  if (loai === "VP8 ") return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  return null;
}

export function sangNguonZca(tep: TepGui[]): AttachmentSource[] {
  return tep.map((t) => {
    const duoi = path.extname(t.filename).slice(1).toLowerCase();
    if (!duoi) throw new Error(`tệp không có đuôi, zca-js không gửi được: ${t.filename}`);
    const metadata: { totalSize: number; width?: number; height?: number } = { totalSize: t.data.length };
    if (DUOI_ANH.has(duoi)) {
      const kt = duoi === "webp" ? kichThuocWebp(t.data) : readImageSize(t.data);
      if (!kt || kt.width <= 0 || kt.height <= 0) throw new Error(`không đọc được kích thước ảnh: ${t.filename}`);
      metadata.width = kt.width;
      metadata.height = kt.height;
    }
    return { data: t.data, filename: t.filename as `${string}.${string}`, metadata };
  });
}

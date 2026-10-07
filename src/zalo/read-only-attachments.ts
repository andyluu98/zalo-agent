import fs from "node:fs";
import path from "node:path";
import { taoSlug } from "../conversation/log-text-utils.js";
import { downloadFromPublicUrl, type RemoteFile } from "../shared/safe-remote-download.js";
import type { ParsedMessage } from "./zalo-message-parser.js";

/**
 * Tải tệp đính kèm (ảnh, file, video, tin thoại) của tin chỉ đọc về thư mục
 * ngày: `<thuMucNgay>/tep/<HHmm>_<ten>`. Link Zalo hết hạn sau một thời gian,
 * bản trên máy thì không - và AI đọc log mở được thẳng nội dung file.
 *
 * Liên kết web (`lien_ket`) KHÔNG tải: đó là trang web, không phải tệp.
 * Hỏng (quá cỡ, mạng, link chết) thì trả lỗi để dòng log ghi rõ, không ném.
 */

export type LoaiTep = "anh" | "file" | "video" | "thoai";
export type TepCanTai = { loai: LoaiTep; url: string; ten: string };
export type TepDaLuu = { loai: LoaiTep; ten: string; duongDan?: string; loi?: string };

const DUOI_THEO_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "audio/mp4": ".m4a",
  "audio/aac": ".aac",
  "audio/mpeg": ".mp3",
  "audio/amr": ".amr",
};

export function danhSachTepCanTai(msg: ParsedMessage): TepCanTai[] {
  const ds: TepCanTai[] = msg.images.map((img, i) => ({
    loai: "anh",
    url: img.url,
    ten: `anh_${msg.msgId || "x"}${msg.images.length > 1 ? `-${i + 1}` : ""}`,
  }));
  const dk = msg.dinhKem;
  if (dk?.url && (msg.loaiTin === "file" || msg.loaiTin === "video" || msg.loaiTin === "thoai")) {
    ds.push({ loai: msg.loaiTin, url: dk.url, ten: dk.ten || `${msg.loaiTin}_${msg.msgId || "x"}` });
  }
  return ds;
}

export async function taiTep(
  thuMucNgay: string,
  gio: string,
  ds: TepCanTai[],
  opts: { maxBytes: number; tai?: (url: string, o: { maxBytes: number; timeoutMs: number }) => Promise<RemoteFile> },
): Promise<TepDaLuu[]> {
  if (ds.length === 0 || opts.maxBytes <= 0) return [];
  const tai = opts.tai ?? downloadFromPublicUrl;
  const thuMucTep = path.join(thuMucNgay, "tep");
  const ketQua: TepDaLuu[] = [];
  for (const t of ds) {
    try {
      const file = await tai(t.url, { maxBytes: opts.maxBytes, timeoutMs: 120_000 });
      fs.mkdirSync(thuMucTep, { recursive: true });
      const ten = tenTrong(thuMucTep, `${gio.replace(":", "")}_${tenFileAnToan(t.ten, file.mediaType, t.url)}`);
      fs.writeFileSync(path.join(thuMucTep, ten), file.data);
      ketQua.push({ loai: t.loai, ten: t.ten, duongDan: `tep/${ten}` });
    } catch (err) {
      ketQua.push({ loai: t.loai, ten: t.ten, loi: err instanceof Error ? err.message.slice(0, 120) : String(err) });
    }
  }
  return ketQua;
}

/** Giữ đuôi file gốc; tên thì bỏ dấu + ký tự lạ để mở được trên mọi máy */
function tenFileAnToan(ten: string, mediaType: string, url: string): string {
  const goc = path.parse(ten);
  const duoiGoc = /^\.[A-Za-z0-9]{1,8}$/.test(goc.ext) ? goc.ext.toLowerCase() : "";
  const duoiUrl = path.extname(new URL(url).pathname).toLowerCase();
  const duoi =
    duoiGoc || DUOI_THEO_MIME[mediaType.split(";")[0]!.trim()] || (/^\.[a-z0-9]{1,5}$/.test(duoiUrl) ? duoiUrl : ".bin");
  const than = (duoiGoc ? taoSlug(goc.name) : taoSlug(ten)) || "tep";
  return `${than}${duoi}`;
}

/** Trùng tên trong thư mục thì thêm -2, -3... thay vì ghi đè */
function tenTrong(dir: string, ten: string): string {
  if (!fs.existsSync(path.join(dir, ten))) return ten;
  const { name, ext } = path.parse(ten);
  for (let i = 2; ; i++) {
    const thu = `${name}-${i}${ext}`;
    if (!fs.existsSync(path.join(dir, thu))) return thu;
  }
}

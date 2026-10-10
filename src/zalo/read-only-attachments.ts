import fs from "node:fs";
import path from "node:path";
import { taoSlug } from "../conversation/log-text-utils.js";
import { downloadFromPublicUrl, type RemoteFile } from "../shared/safe-remote-download.js";
import { chonDuoiAnToan, ghiDauTaiTuInternet, laHostCdnZalo } from "./attachment-safety.js";
import type { ParsedMessage } from "./zalo-message-parser.js";

/**
 * Tải tệp đính kèm (ảnh, file, video, tin thoại) của tin chỉ đọc về thư mục
 * ngày: `<thuMucNgay>/tep/<HHmm>_<ten>`. Link Zalo hết hạn sau một thời gian,
 * bản trên máy thì không - và AI đọc log mở được thẳng nội dung file.
 *
 * Liên kết web (`lien_ket`) KHÔNG tải: đó là trang web, không phải tệp.
 * Hỏng (quá cỡ, mạng, link chết, host lạ, hết hạn mức) thì trả lỗi để dòng log
 * ghi rõ, không ném. Luật an toàn tệp (host CDN, đuôi, Zone.Identifier) nằm ở
 * `attachment-safety.ts`.
 */

export type LoaiTep = "anh" | "file" | "video" | "thoai";
export type TepCanTai = { loai: LoaiTep; url: string; ten: string };
export type TepDaLuu = { loai: LoaiTep; ten: string; duongDan?: string; loi?: string; dangTai?: boolean };

export function danhSachTepCanTai(msg: ParsedMessage): TepCanTai[] {
  return tepCanTaiTuDong({
    msgId: msg.msgId,
    anh: msg.images.map((i) => i.url),
    loaiTin: msg.loaiTin,
    dinhKem: msg.dinhKem,
  });
}

/** Cùng luật, đọc từ một dòng log (jsonl) - script dựng lại log dùng để tải bù tệp */
export function tepCanTaiTuDong(d: {
  msgId: string;
  anh: string[];
  loaiTin?: string;
  dinhKem?: { ten: string; url: string };
}): TepCanTai[] {
  const ds: TepCanTai[] = d.anh.map((url, i) => ({
    loai: "anh",
    url,
    ten: `anh_${d.msgId || "x"}${d.anh.length > 1 ? `-${i + 1}` : ""}`,
  }));
  const dk = d.dinhKem;
  if (dk?.url && (d.loaiTin === "file" || d.loaiTin === "video" || d.loaiTin === "thoai")) {
    ds.push({ loai: d.loaiTin, url: dk.url, ten: dk.ten || `${d.loaiTin}_${d.msgId || "x"}` });
  }
  return ds;
}

/** Hạn tổng cho MỘT tệp. Idle-timeout của bộ tải không cắt được nguồn nhỏ giọt từng byte */
export const HAN_TONG_TAI_TEP_MS = 180_000;

export type TuyChonTaiTep = {
  maxBytes: number;
  /** Hạn tổng mỗi tệp (mili giây) */
  hanTongMs?: number;
  /** Hạn mức ngày: kiem() trả lý do thì BỎ tải; ghi() nhận số byte đã tải xong */
  hanMuc?: { kiem: () => string | null; ghi: (bytes: number) => void };
  tai?: (url: string, o: { maxBytes: number; timeoutMs: number; signal: AbortSignal }) => Promise<RemoteFile>;
};

export async function taiTep(thuMucNgay: string, gio: string, ds: TepCanTai[], opts: TuyChonTaiTep): Promise<TepDaLuu[]> {
  if (ds.length === 0 || opts.maxBytes <= 0) return [];
  const tai = opts.tai ?? downloadFromPublicUrl;
  const thuMucTep = path.join(thuMucNgay, "tep");
  const ketQua: TepDaLuu[] = [];
  for (const t of ds) {
    try {
      if (!laHostCdnZalo(t.url)) throw new Error("không tải: máy chủ không thuộc CDN Zalo");
      const hetMuc = opts.hanMuc?.kiem();
      if (hetMuc) throw new Error(`không tải: ${hetMuc}`);
      const file = await taiCoHan(tai, t.url, opts);
      opts.hanMuc?.ghi(file.data.byteLength);
      fs.mkdirSync(thuMucTep, { recursive: true });
      const ten = tenTrong(thuMucTep, `${gio.replace(":", "")}_${tenFileAnToan(t.ten, file.mediaType, t.url)}`);
      const duongDanTep = path.join(thuMucTep, ten);
      fs.writeFileSync(duongDanTep, file.data);
      ghiDauTaiTuInternet(duongDanTep);
      ketQua.push({ loai: t.loai, ten: t.ten, duongDan: `tep/${ten}` });
    } catch (err) {
      ketQua.push({ loai: t.loai, ten: t.ten, loi: err instanceof Error ? err.message.slice(0, 120) : String(err) });
    }
  }
  return ketQua;
}

/**
 * Tải với hạn tổng. `signal` để bộ tải tự hủy socket; thêm nhánh race để dù `tai`
 * lờ signal thì vòng lặp vẫn đi tiếp đúng hạn.
 */
async function taiCoHan(tai: NonNullable<TuyChonTaiTep["tai"]>, url: string, opts: TuyChonTaiTep): Promise<RemoteFile> {
  const hanMs = opts.hanTongMs ?? HAN_TONG_TAI_TEP_MS;
  const signal = AbortSignal.timeout(hanMs);
  let boLangNghe = (): void => {};
  const quaHan = new Promise<never>((_, reject) => {
    const nghe = (): void => reject(new Error(`quá hạn tải ${Math.round(hanMs / 1000)}s`));
    signal.addEventListener("abort", nghe, { once: true });
    boLangNghe = () => signal.removeEventListener("abort", nghe);
  });
  const viec = tai(url, { maxBytes: opts.maxBytes, timeoutMs: 120_000, signal });
  viec.catch(() => undefined); // thua race thì lỗi muộn không thành unhandled rejection
  try {
    return await Promise.race([viec, quaHan]);
  } finally {
    boLangNghe();
  }
}

/** Tên gốc bỏ dấu + ký tự lạ; đuôi chỉ lấy từ danh sách an toàn, còn lại `.bin` */
function tenFileAnToan(ten: string, mediaType: string, url: string): string {
  const goc = path.parse(ten);
  const coDuoi = /^\.[A-Za-z0-9]{1,8}$/.test(goc.ext);
  const than = (coDuoi ? taoSlug(goc.name) : taoSlug(ten)) || "tep";
  return `${than}${chonDuoiAnToan(ten, mediaType, url)}`;
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

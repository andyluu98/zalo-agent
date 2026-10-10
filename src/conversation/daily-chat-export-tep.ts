import { motDong } from "./log-text-utils.js";

/** Một tệp đính kèm trong dòng log: đã lưu (`duongDan`), đang tải (`dangTai`) hoặc lỗi (`loi`) */
export type TepLog = { loai: string; ten: string; duongDan?: string; loi?: string; dangTai?: boolean };

/** Các dòng markdown (thụt 2 ô) mô tả tệp của một tin */
export function dongTep(tep: TepLog[]): string[] {
  return tep.map((t) => {
    // File chat nằm trong nhom/ hoặc rieng/, tệp nằm ở <ngày>/tep/ -> link đi lên một cấp
    if (t.duongDan) return `  - Đã lưu (${t.loai}): [${t.duongDan}](../${t.duongDan})`;
    if (t.dangTai) return `  - Đang tải ${t.loai} "${motDong(t.ten)}" (kết quả ghi bổ sung ở dòng "Tệp của tin" bên dưới)`;
    return `  - Không tải được ${t.loai} "${motDong(t.ten)}": ${motDong(t.loi ?? "")}`;
  });
}

/** Khối markdown nối thêm khi tải xong: nói rõ là tệp của tin nào vì đã có tin khác chen vào giữa */
export function khoiBoSungTep(gio: string, nguoiGui: string, msgId: string, tep: TepLog[]): string {
  return `- Tệp của tin lúc ${gio} (**${nguoiGui}**, msgId ${motDong(msgId)}):\n${dongTep(tep).join("\n")}\n`;
}

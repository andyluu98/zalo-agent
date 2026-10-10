/**
 * Hạn chót cho MỘT lần gửi của hộp thư đi.
 *
 * zca-js không đặt timeout: upload tệp (nhất là không phải ảnh) có thể treo vĩnh viễn, khi đó
 * cả hộp thư đi đứng. Quá hạn thì KHÔNG biết tin đã tới hay chưa nên không bao giờ tự gửi lại;
 * lời gọi treo cũng không hủy được, nên kết quả đến muộn của nó bị bỏ (người gọi không ghi gì nữa).
 */

const PHUT = 60_000;
const MB10 = 10 * 1024 * 1024;
export const HAN_GUI_NEN_MS = 5 * PHUT;
export const HAN_GUI_TRAN_MS = 20 * PHUT;

/** 5 phút + 1 phút cho mỗi 10 MB tệp (làm tròn lên), trần 20 phút */
export function hanGuiMacDinh(tongBytes: number): number {
  return Math.min(HAN_GUI_TRAN_MS, HAN_GUI_NEN_MS + Math.ceil(tongBytes / MB10) * PHUT);
}

export type KetQuaGui = { loai: "xong"; msgId?: string } | { loai: "loi"; chiTiet: string } | { loai: "het_gio" };

export async function guiCoHan(chay: () => Promise<string | undefined>, hanMs: number): Promise<KetQuaGui> {
  let hen: ReturnType<typeof setTimeout> | undefined;
  const hetGio = new Promise<KetQuaGui>((xong) => {
    hen = setTimeout(() => xong({ loai: "het_gio" }), hanMs);
  });
  // Bắt cả lỗi ném đồng bộ và lỗi đến muộn sau khi đã quá hạn (không để thành unhandled rejection)
  const lanGui: Promise<KetQuaGui> = Promise.resolve()
    .then(chay)
    .then(
      (msgId): KetQuaGui => (msgId ? { loai: "xong", msgId } : { loai: "xong" }),
      (err): KetQuaGui => ({ loai: "loi", chiTiet: err instanceof Error ? err.message : String(err) }),
    );
  try {
    return await Promise.race([lanGui, hetGio]);
  } finally {
    clearTimeout(hen);
  }
}

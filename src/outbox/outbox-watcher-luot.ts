import { ThreadType, type API } from "zca-js";
import { danhSachAccountCoHopThu } from "./outbox-file-store.js";
import type { QuyDinhTep } from "./outbox-path-guard.js";
import { xuLyHopThu, type CauHinhGui } from "./outbox-sender.js";
import { sangNguonZca } from "./outbox-zca-attachments.js";

/**
 * Một lượt của watcher hộp thư đi, TÁCH khỏi config / account-manager / DB để test được
 * bằng zca-js giả: mọi thứ chạm bên ngoài đi qua `PhuThuocLuot`.
 */

export type PhuThuocLuot = {
  goc: string;
  thuMucKhoa: string;
  quyDinhTep: () => QuyDinhTep;
  /** OUTBOX_ENABLED */
  hopThuBat: () => boolean;
  cauHinh: () => CauHinhGui;
  /** id các account đang chạy */
  accountDangChay: () => string[];
  /** Chỉ account CHỈ ĐỌC mới được gửi */
  laChiDoc: (accountId: string) => boolean;
  /** api zca-js của kênh cá nhân; undefined = không có (kênh bot / chưa kết nối) */
  layApi: (accountId: string) => Pick<API, "sendMessage"> | undefined;
  hanGuiMs?: (tongBytes: number) => number;
  log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void };
};

/** Trả số ms nên hẹn lượt sau sớm nhất (có tin đang chờ giãn nhịp), hoặc undefined */
export async function motLuot(p: PhuThuocLuot): Promise<number | undefined> {
  if (!p.hopThuBat()) return undefined;
  const chay = new Set(p.accountDangChay());
  let henSom: number | undefined;
  for (const accountId of danhSachAccountCoHopThu(p.goc)) {
    if (!chay.has(accountId) || !p.laChiDoc(accountId)) continue;
    try {
      const api = p.layApi(accountId);
      if (!api) continue;
      const kq = await xuLyHopThu({
        goc: p.goc,
        accountId,
        thuMucKhoa: p.thuMucKhoa,
        quyDinhTep: p.quyDinhTep(),
        cauHinh: p.cauHinh(),
        ...(p.hanGuiMs ? { hanGuiMs: p.hanGuiMs } : {}),
        gui: async (threadId, laNhom, noiDung, tep, tag) => {
          const loai = laNhom ? ThreadType.Group : ThreadType.User;
          // Một lời gọi gửi cả chữ, tag (@người) và tệp, giống công cụ send_file / tag_member
          const tin =
            tep.length === 0 && tag.length === 0
              ? noiDung
              : {
                  msg: noiDung,
                  ...(tep.length > 0 ? { attachments: sangNguonZca(tep) } : {}),
                  ...(tag.length > 0 ? { mentions: tag.map((x) => ({ pos: x.pos, uid: x.uid, len: x.len })) } : {}),
                };
          const r = await api.sendMessage(tin, threadId, loai);
          const id = r?.message?.msgId ?? r?.attachment?.[0]?.msgId;
          return id === undefined || id === null ? undefined : String(id);
        },
      });
      if (kq.daGui > 0) p.log.info({ accountId, daGui: kq.daGui }, "Đã gửi tin từ hộp thư đi");
      if (kq.henLaiSauMs !== undefined) henSom = Math.min(henSom ?? Infinity, kq.henLaiSauMs);
    } catch (err) {
      // Một account hỏng không được chặn các account sau nó
      p.log.error({ err, accountId }, "Lỗi xử lý hộp thư đi của account");
    }
  }
  return henSom;
}

/**
 * Bộ chạy MỘT LẦN một lúc: gọi lúc đang chạy thì ghi nhớ và chạy thêm đúng một lượt ngay
 * sau đó. Cờ `dangChay` được nhả trong `finally` nên lượt ném lỗi hay hỏng không làm kẹt
 * hộp thư đi của mọi account.
 */
export function taoBoKichHoat(
  chayMotLuot: () => Promise<void>,
  onLoi: (err: unknown) => void,
): { kichHoat: () => void; dangChay: () => boolean } {
  let dangChay = false;
  let chayLai = false;
  async function vong(): Promise<void> {
    dangChay = true;
    try {
      await chayMotLuot();
    } catch (err) {
      onLoi(err);
    } finally {
      dangChay = false;
    }
    if (chayLai) {
      chayLai = false;
      kichHoat();
    }
  }
  function kichHoat(): void {
    if (dangChay) {
      chayLai = true;
      return;
    }
    void vong();
  }
  return { kichHoat, dangChay: () => dangChay };
}

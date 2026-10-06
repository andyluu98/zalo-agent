import { ThreadType, type API, type Message } from "zca-js";
import { getAccount } from "../config/account-store.js";
import { NHIP_SONG_PHUT, soSanhMsgId, type LoaiThread } from "../conversation/trang-thai-chi-doc.js";
import { createLogger } from "../shared/logger.js";
import { routeIncomingMessage } from "./incoming-message-router.js";
import { laySoTrangThai, routeUndoEvent } from "./read-only-chat-log.js";
import type { ListenerHooks } from "./zalo-listener.js";

/**
 * Vòng đời của account CHỈ ĐỌC: sổ trạng thái (kết nối / mất kết nối / đã dừng
 * + nhịp sống) và tải bù tin nhắn bị lỡ trong lúc bot tắt hoặc rớt kết nối.
 *
 * Tải bù: mỗi lần listener nối (kể cả nối lại), xin Zalo các tin sau msgId cuối
 * đã ghi (`requestOldMessages`), rồi cho chúng đi đúng đường của tin thường
 * (`routeIncomingMessage`) - chỉ lọc bỏ tin không mới hơn msgId cuối để khỏi ghi
 * trùng. Lần chạy đầu tiên chưa có msgId nào thì KHÔNG tải bù (tránh đổ cả lịch
 * sử cũ vào log của hôm nay).
 */

const log = createLogger("read-only-lifecycle");

const dangKetNoi = new Set<string>();
let nhipSong: ReturnType<typeof setInterval> | undefined;

function laChiDoc(accountId: string): boolean {
  return getAccount(accountId)?.readOnly === true;
}

function batNhipSong(): void {
  if (nhipSong) return;
  nhipSong = setInterval(() => {
    for (const id of dangKetNoi) {
      try {
        laySoTrangThai().cap(id, {});
      } catch (err) {
        log.debug({ accountId: id, err }, "Không ghi được nhịp sống");
      }
    }
  }, NHIP_SONG_PHUT * 60_000);
  nhipSong.unref();
}

export function mocChiDoc(accountId: string, api: API, selfId: string): ListenerHooks {
  return {
    onUndo: (event) => routeUndoEvent(accountId, event),
    onConnected: () => {
      if (!laChiDoc(accountId)) return;
      const so = laySoTrangThai();
      dangKetNoi.add(accountId);
      batNhipSong();
      so.cap(accountId, { tinhTrang: "dang_ket_noi", ketNoiLuc: new Date().toISOString(), chiTiet: undefined });
      const cuoi = so.doc(accountId).msgIdCuoi;
      if (cuoi.user) api.listener.requestOldMessages(ThreadType.User, cuoi.user);
      if (cuoi.group) api.listener.requestOldMessages(ThreadType.Group, cuoi.group);
    },
    onClosed: (code, reason) => {
      dangKetNoi.delete(accountId);
      if (!laChiDoc(accountId)) return;
      laySoTrangThai().cap(accountId, {
        tinhTrang: "mat_ket_noi",
        matKetNoiLuc: new Date().toISOString(),
        chiTiet: `mã ${code}${reason ? ` - ${reason}` : ""}`,
      });
    },
    onOldMessages: (messages, type) => {
      taiBu(accountId, api, selfId, messages, type);
    },
  };
}

/** Exported cho test - lọc tin mới hơn msgId cuối, sắp tăng dần rồi đưa vào router */
export function taiBu(
  accountId: string,
  api: API,
  selfId: string,
  messages: Message[],
  type: ThreadType,
  route: typeof routeIncomingMessage = routeIncomingMessage,
): number {
  if (!laChiDoc(accountId)) return 0;
  const so = laySoTrangThai();
  const loai: LoaiThread = type === ThreadType.Group ? "group" : "user";
  const moi = messages
    .filter((m) => so.laTinMoi(accountId, loai, String(m.data?.msgId ?? "")))
    .sort((a, b) => soSanhMsgId(String(a.data.msgId), String(b.data.msgId)));
  for (const m of moi) route(accountId, api, selfId, m);
  so.cap(accountId, { taiBu: { luc: new Date().toISOString(), soTin: moi.length } });
  log.info({ accountId, loai, nhan: messages.length, ghi: moi.length }, "Tải bù tin chỉ đọc");
  return moi.length;
}

/** Gọi khi dừng account (tắt trên dashboard, tắt tiến trình) */
export function danhDauDung(accountId: string): void {
  dangKetNoi.delete(accountId);
  if (laChiDoc(accountId)) laySoTrangThai().cap(accountId, { tinhTrang: "da_dung" });
}

/** Gọi khi khởi động account thất bại (cookie hết hạn, bị đăng xuất từ xa...) */
export function danhDauLoiDangNhap(accountId: string, err: unknown): void {
  if (!laChiDoc(accountId)) return;
  const chiTiet = err instanceof Error ? err.message : String(err);
  laySoTrangThai().cap(accountId, { tinhTrang: "loi_dang_nhap", chiTiet: chiTiet.slice(0, 300) });
}

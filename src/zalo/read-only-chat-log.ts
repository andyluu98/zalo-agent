import type { API, Undo } from "zca-js";
import { getAccount } from "../config/account-store.js";
import { chatExportDir } from "../config/env.js";
import { botTimeZone } from "../config/runtime-tuning-settings.js";
import { BoGhiLogNgay } from "../conversation/daily-chat-export.js";
import { SoTrangThai } from "../conversation/trang-thai-chi-doc.js";
import { xepHangTheoKhoa } from "../shared/xep-hang-theo-khoa.js";
import { getThreadDisplayName, hasDisplayName } from "../conversation/thread-store.js";
import { createLogger } from "../shared/logger.js";
import { resolveGroupName } from "./resolve-group-name.js";
import { describeForHistory, type ParsedMessage } from "./zalo-message-parser.js";
import { mocGuiCuaTinZalo } from "./zalo-message-timestamp.js";

/**
 * Chế độ CHỈ ĐỌC (`account.readOnly`): nối tin nhắn + tin thu hồi ra file log
 * theo ngày (xem `daily-chat-export.ts`). Tách khỏi router để router chỉ còn
 * một dòng gọi vào đây.
 */

const log = createLogger("read-only-chat-log");

let boGhiLog: BoGhiLogNgay | undefined;

/** Bộ ghi log dùng chung, tạo lười để account không bật chỉ đọc không đẻ thư mục exports */
function layBoGhiLog(): BoGhiLogNgay {
  if (!boGhiLog) {
    boGhiLog = new BoGhiLogNgay(chatExportDir, botTimeZone);
    boGhiLog.damBaoHuongDan();
  }
  return boGhiLog;
}

let soTrangThai: SoTrangThai | undefined;

/** Sổ trạng thái + msgId cuối của account chỉ đọc (xem trang-thai-chi-doc.ts) */
export function laySoTrangThai(): SoTrangThai {
  soTrangThai ??= new SoTrangThai(chatExportDir, botTimeZone);
  return soTrangThai;
}

export function ghiLogChiDoc(
  accountId: string,
  api: API,
  msg: ParsedMessage,
  choTenNhom: Promise<void> | undefined,
): void {
  // Ghi nhận msgId NGAY (không đợi hàng chờ): đợt tải bù đến sau dựa vào nó để
  // bỏ tin đã ghi, mà hàng chờ có thể còn đang đợi lấy tên nhóm
  try {
    laySoTrangThai().ghiNhanTin(accountId, msg.isGroup ? "group" : "user", msg.msgId, msg.sentAt);
  } catch (err) {
    log.error({ accountId, err }, "Không cập nhật được sổ trạng thái");
  }
  void xepHangTheoKhoa(`${accountId}:${msg.threadId}`, async () => {
    // Đợi tên nhóm ở lần gặp đầu để file mang tên dễ đọc thay vì chỉ có id
    if (choTenNhom) await choTenNhom;
    else if (msg.isGroup && !hasDisplayName(accountId, msg.threadId)) {
      await resolveGroupName(accountId, api, msg.threadId);
    }
    layBoGhiLog().ghiTin({
      accountId,
      threadId: msg.threadId,
      tenThread: getThreadDisplayName(accountId, msg.threadId) || (msg.isGroup || msg.isSelf ? "" : msg.senderName),
      laNhom: msg.isGroup,
      sentAt: msg.sentAt,
      senderId: msg.senderId,
      senderName: msg.senderName,
      laToi: msg.isSelf,
      msgId: msg.msgId,
      cliMsgId: msg.cliMsgId,
      loaiTin: msg.loaiTin ?? "chu",
      noiDung: describeChoLog(msg),
      ...(msg.dinhKem ? { dinhKem: msg.dinhKem } : {}),
      ...(msg.trichDan ? { trichDan: msg.trichDan } : {}),
      anh: msg.images.map((i) => i.url),
    });
  }).catch((err) => log.error({ accountId, threadId: msg.threadId, err }, "Không ghi được log chỉ đọc"));
}

/** Nội dung dòng log: chữ của tin, hoặc dấu giữ chỗ khi tin không có chữ */
function describeChoLog(msg: ParsedMessage): string {
  if (msg.text.trim()) return msg.text;
  if (msg.images.length > 0) return msg.images.length > 1 ? `[${msg.images.length} ảnh]` : "[ảnh]";
  return describeForHistory(msg);
}

/** Tin bị thu hồi - chỉ ghi vào log file của account chỉ đọc */
export function routeUndoEvent(accountId: string, event: Undo): void {
  const config = getAccount(accountId);
  if (!config?.readOnly || !event.threadId) return;
  const data = event.data;
  void xepHangTheoKhoa(`${accountId}:${event.threadId}`, () => {
    layBoGhiLog().ghiThuHoi({
      accountId,
      threadId: event.threadId,
      tenThread: getThreadDisplayName(accountId, event.threadId),
      laNhom: event.isGroup,
      sentAt: mocGuiCuaTinZalo(data.ts, new Date()),
      senderName: String(data.dName || (event.isSelf ? "Tôi" : data.uidFrom || "?")),
      laToi: event.isSelf,
      msgIdGoc: String(data.content?.globalMsgId ?? ""),
    });
  }).catch((err) => log.error({ accountId, threadId: event.threadId, err }, "Không ghi được tin thu hồi"));
}

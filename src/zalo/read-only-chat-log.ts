import type { API, Undo } from "zca-js";
import { getAccount } from "../config/account-store.js";
import { chatExportDir, env } from "../config/env.js";
import { botTimeZone } from "../config/runtime-tuning-settings.js";
import { BoGhiLogNgay } from "../conversation/daily-chat-export.js";
import { SoTrangThai } from "../conversation/trang-thai-chi-doc.js";
import { xepHangTheoKhoa } from "../shared/xep-hang-theo-khoa.js";
import { getThreadDisplayName } from "../conversation/thread-store.js";
import { createLogger } from "../shared/logger.js";
import { danhSachTepCanTai, taiTep } from "./read-only-attachments.js";
import { resolveGroupName, resolveUserName } from "./resolve-group-name.js";
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
  choTenNhom: Promise<string> | undefined,
): void {
  // Ghi nhận msgId NGAY (không đợi hàng chờ): đợt tải bù đến sau dựa vào nó để
  // bỏ tin đã ghi, mà hàng chờ có thể còn đang đợi lấy tên nhóm
  try {
    laySoTrangThai().ghiNhanTin(accountId, msg.isGroup ? "group" : "user", msg.msgId, msg.sentAt);
  } catch (err) {
    log.error({ accountId, err }, "Không cập nhật được sổ trạng thái");
  }
  void xepHangTheoKhoa(`${accountId}:${msg.threadId}`, async () => {
    const tenThread = await layTenThread(accountId, api, msg, choTenNhom);
    const { thuMucNgay, gio } = layBoGhiLog().viTriNgay(accountId, msg.sentAt);
    const tepDaLuu = await taiTep(thuMucNgay, gio, danhSachTepCanTai(msg), {
      maxBytes: env.CHAT_EXPORT_MAX_FILE_MB * 1024 * 1024,
    });
    layBoGhiLog().ghiTin({
      accountId,
      threadId: msg.threadId,
      tenThread,
      laNhom: msg.isGroup,
      sentAt: msg.sentAt,
      senderId: msg.senderId,
      senderName: msg.senderName,
      laToi: msg.isSelf,
      msgId: msg.msgId,
      cliMsgId: msg.cliMsgId,
      loaiTin: msg.loaiTin ?? "chu",
      msgType: String(msg.rawData.msgType ?? ""),
      noiDung: describeChoLog(msg),
      ...(msg.dinhKem ? { dinhKem: msg.dinhKem } : {}),
      ...(msg.trichDan ? { trichDan: msg.trichDan } : {}),
      anh: msg.images.map((i) => i.url),
      ...(tepDaLuu.length > 0 ? { tepDaLuu } : {}),
    });
  }).catch((err) => log.error({ accountId, threadId: msg.threadId, err }, "Không ghi được log chỉ đọc"));
}

/**
 * Tên cuộc trò chuyện cho tên file / danh bạ, theo thứ tự rẻ tới đắt: danh bạ
 * log -> bảng threads -> người gửi (chat riêng, tin đến) -> hỏi Zalo. Chat riêng
 * mà chủ tài khoản nhắn trước thì threadId CHÍNH LÀ uid người kia.
 */
async function layTenThread(
  accountId: string,
  api: API,
  msg: ParsedMessage,
  choTenNhom: Promise<string> | undefined,
): Promise<string> {
  const daBiet = layBoGhiLog().tenThreadDaBiet(accountId, msg.threadId) || getThreadDisplayName(accountId, msg.threadId);
  if (daBiet) return daBiet;
  if (msg.isGroup) return (await (choTenNhom ?? resolveGroupName(accountId, api, msg.threadId))) || "";
  if (!msg.isSelf && msg.senderName) return msg.senderName;
  return resolveUserName(api, msg.threadId);
}

/** Nội dung dòng log: chữ của tin, hoặc dấu giữ chỗ khi tin không có chữ */
function describeChoLog(msg: ParsedMessage): string {
  if (msg.text.trim()) return msg.text;
  if (msg.images.length > 0) return msg.images.length > 1 ? `[${msg.images.length} ảnh]` : "[ảnh]";
  if (msg.loaiTin === "khac") return `[loại tin khác: ${String(msg.rawData.msgType ?? "?")}]`;
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
      tenThread:
        layBoGhiLog().tenThreadDaBiet(accountId, event.threadId) || getThreadDisplayName(accountId, event.threadId),
      laNhom: event.isGroup,
      sentAt: mocGuiCuaTinZalo(data.ts, new Date()),
      senderName: String(data.dName || (event.isSelf ? "Tôi" : data.uidFrom || "?")),
      laToi: event.isSelf,
      msgIdGoc: String(data.content?.globalMsgId ?? ""),
    });
  }).catch((err) => log.error({ accountId, threadId: event.threadId, err }, "Không ghi được tin thu hồi"));
}

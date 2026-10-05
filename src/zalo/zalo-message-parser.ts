import { ThreadType } from "zca-js";
import { pickImageVariant, type ImageQuality } from "./zalo-image-variant.js";
import { mocGuiCuaTinZalo } from "./zalo-message-timestamp.js";

export type IncomingImage = {
  url: string;
  /** Đường dẫn file đã lưu trong data/media (tương đối với DATA_DIR) - có sau khi persist */
  localPath?: string;
};

/**
 * Loại tin rút từ `msgType` của Zalo. Chỉ dùng để ghi log / dấu giữ chỗ - luồng
 * trả lời vẫn chỉ xử lý chữ + ảnh như trước.
 */
export type LoaiTin = "chu" | "anh" | "file" | "sticker" | "thoai" | "video" | "lien_ket" | "vi_tri" | "khac";

/** File/video/thoại/liên kết đính kèm: tên + link gốc Zalo (không tải về) */
export type DinhKem = { ten: string; url: string };

/** Tin được trích dẫn (người gửi bấm "Trả lời" một tin cũ) */
export type TinTrichDan = { nguoiGui: string; noiDung: string };

export type ParsedMessage = {
  accountId: string;
  threadId: string;
  threadType: ThreadType;
  isGroup: boolean;
  senderId: string;
  senderName: string;
  text: string;
  images: IncomingImage[];
  msgId: string;
  cliMsgId: string;
  isSelf: boolean;
  mentionsMe: boolean;
  /**
   * ISO UTC - giờ NGƯỜI TA GỬI, đọc từ `data.ts` (xem `zalo-message-timestamp.ts`).
   *
   * Đây là mốc giờ DUY NHẤT của tin này: nó vừa được ghi vào `created_at` lúc
   * lưu history, vừa là nhãn `[dd/mm hh:mm]` mà model đọc. Một nguồn nên hai
   * chỗ không thể lệch nhau - trước đây `created_at` là giờ KẾT THÚC lượt nên
   * lượt dài làm nhãn lệch mấy phút so với lúc bấm gửi.
   */
  sentAt: string;
  /**
   * id dòng trong bảng `messages`, đóng dấu bởi `ghiTinDenVaoHistory` ngay lúc
   * nhận tin. Chưa ghi thì chưa có.
   *
   * Lượt agent dùng nó để LỌC chính tin của mình ra khỏi phần lịch sử: từ khi
   * tin được ghi lúc nhận (thay vì cuối lượt), lúc lượt đọc lịch sử thì tin của
   * nó đã nằm sẵn trong đó - không lọc là model thấy lặp hai lần.
   */
  historyRowId?: number;
  /** Không có = tin chữ/ảnh (kênh bot và các object dựng tay không điền) */
  loaiTin?: LoaiTin;
  dinhKem?: DinhKem;
  trichDan?: TinTrichDan;
  /** data gốc của zca-js - dùng cho quote khi trả lời */
  rawData: Record<string, unknown>;
};

/**
 * Nội dung ghi vào history cho 1 tin đến. Ảnh không vào được cột text nên để
 * lại dấu vết đếm được; tin chỉ có ảnh vẫn phải có chữ, nếu không lượt sau
 * model đọc history thấy một dòng trống không hiểu chuyện gì đã xảy ra.
 */
export function describeForHistory(msg: ParsedMessage): string {
  const imageNote = msg.images.length > 0 ? ` [gửi kèm ${msg.images.length} ảnh]` : "";
  const coChu = `${msg.text}${imageNote}`.trim();
  if (coChu) return coChu;
  // Tin không chữ không ảnh chỉ tới được đây ở chế độ chỉ đọc (luồng trả lời
  // lọc bỏ từ trước) - để lại dấu giữ chỗ thay vì dòng trống
  return DAU_GIU_CHO[msg.loaiTin ?? "anh"] ?? "[ảnh]";
}

const DAU_GIU_CHO: Partial<Record<LoaiTin, string>> = {
  file: "[file]",
  sticker: "[sticker]",
  thoai: "[tin thoại]",
  video: "[video]",
  lien_ket: "[liên kết]",
  vi_tri: "[vị trí]",
  khac: "[tin không có chữ]",
};

/** Map `msgType` của Zalo (vd "webchat", "chat.photo", "share.file") sang loại tin */
export function loaiTinTuMsgType(msgType: string): LoaiTin {
  if (msgType === "webchat" || msgType === "") return "chu";
  if (msgType.includes("photo") || msgType.includes("gif") || msgType.includes("doodle")) return "anh";
  if (msgType === "share.file") return "file";
  if (msgType.includes("sticker")) return "sticker";
  if (msgType.includes("voice")) return "thoai";
  if (msgType.includes("video")) return "video";
  if (msgType.includes("recommended") || msgType.includes("link")) return "lien_ket";
  if (msgType.includes("location")) return "vi_tri";
  return "khac";
}

/** `quote.attach` là chuỗi JSON; tin trích là file/ảnh thì chữ nằm ở `title` */
function docTrichDan(raw: unknown): TinTrichDan | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const quote = raw as Record<string, unknown>;
  let noiDung = typeof quote.msg === "string" ? quote.msg : "";
  if (!noiDung && typeof quote.attach === "string" && quote.attach) {
    try {
      const attach = JSON.parse(quote.attach) as Record<string, unknown>;
      noiDung = String(attach.title ?? attach.description ?? "");
    } catch {
      /* attach không phải JSON - bỏ qua */
    }
  }
  return { nguoiGui: String(quote.fromD ?? ""), noiDung: noiDung || "[đính kèm]" };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @param imageQuality cỡ ảnh lấy từ payload Zalo - caller truyền
 * env.ZALO_IMAGE_QUALITY vào để module này thuần, test khỏi cần setupTestEnv
 * (cùng lý do với `botEnabledForThread` của allowlist-filter).
 */
export function parseIncomingMessage(
  accountId: string,
  selfId: string,
  message: any,
  imageQuality: ImageQuality = "normal",
  nhanLuc: Date = new Date(),
): ParsedMessage {
  const data = message?.data ?? {};
  const content = data.content;
  const msgType = String(data.msgType ?? "");

  let text = "";
  const images: IncomingImage[] = [];

  if (typeof content === "string") {
    text = content;
  } else if (content && typeof content === "object") {
    // Tin nhắn media: content là object có href/thumb + title (caption)
    text = String(content.title ?? content.description ?? "");
    // Zalo gửi kèm nhiều cỡ của cùng 1 ảnh. Lấy `hd` (bản to nhất) là tốn
    // token vô ích: ảnh HD 977x2128 ~2500 token mỗi lần vào context.
    const picked = msgType.includes("photo")
      ? pickImageVariant(content as Record<string, unknown>, imageQuality)
      : null;
    if (picked) {
      images.push({ url: picked.url });
    }
  }

  const loaiTin = loaiTinTuMsgType(msgType);
  let dinhKem: DinhKem | undefined;
  if (content && typeof content === "object" && (loaiTin === "file" || loaiTin === "video" || loaiTin === "thoai" || loaiTin === "lien_ket")) {
    dinhKem = { ten: String(content.title ?? ""), url: String(content.href ?? "") };
  }

  const mentions = Array.isArray(data.mentions) ? data.mentions : [];
  const mentionsMe = mentions.some((m: any) => String(m?.uid) === selfId);

  return {
    accountId,
    threadId: String(message?.threadId ?? ""),
    threadType: message?.type ?? ThreadType.User,
    isGroup: message?.type === ThreadType.Group,
    senderId: String(data.uidFrom ?? ""),
    senderName: String(data.dName ?? "Người dùng"),
    text,
    images,
    msgId: String(data.msgId ?? ""),
    cliMsgId: String(data.cliMsgId ?? ""),
    isSelf: Boolean(message?.isSelf),
    mentionsMe,
    sentAt: mocGuiCuaTinZalo(data.ts, nhanLuc),
    loaiTin,
    ...(dinhKem ? { dinhKem } : {}),
    ...(data.quote ? { trichDan: docTrichDan(data.quote) } : {}),
    rawData: data,
  };
}

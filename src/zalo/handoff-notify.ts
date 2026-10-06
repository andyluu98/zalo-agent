import { ThreadType } from "zca-js";
import { getRunningAccountKenh } from "./account-manager.js";
import { replyTargetTuKenh } from "./reply-target-tu-kenh.js";
import { sendReplyInParts } from "./send-reply-in-parts.js";

/**
 * Nhắn tin báo cho người vận hành (Zalo ID cấu hình ở account) rằng bot vừa
 * chuyển một khách cho người thật.
 *
 * Đi qua `KenhLuot` + `replyTargetTuKenh` như scheduler, KHÔNG gọi thẳng `api`
 * zca-js - để chạy được trên cả kênh cá nhân lẫn kênh bot (xem luật "Scheduler
 * gửi qua KenhLuot" ở CLAUDE.md).
 *
 * Ném khi account không chạy hoặc gửi hỏng - caller (tool) bắt lại và báo cho
 * model, bot VẪN đã tạm dừng ở thread của khách.
 */
export async function guiBaoChuyenNguoiThat(accountId: string, nguoiNhanId: string, noiDung: string): Promise<void> {
  const kenh = getRunningAccountKenh(accountId);
  if (!kenh) throw new Error("tài khoản Zalo đang không chạy");
  const target = replyTargetTuKenh({
    kenh,
    threadId: nguoiNhanId,
    threadType: ThreadType.User,
    threadKey: `${accountId}:${nguoiNhanId}`,
  });
  const kq = await sendReplyInParts(target, noiDung);
  if (kq.error !== undefined) throw kq.error instanceof Error ? kq.error : new Error(String(kq.error));
}

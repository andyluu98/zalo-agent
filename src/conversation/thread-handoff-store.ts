import { db } from "./database.js";

/**
 * Chuyển một thread cho người thật: TẮT bot ở thread (dùng chung kill switch
 * `bot_enabled` của dashboard - tin sau đó bị chặn TRƯỚC khi gọi LLM, không tốn
 * token) và ghi lại lúc nào + vì sao để dashboard hiện "Cần người hỗ trợ".
 *
 * Bật lại bot ở thread (`setBotEnabled(..., true)`) tự xóa dấu này - xem
 * `thread-store.ts`.
 */

export type KetQuaChuyen = "da_chuyen" | "da_chuyen_truoc_do" | "khong_co_thread";

const getStmt = db.prepare("SELECT handoff_at FROM threads WHERE account_id = ? AND thread_id = ?");

const chuyenStmt = db.prepare(`
  UPDATE threads
     SET bot_enabled = 0,
         handoff_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
         handoff_reason = ?
   WHERE account_id = ? AND thread_id = ? AND handoff_at = ''
`);

/** Trần độ dài lý do lưu xuống - đây là chữ model viết, hiện trên dashboard */
const TRAN_LY_DO = 300;

export function chuyenChoNguoiThat(accountId: string, threadId: string, lyDo: string): KetQuaChuyen {
  const row = getStmt.get(accountId, threadId) as { handoff_at: string } | undefined;
  if (!row) return "khong_co_thread";
  // Điều kiện `handoff_at = ''` nằm TRONG câu UPDATE: model gọi tool hai lần
  // trong cùng lượt thì lần sau không ghi đè mốc giờ + không báo chủ lần nữa.
  const r = chuyenStmt.run(lyDo.trim().slice(0, TRAN_LY_DO), accountId, threadId);
  return r.changes > 0 ? "da_chuyen" : "da_chuyen_truoc_do";
}

/** Thread đang chờ người thật (cho dashboard / test) */
export function dangChoNguoiThat(accountId: string, threadId: string): boolean {
  const row = getStmt.get(accountId, threadId) as { handoff_at: string } | undefined;
  return Boolean(row?.handoff_at);
}

import { tool } from "ai";
import { z } from "zod";
import { chuyenChoNguoiThat } from "../../conversation/thread-handoff-store.js";
import { createLogger } from "../../shared/logger.js";
import type { ToolContext } from "./index.js";
import { ketQuaLoi } from "./tool-failure-result.js";

/**
 * Chuyển cuộc chat cho người thật (nhân viên/chủ shop).
 *
 * KHÁC approval gate (CLAUDE.md đã bác cái đó): đây không phải xin phép trước
 * khi chạy tool, mà là BÀN GIAO cuộc chat - việc chăm sóc khách hàng nào cũng
 * cần khi bot không trả lời được hoặc khách đòi gặp người.
 *
 * Làm ba việc: tắt bot ở thread này (tin sau của khách không tới LLM nữa, để
 * người thật vào trả lời mà bot không chen ngang), ghi dấu cho dashboard, và
 * nhắn báo cho Zalo ID người vận hành đã cấu hình ở account.
 *
 * Chỉ được cấp khi account đã điền Zalo ID nhận báo (`available` ở catalog) -
 * opt-in, bot cũ không tự dưng biết tự tắt mình.
 */

const log = createLogger("handoff-to-human");

export const HANDOFF_DESCRIPTION = [
  "Chuyển cuộc trò chuyện này cho nhân viên (người thật) và báo cho họ biết.",
  "Sau khi gọi, bot NGỪNG trả lời trong cuộc chat này cho tới khi nhân viên bật lại.",
  "",
  "GỌI KHI: khách yêu cầu gặp người/nhân viên/chủ shop; khách phàn nàn, bức xúc, đòi hoàn tiền",
  "hoặc khiếu nại; câu hỏi cần quyết định của người (giảm giá ngoài chính sách, ngoại lệ, đơn",
  "hàng cụ thể bạn không tra được); hoặc đã tra tài liệu mà không có thông tin khách cần.",
  "KHÔNG GỌI: với câu hỏi bạn trả lời được từ tài liệu, hoặc chỉ vì khách chào hỏi.",
  "",
  "Sau khi gọi, trả lời khách một câu ngắn: đã chuyển cho nhân viên, nhân viên sẽ phản hồi sớm.",
  "Đừng hứa thời gian cụ thể.",
].join("\n");

export type GuiBao = (accountId: string, nguoiNhanId: string, noiDung: string) => Promise<void>;

export function soanTinBao(p: { tenKhach: string; threadId: string; laNhom: boolean; lyDo: string; tomTat: string }) {
  const dong = ["🔔 Cần người hỗ trợ", `${p.laNhom ? "Nhóm" : "Khách"}: ${p.tenKhach} (ID ${p.threadId})`, `Lý do: ${p.lyDo}`];
  if (p.tomTat.trim()) dong.push(`Tóm tắt: ${p.tomTat.trim()}`);
  dong.push(
    "",
    "Bot đã tạm dừng trả lời trong cuộc chat này. Xử lý xong thì bật lại bot cho cuộc chat đó ở trang Sessions trên dashboard.",
  );
  return dong.join("\n");
}

export function createHandoffToHumanTool(ctx: ToolContext, guiBao: GuiBao) {
  return tool({
    description: HANDOFF_DESCRIPTION,
    inputSchema: z.object({
      ly_do: z.string().min(1).max(300).describe("Vì sao cần người thật, một câu ngắn"),
      tom_tat: z
        .string()
        .max(1000)
        .describe("Tóm tắt khách cần gì và đã trao đổi tới đâu, để nhân viên khỏi phải đọc lại cả cuộc chat"),
    }),
    execute: async ({ ly_do, tom_tat }) => {
      try {
        const { accountId, threadId, isGroup, senderName } = ctx.message;
        const ketQua = chuyenChoNguoiThat(accountId, threadId, ly_do);
        if (ketQua === "khong_co_thread") {
          return ketQuaLoi("Không tìm thấy cuộc chat này trong hệ thống nên chưa chuyển được. Xin lỗi khách và mời họ nhắn lại sau.");
        }
        if (ketQua === "da_chuyen_truoc_do") {
          return "Cuộc chat này đã được chuyển cho nhân viên rồi. Chỉ cần trả lời khách là nhân viên sẽ phản hồi sớm.";
        }

        const nguoiNhan = ctx.account.handoffNotifyUserId ?? "";
        // Người vận hành tự thử trong chính chat của mình: đã tạm dừng là đủ,
        // nhắn báo vào đúng chat đó chỉ là tin thừa.
        if (!nguoiNhan || nguoiNhan === threadId) {
          return "Đã chuyển cho nhân viên và tạm dừng bot trong cuộc chat này. Báo khách là nhân viên sẽ phản hồi sớm.";
        }
        try {
          const tenKhach = isGroup ? threadId : senderName;
          await guiBao(accountId, nguoiNhan, soanTinBao({ tenKhach, threadId, laNhom: isGroup, lyDo: ly_do, tomTat: tom_tat }));
        } catch (err) {
          log.warn({ loi: err instanceof Error ? err.message : String(err), accountId }, "Không nhắn báo được cho người vận hành");
          // Bot ĐÃ tạm dừng - vẫn là thành công với khách, chỉ nói thêm để model không hứa quá
          return "Đã chuyển cho nhân viên và tạm dừng bot trong cuộc chat này (chưa nhắn báo được cho nhân viên, họ sẽ thấy trên dashboard). Báo khách là nhân viên sẽ phản hồi sớm.";
        }
        return "Đã chuyển cho nhân viên, đã nhắn báo cho họ và tạm dừng bot trong cuộc chat này. Báo khách là nhân viên sẽ phản hồi sớm.";
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        log.error({ err }, "Tool handoff_to_human lỗi");
        return ketQuaLoi(`Chuyển cho nhân viên thất bại (${reason}). Xin lỗi khách và mời họ liên hệ lại sau.`);
      }
    },
  });
}

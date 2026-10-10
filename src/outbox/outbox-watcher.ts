import fs from "node:fs";
import path from "node:path";
import { ThreadType } from "zca-js";
import { getAccount } from "../config/account-store.js";
import { chatExportDir } from "../config/env.js";
import { getTuning } from "../config/runtime-tuning-settings.js";
import { createLogger } from "../shared/logger.js";
import { getRunningAccountKenh, getRunningAccounts } from "../zalo/account-manager.js";
import { danhSachAccountCoHopThu, THU_MUC_HOP_THU } from "./outbox-file-store.js";
import { xuLyHopThu } from "./outbox-sender.js";

/**
 * Theo dõi hộp thư đi: KHÔNG quét liên tục. Chạy khi Windows báo có file đổi
 * (`fs.watch`), một lần lúc khởi động, và một vòng dự phòng thưa phòng khi
 * watch bỏ sót (ổ đĩa ngắt rồi cắm lại...). Chỉ account CHỈ ĐỌC, kênh cá nhân,
 * đang chạy mới được gửi; `OUTBOX_ENABLED` tắt thì không làm gì.
 */

const log = createLogger("outbox");
const DU_PHONG_MS = 5 * 60_000;
const GOM_SU_KIEN_MS = 800;

let dangChay = false;
let chayLai = false;
let henGom: ReturnType<typeof setTimeout> | undefined;
let henTocDo: ReturnType<typeof setTimeout> | undefined;

async function motLuot(): Promise<void> {
  if (!getTuning("OUTBOX_ENABLED")) return;
  const cauHinh = {
    cachNhauMs: getTuning("OUTBOX_MIN_GAP_SECONDS") * 1000,
    tranMoiGio: getTuning("OUTBOX_MAX_PER_HOUR"),
  };
  const chay = new Set(getRunningAccounts().map((a) => a.id));
  let henSom: number | undefined;
  for (const accountId of danhSachAccountCoHopThu(chatExportDir)) {
    if (!chay.has(accountId) || getAccount(accountId)?.readOnly !== true) continue;
    const api = getRunningAccountKenh(accountId)?.api;
    if (!api) continue;
    const kq = await xuLyHopThu({
      goc: chatExportDir,
      accountId,
      cauHinh,
      gui: async (threadId, laNhom, noiDung, tep) => {
        const loai = laNhom ? ThreadType.Group : ThreadType.User;
        // Có tệp: một lời gọi gửi cả chữ (làm chú thích) lẫn tệp, giống công cụ send_file
        const r = await api.sendMessage(tep.length > 0 ? { msg: noiDung, attachments: tep } : noiDung, threadId, loai);
        const id = r?.message?.msgId ?? r?.attachment?.[0]?.msgId;
        return id === undefined || id === null ? undefined : String(id);
      },
    });
    if (kq.daGui > 0) log.info({ accountId, daGui: kq.daGui }, "Đã gửi tin từ hộp thư đi");
    if (kq.henLaiSauMs !== undefined) henSom = Math.min(henSom ?? Infinity, kq.henLaiSauMs);
  }
  if (henSom !== undefined) {
    clearTimeout(henTocDo);
    henTocDo = setTimeout(kichHoat, henSom + 200);
    henTocDo.unref();
  }
}

/** Chạy một lượt; đang chạy thì ghi nhớ để chạy thêm một lượt ngay sau */
function kichHoat(): void {
  if (dangChay) {
    chayLai = true;
    return;
  }
  dangChay = true;
  motLuot()
    .catch((err) => log.error({ err }, "Lỗi xử lý hộp thư đi"))
    .finally(() => {
      dangChay = false;
      if (chayLai) {
        chayLai = false;
        kichHoat();
      }
    });
}

export function startOutboxWatcher(): () => void {
  const goc = path.join(chatExportDir, THU_MUC_HOP_THU);
  let watcher: fs.FSWatcher | undefined;
  try {
    fs.mkdirSync(goc, { recursive: true });
    watcher = fs.watch(goc, { recursive: true }, (_su, ten) => {
      if (ten && !String(ten).endsWith(".json")) return;
      clearTimeout(henGom);
      henGom = setTimeout(kichHoat, GOM_SU_KIEN_MS);
    });
    watcher.on("error", (err) => log.warn({ err }, "fs.watch hộp thư đi lỗi - còn vòng dự phòng"));
  } catch (err) {
    log.warn({ err }, "Không theo dõi được thư mục hộp thư đi - chỉ còn vòng dự phòng");
  }
  const duPhong = setInterval(kichHoat, DU_PHONG_MS);
  duPhong.unref();
  kichHoat();
  return () => {
    watcher?.close();
    clearInterval(duPhong);
    clearTimeout(henGom);
    clearTimeout(henTocDo);
  };
}

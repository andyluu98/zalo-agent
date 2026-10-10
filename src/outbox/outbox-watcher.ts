import fs from "node:fs";
import path from "node:path";
import { getAccount } from "../config/account-store.js";
import { chatExportDir, dataDir } from "../config/env.js";
import { getTuning } from "../config/runtime-tuning-settings.js";
import { createLogger } from "../shared/logger.js";
import { getRunningAccountKenh, getRunningAccounts } from "../zalo/account-manager.js";
import { quyDinhTepTuEnv } from "./outbox-attachment-policy.js";
import { THU_MUC_HOP_THU } from "./outbox-file-store.js";
import { motLuot, taoBoKichHoat } from "./outbox-watcher-luot.js";

/**
 * Theo dõi hộp thư đi: KHÔNG quét liên tục. Chạy khi Windows báo có file đổi
 * (`fs.watch`), một lần lúc khởi động, và một vòng dự phòng thưa phòng khi
 * watch bỏ sót (ổ đĩa ngắt rồi cắm lại...). Chỉ account CHỈ ĐỌC, kênh cá nhân,
 * đang chạy mới được gửi; `OUTBOX_ENABLED` tắt thì không làm gì. Phần xử lý một
 * lượt nằm ở `outbox-watcher-luot.ts` (nhận phụ thuộc, test bằng zca-js giả).
 */

const log = createLogger("outbox");
const DU_PHONG_MS = 5 * 60_000;
const GOM_SU_KIEN_MS = 800;

let henGom: ReturnType<typeof setTimeout> | undefined;
let henTocDo: ReturnType<typeof setTimeout> | undefined;

async function chayMotLuot(): Promise<void> {
  const henSom = await motLuot({
    goc: chatExportDir,
    thuMucKhoa: dataDir,
    quyDinhTep: quyDinhTepTuEnv,
    hopThuBat: () => getTuning("OUTBOX_ENABLED"),
    cauHinh: () => ({
      cachNhauMs: getTuning("OUTBOX_MIN_GAP_SECONDS") * 1000,
      tranMoiGio: getTuning("OUTBOX_MAX_PER_HOUR"),
    }),
    accountDangChay: () => getRunningAccounts().map((a) => a.id),
    laChiDoc: (id) => getAccount(id)?.readOnly === true,
    layApi: (id) => getRunningAccountKenh(id)?.api ?? undefined,
    log,
  });
  if (henSom !== undefined) {
    clearTimeout(henTocDo);
    henTocDo = setTimeout(kichHoat, henSom + 200);
    henTocDo.unref();
  }
}

const { kichHoat } = taoBoKichHoat(chayMotLuot, (err) => log.error({ err }, "Lỗi xử lý hộp thư đi"));

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

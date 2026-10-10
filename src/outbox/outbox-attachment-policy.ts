import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chatExportDir, dataDir, env } from "../config/env.js";
import type { QuyDinhTep } from "./outbox-path-guard.js";

/**
 * Quy định thư mục tệp đính kèm lấy từ env (CLI, watcher và tool agent dùng chung).
 * Được phép: `OUTBOX_ATTACH_ALLOWED_DIRS` (ngăn cách bằng `;`), rỗng thì
 * Downloads + Documents + Desktop của người dùng hiện tại và CHAT_EXPORT_DIR.
 * Chặn cứng (thắng cả danh sách được phép): thư mục repo bot và DATA_DIR.
 */

/** Thư mục gốc repo: file này nằm ở <repo>/src/outbox/ */
const THU_MUC_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function quyDinhTepTuEnv(): QuyDinhTep {
  const cauHinh = env.OUTBOX_ATTACH_ALLOWED_DIRS.split(";")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => path.resolve(x));
  const macDinh = ["Downloads", "Documents", "Desktop"].map((x) => path.join(os.homedir(), x));
  return {
    thuMucDuocPhep: cauHinh.length > 0 ? cauHinh : [...macDinh, chatExportDir],
    thuMucChan: [THU_MUC_REPO, dataDir],
  };
}

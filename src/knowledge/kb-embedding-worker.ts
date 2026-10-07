import { getEmbeddingSettings, isEmbeddingConfigured } from "../config/runtime-embedding-settings.js";
import { createLogger } from "../shared/logger.js";
import { nhungVanBan } from "./kb-embedding-client.js";
import { donVectorMoCoi, layDoanThieuVector, luuVector } from "./kb-vector-store.js";

/**
 * Vòng nền sinh vector cho các đoạn Kho tri thức CHƯA có vector của model
 * embedding hiện tại.
 *
 * TÁCH khỏi `kb-ingest-worker.ts` (đọc file + cắt đoạn) có chủ ý: nguồn được
 * đánh `san_sang` ngay khi cắt xong, tìm theo từ khóa dùng được LIỀN; vector
 * tới sau. Nhờ vậy mạng chập chờn hay key embedding sai KHÔNG làm nguồn nào
 * kẹt hay hỏng - kho chỉ tạm tìm bằng bm25 như trước khi có tính năng này.
 *
 * Đổi model trên dashboard thì `layDoanThieuVector` tự coi mọi vector cũ là
 * thiếu (khác model) và sinh lại dần - không cần nút "nhúng lại".
 */

const log = createLogger("kb-embedding-worker");

const TICK_MS = 5000;
/** Số đoạn mỗi lần gọi API - đủ nhỏ để một request không quá dài/quá nặng */
const KICH_LO = 32;
/** Số lô tối đa mỗi nhịp - chia việc cho kho lớn, không giữ vòng lặp quá lâu */
const SO_LO_MOI_NHIP = 8;
/** Lỗi (sai key, hết quota, router sập) thì nghỉ chừng này rồi mới thử lại */
const NGHI_SAU_LOI_MS = 60_000;
/** Trần thời gian một lần gọi API - treo thì bỏ, nhịp sau thử lại */
const TRAN_MOI_LAN_GOI_MS = 60_000;

let nghiDen = 0;
let dangChay = false;

/**
 * Một nhịp: nhúng tối đa `SO_LO_MOI_NHIP` lô. Trả số đoạn đã nhúng. KHÔNG
 * BAO GIỜ ném - lỗi chỉ log rồi nghỉ, đây là việc nền.
 */
export async function nhungMotNhip(now = Date.now()): Promise<number> {
  if (dangChay || now < nghiDen) return 0;
  const s = getEmbeddingSettings();
  if (!isEmbeddingConfigured(s)) return 0;

  dangChay = true;
  let soDaNhung = 0;
  try {
    for (let lo = 0; lo < SO_LO_MOI_NHIP; lo++) {
      const doan = layDoanThieuVector(s.model, KICH_LO);
      if (doan.length === 0) break;
      const { model, vectors } = await nhungVanBan(
        doan.map((d) => d.text),
        AbortSignal.timeout(TRAN_MOI_LAN_GOI_MS),
      );
      // Model đã đổi GIỮA lúc đang gọi thì vẫn ghi theo model THẬT đã sinh ra
      // vector - lượt sau tự nhận ra là lệch và sinh lại.
      doan.forEach((d, i) => luuVector(d.id, model, vectors[i]!));
      soDaNhung += doan.length;
    }
  } catch (err) {
    nghiDen = Date.now() + NGHI_SAU_LOI_MS;
    // Chỉ log message - lỗi của SDK có thể mang requestBodyValues (chữ tài liệu)
    log.warn(
      { loi: err instanceof Error ? err.message : String(err), soDaNhung },
      "Sinh vector cho Kho tri thức lỗi - tạm tìm theo từ khóa, thử lại sau 1 phút",
    );
  } finally {
    dangChay = false;
  }
  return soDaNhung;
}

/** Chỉ test dùng - xóa trạng thái nghỉ sau lỗi */
export function datLaiTrangThaiChoTest(): void {
  nghiDen = 0;
  dangChay = false;
}

/** Gọi một lần lúc boot. Trả hàm dừng, cùng mẫu `kb-ingest-worker.ts`. */
export function batDauNhungNen(): () => void {
  const soMoCoi = donVectorMoCoi();
  if (soMoCoi > 0) log.info({ soMoCoi }, "Đã dọn vector mồ côi của Kho tri thức lúc khởi động");
  void nhungMotNhip();
  const timer = setInterval(() => void nhungMotNhip(), TICK_MS);
  timer.unref();
  return () => clearInterval(timer);
}

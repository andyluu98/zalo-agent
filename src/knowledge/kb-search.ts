/**
 * Ghép tầng tìm kiếm Kho tri thức: nguồn được PHÉP đọc của agent -> bm25
 * (+ vector ngữ nghĩa nếu đã bật) -> hợp nhất RRF -> khử trùng nội dung -> tra
 * ngược ra đoạn đầy đủ (kèm tên nguồn) để trả cho model.
 *
 * Tìm LAI: bm25 bắt đúng từ khóa/mã sản phẩm/con số, vector bắt câu hỏi diễn
 * đạt khác tài liệu ("phí ship" vs "phí vận chuyển"). Hai danh sách trộn bằng
 * RRF theo HẠNG - xem lý do ở `hop-nhat-rrf.ts`.
 *
 * Vector là phần THÊM, không bao giờ là điểm chết: chưa cấu hình, model lỗi,
 * mạng chậm quá `TRAN_NHUNG_CAU_HOI_MS` - mọi ca đều rơi về bm25 như trước.
 */

import { getEmbeddingSettings, isEmbeddingConfigured } from "../config/runtime-embedding-settings.js";
import { getTuning } from "../config/runtime-tuning-settings.js";
import { boDauTiengViet } from "../shared/bo-dau-tieng-viet.js";
import { createLogger } from "../shared/logger.js";
import { nguonCuaAgent } from "./kb-agent-binding.js";
import { layDoanTheoId } from "./kb-chunk-store.js";
import { nhungVanBan } from "./kb-embedding-client.js";
import { timTheoTuKhoa } from "./kb-fts-query.js";
import { hopNhatRrf } from "./hop-nhat-rrf.js";
import { timTheoVector } from "./kb-vector-store.js";

const log = createLogger("kb-search");

/**
 * Trần chờ nhúng câu hỏi. Khách đang chờ trả lời nên không đợi lâu: quá mốc
 * thì bỏ vector, dùng bm25 - chậm một nhịp còn hơn treo cả lượt.
 */
const TRAN_NHUNG_CAU_HOI_MS = 8000;

type KetQuaId = { chunkId: number };

/** Danh sách xếp hạng theo vector, hoặc [] khi chưa bật / lỗi (đã log) */
async function timNguNghia(cauHoi: string, sourceIds: string[], soLuong: number): Promise<KetQuaId[]> {
  const s = getEmbeddingSettings();
  if (!isEmbeddingConfigured(s)) return [];
  try {
    const { model, vectors } = await nhungVanBan([cauHoi], AbortSignal.timeout(TRAN_NHUNG_CAU_HOI_MS));
    const nguong = getTuning("KB_VECTOR_MIN_SIMILARITY") / 100;
    return timTheoVector(vectors[0]!, model, sourceIds, soLuong, nguong);
  } catch (err) {
    log.warn(
      { loi: err instanceof Error ? err.message : String(err) },
      "Nhúng câu hỏi lỗi - lượt này chỉ tìm theo từ khóa",
    );
    return [];
  }
}

export type KetQuaKb = { sourceId: string; tenNguon: string; tieuDe: string; noiDung: string; diem: number };

// Lấy DƯ trước khi khử trùng (I3): `timTheoTuKhoa` LIMIT đúng trong SQL, nên
// khử trùng SAU đó (hai nguồn chép y hệt nhau chỉ giữ 1) sẽ THIẾU nếu không
// lấy dư - một cặp trùng chiếm 2 trong số suất ít ỏi, khử xong hụt mất một
// suất chứ không tự lấy bù đoạn khác đang nằm ngoài LIMIT. x3 đủ chừa chỗ cho
// ca thực tế nhất (một vài bản trùng lặp), lấy dư QUÁ nhiều chỉ tốn thêm một
// truy vấn rẻ (bảng `kb_chunks_fts` của một bot cá nhân không lớn).
//
// CHƯA đo được số lượng bản trùng THẬT của một kho tri thức thật (không có
// dữ liệu người dùng để đo) - x3 là suy luận, không phải số đo. Ca hỏng nếu
// suy luận sai: kho có NHIỀU hơn `soLuong * (HE_SO_LAY_DU - 1)` bản trùng
// đồng hạng cho cùng một câu hỏi (vd soLuong=5 mà có >10 bản gần như y hệt
// nhau đều khớp top) thì khử trùng vẫn THIẾU đúng kiểu I3 mô tả - chỉ ở quy
// mô nhỏ hơn hẳn bug gốc (LIMIT=soLuong, x1). Nếu gặp ca này thật, nâng
// `HE_SO_LAY_DU` chứ đừng đổi kiến trúc.
const HE_SO_LAY_DU = 3;

export async function timTrongKhoTriThuc(p: {
  cauHoi: string;
  agentId: string;
  soLuong?: number;
}): Promise<KetQuaKb[]> {
  // Mặc định ĐÓNG: agent chưa gán nguồn nào (chưa cấu hình gì, xem
  // kb-agent-binding.ts) thì không đọc được nguồn nào, KHÔNG PHẢI đọc hết -
  // đảo ngược điều này là rò tài liệu của agent khác.
  const sourceIds = nguonCuaAgent(p.agentId);
  if (sourceIds.length === 0) return [];

  const soLuong = p.soLuong ?? getTuning("KB_TOP_K");
  const ftsKetQua = timTheoTuKhoa(p.cauHoi, sourceIds, soLuong * HE_SO_LAY_DU);
  const vectorKetQua = await timNguNghia(p.cauHoi, sourceIds, soLuong * HE_SO_LAY_DU);
  // Chỉ rỗng khi CẢ HAI bộ đều không ra gì - bm25 trượt mà vector trúng (câu
  // hỏi khác chữ tài liệu) chính là ca tìm lai sinh ra để cứu.
  if (ftsKetQua.length === 0 && vectorKetQua.length === 0) return [];

  const k = getTuning("KB_RRF_K");
  // KHÔNG slice(0, soLuong) ở đây - các danh sách đầu vào đã LIMIT dư ở trên;
  // cắt về đúng soLuong phải đợi SAU khi khử trùng, không thì mất chính phần
  // "dư" vừa lấy để dành.
  const hopNhat = hopNhatRrf<KetQuaId>([ftsKetQua, vectorKetQua], (x) => String(x.chunkId), k);

  const diemTheoChunkId = new Map(hopNhat.map((h) => [h.item.chunkId, h.diem]));
  // layDoanTheoId trả về ĐÚNG thứ tự ids truyền vào - giữ nguyên thứ hạng RRF
  const doan = layDoanTheoId(hopNhat.map((h) => h.item.chunkId));

  // Khử trùng (I3): hai nguồn KHÁC NHAU chép y hệt nội dung không nên chiếm 2
  // slot trong top-k model thấy. So khớp theo NỘI DUNG đã chuẩn hóa (tiêu đề +
  // thân bài, bỏ dấu) - CỐ Ý không gồm tên nguồn: hai nguồn khác tên vẫn phải
  // khử được nếu nội dung y hệt, đó chính là ca cần khử. Giữ bản xếp hạng CAO
  // NHẤT (đầu tiên gặp, `doan` đã đúng thứ tự RRF), bỏ các bản trùng sau.
  const daGap = new Set<string>();
  const daKhuTrung: typeof doan = [];
  for (const d of doan) {
    const chuKy = boDauTiengViet(`${d.tieuDe} ${d.noiDung}`.trim());
    if (daGap.has(chuKy)) continue;
    daGap.add(chuKy);
    daKhuTrung.push(d);
    if (daKhuTrung.length >= soLuong) break;
  }

  return daKhuTrung.map((d) => ({
    sourceId: d.sourceId,
    tenNguon: d.tenNguon,
    tieuDe: d.tieuDe,
    noiDung: d.noiDung,
    diem: diemTheoChunkId.get(d.id) ?? 0,
  }));
}

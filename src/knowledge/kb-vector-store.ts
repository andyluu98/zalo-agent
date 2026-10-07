/**
 * Lưu và tìm vector ngữ nghĩa của đoạn Kho tri thức (bảng `kb_chunk_vectors`,
 * lược đồ ở `kb-schema.ts`).
 *
 * Tìm bằng QUÉT TUẦN TỰ + cosine trong JS, KHÔNG dùng extension vector của
 * SQLite: `node:sqlite` không nạp được sqlite-vec nếu chưa build kèm, và kho
 * của một bot cá nhân chỉ vài nghìn đoạn - quét 5.000 vector 1.536 chiều mất
 * cỡ chục mili-giây. Đọc bằng `iterate()` (từng dòng một) và chỉ giữ top-N
 * nên RAM không phình theo cỡ kho.
 */

import { db } from "../conversation/database.js";

const chenVectorStmt = db.prepare(`
  INSERT INTO kb_chunk_vectors (chunk_id, model, dim, vec) VALUES (?, ?, ?, ?)
  ON CONFLICT (chunk_id) DO UPDATE SET model = excluded.model, dim = excluded.dim, vec = excluded.vec
`);

/** Ghi (hoặc ghi đè) vector của một đoạn. Đoạn đã bị xóa giữa chừng thì bỏ qua. */
export function luuVector(chunkId: number, model: string, vec: Float32Array): void {
  const buf = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
  chenVectorStmt.run(chunkId, model, vec.length, buf);
}

export type DoanCanNhung = { id: number; text: string };

const doanThieuStmt = db.prepare(`
  SELECT c.id AS id, s.ten AS ten_nguon, c.tieu_de AS tieu_de, c.noi_dung AS noi_dung
    FROM kb_chunks c
    JOIN kb_sources s ON s.id = c.source_id
    LEFT JOIN kb_chunk_vectors v ON v.chunk_id = c.id
   WHERE v.chunk_id IS NULL OR v.model <> ?
   ORDER BY c.id
   LIMIT ?
`);

/**
 * Đoạn CHƯA có vector của `model` (chưa từng nhúng, hoặc nhúng bằng model cũ).
 * Chữ đem nhúng gồm cả tên nguồn + tiêu đề, cùng lý do `luuDoan` đưa chúng
 * vào chỉ mục bm25: khách hỏi bằng tên tài liệu cũng phải ra đúng đoạn.
 */
export function layDoanThieuVector(model: string, soLuong: number): DoanCanNhung[] {
  const rows = doanThieuStmt.all(model, soLuong) as unknown as {
    id: number;
    ten_nguon: string;
    tieu_de: string;
    noi_dung: string;
  }[];
  return rows.map((r) => ({ id: r.id, text: [r.ten_nguon, r.tieu_de, r.noi_dung].filter(Boolean).join("\n") }));
}

const demStmt = db.prepare(`
  SELECT (SELECT COUNT(*) FROM kb_chunks) AS tong,
         (SELECT COUNT(*) FROM kb_chunk_vectors v JOIN kb_chunks c ON c.id = v.chunk_id WHERE v.model = ?) AS da_nhung
`);

/** Tiến độ nhúng cho dashboard: bao nhiêu đoạn đã có vector của model hiện tại */
export function demTienDoNhung(model: string): { tong: number; daNhung: number } {
  const r = demStmt.get(model) as { tong: number; da_nhung: number };
  return { tong: r.tong, daNhung: r.da_nhung };
}

const donMoCoiStmt = db.prepare(`DELETE FROM kb_chunk_vectors WHERE chunk_id NOT IN (SELECT id FROM kb_chunks)`);

/** Dọn vector của đoạn không còn tồn tại - lưới an toàn, gọi lúc boot */
export function donVectorMoCoi(): number {
  return Number(donMoCoiStmt.run().changes);
}

/** Cosine của hai vector cùng chiều; một bên toàn 0 thì trả 0 (không NaN) */
export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

export type KetQuaVector = { chunkId: number; doGiong: number };

/**
 * Top `soLuong` đoạn giống câu hỏi nhất, CHỈ trong `sourceIds` và CHỈ so với
 * vector cùng `model` + cùng số chiều (vector của model khác nằm ở không gian
 * khác, so với nhau là ra số vô nghĩa). Đoạn dưới `nguong` (0..1) bị bỏ.
 */
export function timTheoVector(
  cauHoiVec: Float32Array,
  model: string,
  sourceIds: string[],
  soLuong: number,
  nguong: number,
): KetQuaVector[] {
  if (sourceIds.length === 0 || soLuong <= 0) return [];
  const placeholders = sourceIds.map(() => "?").join(", ");
  const stmt = db.prepare(`
    SELECT v.chunk_id AS chunk_id, v.vec AS vec
      FROM kb_chunk_vectors v
      JOIN kb_chunks c ON c.id = v.chunk_id
     WHERE v.model = ? AND v.dim = ? AND c.source_id IN (${placeholders})
  `);

  const top: KetQuaVector[] = [];
  for (const row of stmt.iterate(model, cauHoiVec.length, ...sourceIds)) {
    const r = row as { chunk_id: number; vec: Uint8Array };
    // Chép ra buffer riêng: byteOffset của Uint8Array do SQLite trả không chắc
    // chia hết cho 4, mà Float32Array đòi căn lề 4 byte.
    const vec = new Float32Array(new Uint8Array(r.vec).buffer);
    const doGiong = cosine(cauHoiVec, vec);
    if (doGiong < nguong) continue;
    if (top.length < soLuong) {
      top.push({ chunkId: r.chunk_id, doGiong });
      top.sort((x, y) => y.doGiong - x.doGiong);
    } else if (doGiong > top[top.length - 1]!.doGiong) {
      top[top.length - 1] = { chunkId: r.chunk_id, doGiong };
      top.sort((x, y) => y.doGiong - x.doGiong);
    }
  }
  return top;
}

import { Hono } from "hono";
import { z } from "zod";
import {
  clearEmbeddingSettings,
  getEmbeddingSettings,
  getEmbeddingSettingsForApi,
  updateEmbeddingSettings,
} from "../../config/runtime-embedding-settings.js";
import { nhungVanBan } from "../../knowledge/kb-embedding-client.js";
import { demTienDoNhung } from "../../knowledge/kb-vector-store.js";
import { createLogger } from "../../shared/logger.js";

const log = createLogger("kb-embedding-routes");

const updateSchema = z.object({
  // Chuỗi rỗng tường minh = xóa (quay về env / mượn của LLM chung)
  baseUrl: z.union([z.string().startsWith("http"), z.literal("")]).optional(),
  model: z.string().max(200).optional(),
  // Bỏ trống (undefined) = giữ key; chuỗi rỗng = xóa key
  apiKey: z.string().optional(),
});

/** Cấu hình + tiến độ nhúng, một lần gọi cho modal trên dashboard */
function trangThai() {
  const cauHinh = getEmbeddingSettingsForApi();
  const model = getEmbeddingSettings().model;
  return { ...cauHinh, tienDo: model ? demTienDoNhung(model) : null };
}

/** /api/kb-embedding - tìm theo ngữ nghĩa cho Kho tri thức. Key KHÔNG BAO GIỜ trả plaintext. */
export const kbEmbeddingRoutes = new Hono()

  .get("/", (c) => c.json(trangThai()))

  .patch("/", async (c) => {
    const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Dữ liệu không hợp lệ", issues: parsed.error.issues }, 400);
    }
    updateEmbeddingSettings(parsed.data);
    // Audit: ghi field nào đổi, không ghi giá trị (tránh lộ key vào log)
    log.info(
      { changedFields: Object.keys(parsed.data).filter((k) => parsed.data[k as never] !== undefined) },
      "Đổi cấu hình tìm theo ngữ nghĩa từ dashboard",
    );
    return c.json({ ok: true, ...trangThai() });
  })

  .delete("/", (c) => {
    clearEmbeddingSettings();
    log.info("Tắt tìm theo ngữ nghĩa từ dashboard");
    return c.json({ ok: true, ...trangThai() });
  })

  // Nhúng thật một câu ngắn - cách duy nhất chắc chắn tên model + key đúng.
  // Rẻ (vài token), khác hẳn nút vẽ thử ảnh.
  .post("/test", async (c) => {
    try {
      const { vectors } = await nhungVanBan(["Xin chào, cho mình hỏi phí vận chuyển?"], AbortSignal.timeout(20_000));
      return c.json({ ok: true, soChieu: vectors[0]!.length });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 502);
    }
  });

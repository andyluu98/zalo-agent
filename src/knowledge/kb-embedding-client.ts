import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { embedMany } from "ai";
import { createSanitizingFetch } from "../agent/llm-response-sanitizer.js";
import { getEmbeddingSettings, isEmbeddingConfigured } from "../config/runtime-embedding-settings.js";

/**
 * Gọi `/v1/embeddings` (OpenAI-compatible) để biến chữ thành vector.
 *
 * Chỉ một giao thức: router (9Router/LiteLLM/OpenRouter), OpenAI, và cả Google
 * (`.../v1beta/openai`) đều nói được. Không dựng nhánh Anthropic - hãng đó
 * không có API embedding.
 *
 * Có điểm tiêm (`tiemHamNhungChoTest`) để test không đi ra mạng.
 */

export type KetQuaNhung = { model: string; vectors: Float32Array[] };
export type HamNhung = (texts: string[], signal?: AbortSignal) => Promise<KetQuaNhung>;

// Cùng bộ vá phản hồi lỗi của router như đường chat (JSON dính đuôi SSE)
const sanitizingFetch = createSanitizingFetch();

const nhungThat: HamNhung = async (texts, signal) => {
  const s = getEmbeddingSettings();
  if (!isEmbeddingConfigured(s)) throw new Error("Chưa cấu hình model embedding");
  const provider = createOpenAICompatible({
    name: "kb-embedding",
    baseURL: s.baseUrl,
    apiKey: s.apiKey,
    fetch: sanitizingFetch,
  });
  const { embeddings } = await embedMany({
    model: provider.embeddingModel(s.model),
    values: texts,
    // Worker nền tự thử lại ở nhịp sau; câu hỏi của khách thì rơi về bm25 ngay.
    // Thử lại bên trong SDK chỉ kéo dài thời gian khách phải chờ.
    maxRetries: 0,
    abortSignal: signal,
  });
  if (embeddings.length !== texts.length) {
    throw new Error(`Model embedding trả ${embeddings.length} vector cho ${texts.length} đoạn`);
  }
  return { model: s.model, vectors: embeddings.map((e) => Float32Array.from(e)) };
};

let hamNhung: HamNhung = nhungThat;

export function nhungVanBan(texts: string[], signal?: AbortSignal): Promise<KetQuaNhung> {
  return hamNhung(texts, signal);
}

/** Chỉ test dùng - thay hàm nhúng rồi trả hàm khôi phục */
export function tiemHamNhungChoTest(gia: HamNhung): () => void {
  const cu = hamNhung;
  hamNhung = gia;
  return () => {
    hamNhung = cu;
  };
}

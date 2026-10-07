import { db } from "../conversation/database.js";
import { env } from "./env.js";
import { getEffectiveLlmSettings } from "./runtime-llm-settings.js";
import { decryptSecret, encryptSecret, maskSecret } from "./secret-cipher.js";

/**
 * Cấu hình model embedding cho tìm kiếm NGỮ NGHĨA của Kho tri thức. Cùng nếp
 * `runtime-image-settings.ts`: bảng runtime_settings dùng chung, DB -> env,
 * key mã hóa AES-256-GCM.
 *
 * Model TRỐNG = tắt hẳn: kho chỉ tìm theo từ khóa như trước, không sinh vector
 * nào. Mặc định tắt vì embedding gọi ra mạng và tốn tiền - người vận hành phải
 * chủ động bật.
 *
 * Base URL/key bỏ trống thì MƯỢN của nhà cung cấp LLM chung, nhưng CHỈ khi đó
 * là `openai-compatible` (router 9Router/LiteLLM/OpenRouter đều có
 * `/v1/embeddings`). Key chung CHỈ được mượn khi base URL hiệu lực TRÙNG base
 * URL chung - người dùng điền base URL của hãng khác mà quên điền key thì
 * thà báo thiếu key còn hơn gửi khóa router sang bên thứ ba (đúng loại tai
 * nạn `doiProviderAnToan` chặn ở `llm-provider.ts`).
 */

export type EmbeddingSettings = { baseUrl: string; model: string; apiKey: string };

const BASE_URL_KEY = "kb_embedding_base_url";
const MODEL_KEY = "kb_embedding_model";
const API_KEY_KEY = "kb_embedding_api_key";

const getStmt = db.prepare("SELECT value FROM runtime_settings WHERE key = ?");
const setStmt = db.prepare(`
  INSERT INTO runtime_settings (key, value, updated_at)
  VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`);
const delStmt = db.prepare("DELETE FROM runtime_settings WHERE key = ?");

function read(key: string): string | undefined {
  return (getStmt.get(key) as { value: string } | undefined)?.value;
}

function readOwnApiKey(): string {
  const stored = read(API_KEY_KEY);
  if (!stored) return env.KB_EMBEDDING_API_KEY;
  try {
    return decryptSecret(stored);
  } catch {
    return env.KB_EMBEDDING_API_KEY;
  }
}

/** Giá trị TỰ KHAI (chưa mượn gì của LLM chung) - dùng cho form trên dashboard */
function readOwn(): EmbeddingSettings {
  return {
    baseUrl: read(BASE_URL_KEY) ?? env.KB_EMBEDDING_BASE_URL ?? "",
    model: read(MODEL_KEY) ?? env.KB_EMBEDDING_MODEL,
    apiKey: readOwnApiKey(),
  };
}

const chuanHoaUrl = (u: string) => u.trim().replace(/\/+$/, "");

/** Cấu hình HIỆU LỰC - đã mượn base URL/key của LLM chung khi được phép */
export function getEmbeddingSettings(): EmbeddingSettings {
  const own = readOwn();
  const llm = getEffectiveLlmSettings();
  const llmUrl = llm.provider === "openai-compatible" ? (llm.baseUrl ?? "") : "";
  const baseUrl = own.baseUrl || llmUrl;
  const muonKey = Boolean(llmUrl) && chuanHoaUrl(baseUrl) === chuanHoaUrl(llmUrl);
  return { baseUrl, model: own.model, apiKey: own.apiKey || (muonKey ? llm.apiKey : "") };
}

/** Bật khi đủ cả 3 (sau khi đã mượn) */
export function isEmbeddingConfigured(s = getEmbeddingSettings()): boolean {
  return Boolean(s.baseUrl && s.model && s.apiKey);
}

export type EmbeddingSettingsUpdate = {
  /** Chuỗi rỗng tường minh = xóa (quay về env / mượn LLM chung) */
  baseUrl?: string;
  model?: string;
  /** Bỏ trống = giữ key hiện tại */
  apiKey?: string;
};

export function updateEmbeddingSettings(update: EmbeddingSettingsUpdate): void {
  const apply = (key: string, value: string | undefined, encrypt = false): void => {
    if (value === undefined) return;
    if (value === "") delStmt.run(key);
    else setStmt.run(key, encrypt ? encryptSecret(value) : value);
  };
  apply(BASE_URL_KEY, update.baseUrl);
  apply(MODEL_KEY, update.model?.trim());
  apply(API_KEY_KEY, update.apiKey, true);
}

/** Xóa sạch kể cả key - đường PATCH quy ước "key trống = giữ" nên cần hành động riêng */
export function clearEmbeddingSettings(): void {
  for (const key of [BASE_URL_KEY, MODEL_KEY, API_KEY_KEY]) delStmt.run(key);
}

/** Dạng an toàn trả dashboard - không bao giờ lộ key đầy đủ */
export function getEmbeddingSettingsForApi() {
  const own = readOwn();
  const eff = getEmbeddingSettings();
  return {
    baseUrl: own.baseUrl,
    model: own.model,
    apiKeyMasked: maskSecret(own.apiKey),
    hasApiKey: Boolean(own.apiKey),
    /** Base URL/key đang mượn của nhà cung cấp LLM chung (UI hiện để người dùng khỏi nhập lại) */
    muonBaseUrl: !own.baseUrl && Boolean(eff.baseUrl),
    muonApiKey: !own.apiKey && Boolean(eff.apiKey),
    configured: isEmbeddingConfigured(eff),
  };
}

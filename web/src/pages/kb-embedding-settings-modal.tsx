import { useEffect, useState } from "react";
import type { KbEmbeddingSettings } from "../dashboard-api-client";
import { api, ApiError } from "../dashboard-api-client";
import { useConfirmDialog } from "../shared/confirm-dialog";
import { SecretInput } from "../shared/secret-input";
import { ModalField, modalButton, ToolModalShell } from "./tool-settings-modal-shell";

/**
 * Modal bật tìm theo NGỮ NGHĨA cho Kho tri thức (mở từ trang Kho tri thức).
 *
 * Base URL/key bỏ trống thì mượn của nhà cung cấp LLM chung khi đó là router
 * openai-compatible - đa số người dùng chỉ cần gõ tên model embedding. Tiến
 * độ nhúng tự làm mới vì vector được sinh dần ở nền.
 */
export function KbEmbeddingSettingsModal({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<KbEmbeddingSettings | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: "green" | "red" | "blue"; text: string } | null>(null);
  const { confirm, confirmDialog } = useConfirmDialog();

  useEffect(() => {
    let daDien = false;
    const tai = () =>
      api
        .kbEmbedding()
        .then((s) => {
          setSettings(s);
          // Chỉ điền form LẦN ĐẦU - các lần làm mới sau chỉ để cập nhật tiến độ,
          // không được ghi đè chữ người dùng đang gõ dở
          if (!daDien) {
            daDien = true;
            setBaseUrl(s.baseUrl);
            setModel(s.model);
          }
        })
        .catch(() => {});
    void tai();
    const timer = window.setInterval(tai, 4000);
    return () => window.clearInterval(timer);
  }, []);

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await api.updateKbEmbedding({ baseUrl, model, apiKey: apiKey || undefined });
      setSettings(res);
      setApiKey("");
      setStatus({
        tone: "green",
        text: res.configured
          ? "Đã lưu - bot đang tạo vector cho tài liệu ở nền, theo dõi tiến độ bên dưới."
          : "Đã lưu - còn thiếu base URL hoặc API key nên chưa bật được.",
      });
    } catch (err) {
      setStatus({ tone: "red", text: err instanceof ApiError ? err.message : "Lưu thất bại" });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setStatus({ tone: "blue", text: "Đang gọi thử model embedding..." });
    const r = await api.testKbEmbedding().catch((err) => ({
      ok: false as const,
      error: err instanceof ApiError ? err.message : "Không gọi được",
      soChieu: undefined,
    }));
    setStatus(
      r.ok
        ? { tone: "green", text: `Model chạy tốt - vector ${r.soChieu} chiều` }
        : { tone: "red", text: `Model lỗi: ${r.error}` },
    );
    setBusy(false);
  }

  async function tat() {
    const ok = await confirm({
      title: "Tắt tìm theo ngữ nghĩa?",
      message: "Xóa cấu hình (cả API key riêng nếu có). Kho tri thức quay về chỉ tìm theo từ khóa.",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await api.clearKbEmbedding();
      setSettings(res);
      setBaseUrl("");
      setModel("");
      setStatus({ tone: "blue", text: "Đã tắt - chỉ tìm theo từ khóa." });
    } catch (err) {
      setStatus({ tone: "red", text: err instanceof ApiError ? err.message : "Tắt thất bại" });
    } finally {
      setBusy(false);
    }
  }

  const tienDo = settings?.tienDo;

  return (
    <>
      <ToolModalShell
        title="Tìm theo ngữ nghĩa"
        subtitle="Bot hiểu câu hỏi khác chữ tài liệu (vd hỏi 'phí ship' vẫn ra mục 'phí vận chuyển'). Kết hợp với tìm theo từ khóa sẵn có."
        onClose={onClose}
        footer={
          <>
            {settings?.model && (
              <button type="button" onClick={tat} disabled={busy} className={`mr-auto ${modalButton.danger}`}>
                Tắt
              </button>
            )}
            <button
              type="button"
              onClick={test}
              disabled={busy || !settings?.configured}
              title={settings?.configured ? "Nhúng thử 1 câu ngắn (rất rẻ)" : "Lưu đủ cấu hình trước rồi mới thử được"}
              className={modalButton.secondary}
            >
              Thử model
            </button>
            <button type="button" onClick={onClose} className={modalButton.cancel}>
              Đóng
            </button>
            <button type="button" onClick={save} disabled={busy} className={modalButton.primary}>
              {busy ? "Đang lưu..." : "Lưu"}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <ModalField
            id="emb-model"
            label="Model embedding"
            hint="Bỏ trống = tắt. Ví dụ: text-embedding-3-small (OpenAI), gemini-embedding-001 (Google). Tên phải đúng như router/nhà cung cấp đặt."
          >
            <input
              id="emb-model"
              className="gc-input w-full"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="text-embedding-3-small"
            />
          </ModalField>

          <ModalField
            id="emb-base-url"
            label="Base URL"
            hint={
              settings?.muonBaseUrl
                ? "Đang dùng base URL của nhà cung cấp LLM chung. Chỉ điền khi muốn dùng endpoint khác."
                : "Endpoint OpenAI-compatible có /embeddings. Bỏ trống để dùng chung router LLM (nếu là openai-compatible)."
            }
          >
            <input
              id="emb-base-url"
              className="gc-input w-full"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
            />
          </ModalField>

          <ModalField
            id="emb-api-key"
            label="API key"
            hint={settings?.muonApiKey ? "Đang dùng API key của nhà cung cấp LLM chung." : undefined}
          >
            <SecretInput
              id="emb-api-key"
              value={apiKey}
              onChange={setApiKey}
              placeholder={
                settings?.hasApiKey ? `Hiện tại ${settings.apiKeyMasked} - bỏ trống để giữ` : "Bỏ trống để dùng key chung"
              }
            />
          </ModalField>
        </div>

        {tienDo && settings?.configured && (
          <div className="rounded-xl border border-line px-4 py-2.5 text-[13px] text-ink-soft">
            Đã tạo vector cho <b className="text-ink">{tienDo.daNhung}</b> / {tienDo.tong} đoạn.
            {tienDo.daNhung < tienDo.tong && " Phần còn lại đang được xử lý ở nền - trong lúc chờ bot vẫn tìm theo từ khóa."}
          </div>
        )}

        <div className="rounded-xl border border-amber-100 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/40 px-4 py-2.5 text-[12px] leading-[1.6] text-amber-800 dark:text-amber-200">
          Mỗi đoạn tài liệu và mỗi câu khách hỏi tốn một lượt gọi embedding (rất rẻ). Đổi model thì bot tự tạo lại
          vector cho toàn bộ kho. Ngưỡng khớp chỉnh ở trang Cấu hình, mục Kho tri thức.
        </div>

        {status && (
          <div
            className={`rounded-xl border px-4 py-2.5 text-[13px] ${
              status.tone === "green"
                ? "border-emerald-100 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300"
                : status.tone === "blue"
                  ? "border-sky-100 dark:border-sky-900/50 bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300"
                  : "border-red-100 dark:border-red-900/50 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300"
            }`}
          >
            {status.text}
          </div>
        )}
      </ToolModalShell>
      {confirmDialog}
    </>
  );
}

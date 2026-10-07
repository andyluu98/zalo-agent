import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

// Tìm lai bm25 + vector. Model embedding GIẢ: mỗi chiều là một "khái niệm",
// chữ nào chứa từ khóa của khái niệm thì chiều đó = 1. Đủ để dựng đúng ca tìm
// lai sinh ra để cứu: câu hỏi KHÔNG chung từ nào với tài liệu nhưng cùng ý.

let dataDir: string;
let store: typeof import("./kb-source-store.js");
let chunkStore: typeof import("./kb-chunk-store.js");
let binding: typeof import("./kb-agent-binding.js");
let search: typeof import("./kb-search.js");
let client: typeof import("./kb-embedding-client.js");
let worker: typeof import("./kb-embedding-worker.js");
let vectorStore: typeof import("./kb-vector-store.js");
let database: typeof import("../conversation/database.js");

const AGENT = "agent-a";
const KHAI_NIEM = [
  ["vận chuyển", "ship", "cước", "gửi đồ"],
  ["bảo hành", "hỏng", "sửa"],
  ["đổi trả", "trả lại"],
  ["mở cửa", "đóng cửa", "giờ"],
];

function nhungGia(model: string) {
  return async (texts: string[]) => ({
    model,
    vectors: texts.map((t) => {
      const thuong = t.toLowerCase();
      return Float32Array.from(KHAI_NIEM.map((tu) => (tu.some((w) => thuong.includes(w)) ? 1 : 0)));
    }),
  });
}

const TAI_LIEU = [
  "# Phí vận chuyển\n\nNội thành 20.000 đồng, ngoại thành 35.000 đồng.",
  "# Bảo hành\n\nBảo hành 12 tháng cho mọi sản phẩm.",
  "# Chính sách đổi trả\n\nĐổi trả trong vòng 7 ngày kể từ ngày nhận.",
  "# Giờ làm việc\n\nMở cửa 8h00, đóng cửa 21h00.",
];

let khoiPhuc: () => void = () => {};

before(async () => {
  dataDir = setupTestEnv({
    KB_EMBEDDING_BASE_URL: "http://embedding.test",
    KB_EMBEDDING_MODEL: "embed-a",
    KB_EMBEDDING_API_KEY: "k",
  });
  store = await import("./kb-source-store.js");
  chunkStore = await import("./kb-chunk-store.js");
  binding = await import("./kb-agent-binding.js");
  search = await import("./kb-search.js");
  client = await import("./kb-embedding-client.js");
  worker = await import("./kb-embedding-worker.js");
  vectorStore = await import("./kb-vector-store.js");
  database = await import("../conversation/database.js");
});

after(() => {
  khoiPhuc();
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

let nguonId = "";

beforeEach(async () => {
  for (const t of ["kb_sources", "kb_chunks", "kb_chunks_fts", "kb_chunk_vectors", "agent_kb_sources"]) {
    database.db.exec(`DELETE FROM ${t}`);
  }
  khoiPhuc();
  khoiPhuc = client.tiemHamNhungChoTest(nhungGia("embed-a"));
  worker.datLaiTrangThaiChoTest();
  const nguon = store.taoNguon({ ten: "cskh", loai: "text", noiDungGoc: TAI_LIEU.join("\n\n") });
  chunkStore.luuDoan(nguon.id, TAI_LIEU.map((noiDung, thuTu) => ({ thuTu, tieuDe: "", noiDung })));
  binding.datNguonChoAgent(AGENT, [nguon.id]);
  nguonId = nguon.id;
  assert.equal(await worker.nhungMotNhip(), TAI_LIEU.length);
});

describe("tìm lai bm25 + vector", () => {
  it("câu hỏi KHÔNG chung từ nào với tài liệu vẫn ra đúng đoạn nhờ vector", async () => {
    const kq = await search.timTrongKhoTriThuc({ cauHoi: "cước gửi đồ tính sao", agentId: AGENT, soLuong: 2 });
    assert.ok(kq.length >= 1, "phải tìm ra ít nhất một đoạn");
    assert.match(kq[0]!.noiDung, /Phí vận chuyển/);
  });

  it("đoạn dưới ngưỡng giống bị bỏ - câu hỏi lạc đề trả rỗng chứ không trả đoạn bừa", async () => {
    const kq = await search.timTrongKhoTriThuc({ cauHoi: "thời tiết hôm nay", agentId: AGENT });
    assert.deepEqual(kq, []);
  });

  it("embedding lỗi thì rơi về bm25, không ném", async () => {
    khoiPhuc();
    khoiPhuc = client.tiemHamNhungChoTest(async () => {
      throw new Error("router sập");
    });
    const kq = await search.timTrongKhoTriThuc({ cauHoi: "bảo hành", agentId: AGENT, soLuong: 1 });
    assert.match(kq[0]!.noiDung, /Bảo hành 12 tháng/);
    const khongRa = await search.timTrongKhoTriThuc({ cauHoi: "cước gửi đồ", agentId: AGENT });
    assert.deepEqual(khongRa, [], "không có vector thì câu khác chữ không ra - đúng hành vi cũ");
  });

  it("vector của model KHÁC bị bỏ qua lúc tìm và được worker sinh lại", async () => {
    khoiPhuc();
    khoiPhuc = client.tiemHamNhungChoTest(nhungGia("embed-b"));
    // Câu hỏi nhúng bằng embed-b, kho còn toàn vector embed-a -> vector không góp gì
    assert.deepEqual(await search.timTrongKhoTriThuc({ cauHoi: "cước gửi đồ", agentId: AGENT }), []);
    // Worker đọc model từ cấu hình (embed-a) nên không thấy thiếu; ghi thẳng lại bằng embed-b
    const thieu = vectorStore.layDoanThieuVector("embed-b", 100);
    assert.equal(thieu.length, TAI_LIEU.length);
  });

  it("chỉ tìm trong nguồn được gán cho agent", async () => {
    const kq = await search.timTrongKhoTriThuc({ cauHoi: "cước gửi đồ", agentId: "agent-chua-gan" });
    assert.deepEqual(kq, []);
  });
});

describe("vòng đời vector", () => {
  it("xóa nguồn thì xóa luôn vector", () => {
    store.xoaNguon(nguonId);
    const { n } = database.db.prepare("SELECT COUNT(*) AS n FROM kb_chunk_vectors").get() as { n: number };
    assert.equal(n, 0);
  });

  it("cắt lại tài liệu (luuDoan) thì vector cũ bị xóa và đoạn mới chờ nhúng", async () => {
    chunkStore.luuDoan(nguonId, [{ thuTu: 0, tieuDe: "", noiDung: "Bảo hành 24 tháng" }]);
    assert.equal(vectorStore.demTienDoNhung("embed-a").daNhung, 0);
    assert.equal(await worker.nhungMotNhip(), 1);
    assert.deepEqual(vectorStore.demTienDoNhung("embed-a"), { tong: 1, daNhung: 1 });
  });

  it("nhịp lỗi thì nghỉ, không gọi lại ngay nhịp sau", async () => {
    chunkStore.luuDoan(nguonId, [{ thuTu: 0, tieuDe: "", noiDung: "Bảo hành 24 tháng" }]);
    khoiPhuc();
    let soLanGoi = 0;
    khoiPhuc = client.tiemHamNhungChoTest(async () => {
      soLanGoi++;
      throw new Error("401");
    });
    assert.equal(await worker.nhungMotNhip(), 0);
    assert.equal(await worker.nhungMotNhip(), 0);
    assert.equal(soLanGoi, 1);
  });
});

describe("cosine", () => {
  it("vector toàn 0 trả 0, không NaN", () => {
    assert.equal(vectorStore.cosine(new Float32Array([0, 0]), new Float32Array([1, 0])), 0);
    assert.ok(Math.abs(vectorStore.cosine(new Float32Array([1, 1]), new Float32Array([2, 2])) - 1) < 1e-6);
  });
});

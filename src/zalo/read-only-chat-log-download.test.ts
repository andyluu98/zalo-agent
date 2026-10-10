import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { ThreadType, type API } from "zca-js";
import { doiChoDenKhi } from "../shared/doi-cho-den-khi.js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
import type { RemoteFile } from "../shared/safe-remote-download.js";
import type { ParsedMessage } from "./zalo-message-parser.js";

/**
 * B3: dòng log ghi TRƯỚC khi tải tệp; tải treo/hỏng không giữ hàng ghi log của
 * thread, tin sau vẫn ghi. setupTestEnv trước rồi mới import động (chạm env/DB).
 */
let dataDir: string;
let chatLog: typeof import("./read-only-chat-log.js");
let database: typeof import("../conversation/database.js");
let DuongDanLog: typeof import("../conversation/log-paths.js").DuongDanLog;

before(async () => {
  dataDir = setupTestEnv({ CHAT_EXPORT_DAILY_MB_PER_SENDER: "1" });
  chatLog = await import("./read-only-chat-log.js");
  database = await import("../conversation/database.js");
  ({ DuongDanLog } = await import("../conversation/log-paths.js"));
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

const ACC = "acc-tai-tep";
const NGAY = "2026-10-10";
const msg = (msgId: string, over: Partial<ParsedMessage> = {}): ParsedMessage => ({
  accountId: ACC,
  threadId: "nhom-1",
  threadType: ThreadType.Group,
  isGroup: true,
  senderId: "nguoi-gui",
  senderName: "A",
  text: `tin ${msgId}`,
  images: [],
  msgId,
  cliMsgId: msgId,
  isSelf: false,
  mentionsMe: false,
  sentAt: "2026-10-10T03:00:00Z",
  rawData: {},
  ...over,
});

const docJsonl = (): Record<string, any>[] => {
  const f = new DuongDanLog(path.join(dataDir, "exports")).jsonl(ACC, NGAY);
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
};

describe("ghiLogChiDoc: tải tệp không chặn hàng ghi log", () => {
  it("dòng tin ghi TRƯỚC khi tải xong; tải treo không chặn tin sau cùng thread; xong thì ghi bổ sung", async () => {
    let nhaTai!: (f: RemoteFile) => void;
    let batDauTai = 0;
    const taiTreo = (): Promise<RemoteFile> => {
      batDauTai++;
      return new Promise((r) => {
        nhaTai = r;
      });
    };
    const api = {} as unknown as API;
    chatLog.ghiLogChiDoc(
      ACC,
      api,
      msg("m1", { loaiTin: "anh", images: [{ url: "https://photo-stal-1.zdn.vn/a.jpg" }] }),
      Promise.resolve("Nhóm thử"),
      taiTreo,
    );
    chatLog.ghiLogChiDoc(ACC, api, msg("m2"), Promise.resolve("Nhóm thử"), taiTreo);

    await doiChoDenKhi(() => docJsonl().filter((d) => d.loai === "tin").length === 2, { moTa: "2 dòng tin" });
    const [m1, m2] = docJsonl();
    assert.equal(m1?.msgId, "m1");
    assert.equal(m2?.msgId, "m2");
    assert.deepEqual(m1?.tepDaLuu?.map((t: { dangTai?: boolean }) => t.dangTai), [true], "dòng ghi lúc tệp còn đang tải");
    await doiChoDenKhi(() => batDauTai === 1, { moTa: "bộ tải được gọi" });
    assert.equal(docJsonl().some((d) => d.loai === "tep_bo_sung"), false, "tải chưa xong thì chưa có bổ sung");

    nhaTai({ data: Buffer.alloc(5, 1), mediaType: "image/jpeg", fileName: "x" });
    await doiChoDenKhi(() => docJsonl().some((d) => d.loai === "tep_bo_sung"), { moTa: "bản ghi bổ sung" });
    const bs = docJsonl().find((d) => d.loai === "tep_bo_sung");
    assert.equal(bs?.msgId, "m1");
    assert.match(bs?.tepDaLuu?.[0]?.duongDan ?? "", /^tep\/\d{4}_anh-m1\.jpg$/);
  });

  it("tải hỏng: dòng tin vẫn có, bản bổ sung ghi lỗi, tin sau vẫn ghi", async () => {
    const api = {} as unknown as API;
    const hong = async (): Promise<RemoteFile> => {
      throw new Error("HTTP 500");
    };
    chatLog.ghiLogChiDoc(
      ACC,
      api,
      msg("m3", { loaiTin: "anh", images: [{ url: "https://photo-stal-2.zdn.vn/a.jpg" }] }),
      Promise.resolve("Nhóm thử"),
      hong,
    );
    chatLog.ghiLogChiDoc(ACC, api, msg("m4"), Promise.resolve("Nhóm thử"), hong);
    await doiChoDenKhi(
      () => docJsonl().some((d) => d.loai === "tep_bo_sung" && d.msgId === "m3") && docJsonl().some((d) => d.msgId === "m4"),
      { moTa: "m3 bổ sung + m4" },
    );
    const bs = docJsonl().find((d) => d.loai === "tep_bo_sung" && d.msgId === "m3");
    assert.match(bs?.tepDaLuu?.[0]?.loi ?? "", /HTTP 500/);
  });

  it("URL ngoài CDN Zalo: không bao giờ gọi bộ tải", async () => {
    let goi = 0;
    chatLog.ghiLogChiDoc(
      ACC,
      {} as unknown as API,
      msg("m5", { loaiTin: "video", dinhKem: { ten: "hoa-don.hta", url: "https://evil.example/x" } }),
      Promise.resolve("Nhóm thử"),
      async () => {
        goi++;
        return { data: Buffer.alloc(1), mediaType: "video/mp4", fileName: "x" };
      },
    );
    await doiChoDenKhi(() => docJsonl().some((d) => d.loai === "tep_bo_sung" && d.msgId === "m5"), { moTa: "bổ sung m5" });
    assert.equal(goi, 0);
  });

  it("vượt hạn mức MB/ngày của người gửi: tệp sau không tải, ghi lý do; người khác vẫn tải", async () => {
    let goi = 0;
    const tai = async (): Promise<RemoteFile> => {
      goi++;
      return { data: Buffer.alloc(1024 * 1024 + 1, 1), mediaType: "image/jpeg", fileName: "x" };
    };
    const anh = (id: string, nguoi: string): ParsedMessage =>
      msg(id, { senderId: nguoi, loaiTin: "anh", images: [{ url: "https://photo-stal-3.zdn.vn/a.jpg" }] });
    chatLog.ghiLogChiDoc(ACC, {} as unknown as API, anh("q1", "nguoi-spam"), Promise.resolve("Nhóm thử"), tai);
    await doiChoDenKhi(() => docJsonl().some((d) => d.loai === "tep_bo_sung" && d.msgId === "q1"), { moTa: "q1" });
    chatLog.ghiLogChiDoc(ACC, {} as unknown as API, anh("q2", "nguoi-spam"), Promise.resolve("Nhóm thử"), tai);
    await doiChoDenKhi(() => docJsonl().some((d) => d.loai === "tep_bo_sung" && d.msgId === "q2"), { moTa: "q2" });
    assert.equal(goi, 2 - 1, "q2 bị chặn trước khi tải");
    const q2 = docJsonl().find((d) => d.loai === "tep_bo_sung" && d.msgId === "q2");
    assert.match(q2?.tepDaLuu?.[0]?.loi ?? "", /hết hạn mức 1 MB\/ngày của người gửi/);
    chatLog.ghiLogChiDoc(ACC, {} as unknown as API, anh("q3", "nguoi-khac"), Promise.resolve("Nhóm thử"), tai);
    await doiChoDenKhi(() => docJsonl().some((d) => d.loai === "tep_bo_sung" && d.msgId === "q3"), { moTa: "q3" });
    assert.equal(goi, 2);
    assert.ok(docJsonl().find((d) => d.loai === "tep_bo_sung" && d.msgId === "q3")?.tepDaLuu?.[0]?.duongDan);
  });
});

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { AccountConfig } from "../../config/account-store.js";
import { fakeAgentProfile } from "../../shared/fake-agent-profile.js";
import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";
import type { ParsedMessage } from "../../zalo/zalo-message-parser.js";
import { ketQuaThanhCong, loiCuaTool } from "./tool-failure-result-test-helper.js";

let dataDir: string;
let handoff: typeof import("./handoff-to-human-tool.js");
let threadStore: typeof import("../../conversation/thread-store.js");
let handoffStore: typeof import("../../conversation/thread-handoff-store.js");
let database: typeof import("../../conversation/database.js");

const ACC = "acc-1";
const KHACH = "khach-1";
const CHU = "chu-shop-9";

before(async () => {
  dataDir = setupTestEnv();
  handoff = await import("./handoff-to-human-tool.js");
  threadStore = await import("../../conversation/thread-store.js");
  handoffStore = await import("../../conversation/thread-handoff-store.js");
  database = await import("../../conversation/database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

beforeEach(() => {
  database.db.exec("DELETE FROM threads");
  threadStore.recordThreadActivity({
    accountId: ACC,
    threadId: KHACH,
    threadType: 0,
    displayName: "Lan",
    lastSenderName: "Lan",
  });
});

function ctx(handoffNotifyUserId = CHU) {
  return {
    api: null,
    account: { id: ACC, disabledTools: [], loai: "ca_nhan", handoffNotifyUserId } as unknown as AccountConfig,
    agent: fakeAgentProfile(),
    message: { accountId: ACC, threadId: KHACH, isGroup: false, senderName: "Lan" } as ParsedMessage,
    batch: [],
  };
}

type TinDaGui = { accountId: string; nguoiNhanId: string; noiDung: string };

function chay(guiBao: (a: string, n: string, t: string) => Promise<void>, c = ctx()) {
  const t = handoff.createHandoffToHumanTool(c, guiBao) as unknown as {
    execute: (input: unknown, opts: unknown) => Promise<unknown>;
  };
  return t.execute({ ly_do: "Khách đòi hoàn tiền", tom_tat: "Đơn #12 giao thiếu 1 món" }, {});
}

describe("handoff_to_human", () => {
  it("tắt bot ở thread, ghi dấu cho dashboard và nhắn báo đúng người vận hành", async () => {
    const daGui: TinDaGui[] = [];
    const kq = await chay(async (accountId, nguoiNhanId, noiDung) => {
      daGui.push({ accountId, nguoiNhanId, noiDung });
    });
    assert.match(ketQuaThanhCong(kq), /đã nhắn báo/);
    assert.equal(threadStore.isBotEnabled(ACC, KHACH), false);
    assert.equal(handoffStore.dangChoNguoiThat(ACC, KHACH), true);
    assert.equal(daGui.length, 1);
    assert.equal(daGui[0]!.nguoiNhanId, CHU);
    assert.match(daGui[0]!.noiDung, /Lan \(ID khach-1\)/);
    assert.match(daGui[0]!.noiDung, /Khách đòi hoàn tiền/);
    assert.match(daGui[0]!.noiDung, /Đơn #12/);
    const row = threadStore.listThreads({ accountId: ACC })[0]!;
    assert.equal(row.handoffReason, "Khách đòi hoàn tiền");
    assert.ok(row.handoffAt);
  });

  it("gọi lần hai trong cùng lượt không nhắn báo lần nữa", async () => {
    let soLan = 0;
    const gui = async () => {
      soLan++;
    };
    await chay(gui);
    const kq = await chay(gui);
    assert.match(ketQuaThanhCong(kq), /đã được chuyển/);
    assert.equal(soLan, 1);
  });

  it("nhắn báo hỏng thì bot VẪN tạm dừng, tool không ném và nói thật là chưa báo được", async () => {
    const kq = await chay(async () => {
      throw new Error("account không chạy");
    });
    assert.match(ketQuaThanhCong(kq), /chưa nhắn báo được/);
    assert.equal(threadStore.isBotEnabled(ACC, KHACH), false);
  });

  it("người vận hành tự thử trong chính chat của mình thì không nhắn báo vào đó", async () => {
    let soLan = 0;
    await chay(async () => {
      soLan++;
    }, ctx(KHACH));
    assert.equal(soLan, 0);
    assert.equal(threadStore.isBotEnabled(ACC, KHACH), false);
  });

  it("thread chưa có trong DB thì trả lỗi có đánh dấu, không ném", async () => {
    database.db.exec("DELETE FROM threads");
    const kq = await chay(async () => {});
    assert.match(loiCuaTool(kq), /Không tìm thấy cuộc chat/);
  });

  it("bật lại bot trên dashboard thì xóa dấu chờ người, tắt tay thì giữ", async () => {
    await chay(async () => {});
    threadStore.setBotEnabled(ACC, KHACH, false);
    assert.equal(handoffStore.dangChoNguoiThat(ACC, KHACH), true);
    threadStore.setBotEnabled(ACC, KHACH, true);
    assert.equal(handoffStore.dangChoNguoiThat(ACC, KHACH), false);
    assert.equal(threadStore.listThreads({ accountId: ACC })[0]!.handoffReason, "");
  });
});

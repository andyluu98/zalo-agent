import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ThreadType, type API, type Message } from "zca-js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

/** setupTestEnv() trước rồi mới import - lifecycle bắc cầu tới database.ts */
let dataDir: string;
let store: typeof import("../config/account-store.js");
let lifecycle: typeof import("./read-only-lifecycle.js");
let chatLog: typeof import("./read-only-chat-log.js");
let database: typeof import("../conversation/database.js");

before(async () => {
  dataDir = setupTestEnv();
  store = await import("../config/account-store.js");
  lifecycle = await import("./read-only-lifecycle.js");
  chatLog = await import("./read-only-chat-log.js");
  database = await import("../conversation/database.js");
  store.createAccount({ id: "acc-doc", label: "Chỉ đọc" });
  store.updateAccount("acc-doc", { readOnly: true });
  store.createAccount({ id: "acc-thuong", label: "Thường" });
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

const tin = (msgId: string): Message => ({ data: { msgId }, threadId: "t", isSelf: false }) as unknown as Message;
const fakeApi = (goi: unknown[][]): API =>
  ({ listener: { requestOldMessages: (...a: unknown[]) => goi.push(a) } }) as unknown as API;

describe("taiBu", () => {
  it("chỉ đưa vào router tin mới hơn msgId cuối, theo thứ tự tăng dần", () => {
    chatLog.laySoTrangThai().ghiNhanTin("acc-doc", "group", "200", "2026-10-06T01:00:00Z");
    const daRoute: string[] = [];
    const so = lifecycle.taiBu(
      "acc-doc",
      fakeApi([]),
      "self",
      [tin("203"), tin("199"), tin("200"), tin("1000"), tin("201")],
      ThreadType.Group,
      (_acc, _api, _self, raw) => {
        daRoute.push(String((raw as Message).data.msgId));
      },
    );
    assert.equal(so, 3);
    assert.deepEqual(daRoute, ["201", "203", "1000"]);
    assert.equal(chatLog.laySoTrangThai().doc("acc-doc").taiBu?.soTin, 3);
  });

  it("account không bật chỉ đọc thì không tải bù gì (không để bot trả lời tin cũ)", () => {
    let goi = 0;
    const so = lifecycle.taiBu("acc-thuong", fakeApi([]), "self", [tin("5")], ThreadType.User, () => {
      goi++;
    });
    assert.equal(so, 0);
    assert.equal(goi, 0);
  });
});

describe("mocChiDoc", () => {
  it("khi kết nối: ghi trạng thái và xin tải bù từ msgId cuối của từng loại", () => {
    chatLog.laySoTrangThai().ghiNhanTin("acc-doc", "user", "77", "2026-10-06T01:00:00Z");
    const goi: unknown[][] = [];
    const moc = lifecycle.mocChiDoc("acc-doc", fakeApi(goi), "self");
    moc.onConnected?.();
    assert.equal(chatLog.laySoTrangThai().doc("acc-doc").tinhTrang, "dang_ket_noi");
    // "200": ca tải bù ở trên dùng route GIẢ nên không ghi nhận msgId mới - route
    // thật ghi nhận qua ghiLogChiDoc
    assert.deepEqual(goi, [
      [ThreadType.User, "77"],
      [ThreadType.Group, "200"],
    ]);
    moc.onClosed?.(1006, "");
    assert.equal(chatLog.laySoTrangThai().doc("acc-doc").tinhTrang, "mat_ket_noi");
    lifecycle.danhDauDung("acc-doc");
    assert.equal(chatLog.laySoTrangThai().doc("acc-doc").tinhTrang, "da_dung");
  });

  it("lần chạy đầu chưa có msgId nào thì không xin tải bù", () => {
    store.createAccount({ id: "acc-moi", label: "Mới" });
    store.updateAccount("acc-moi", { readOnly: true });
    const goi: unknown[][] = [];
    lifecycle.mocChiDoc("acc-moi", fakeApi(goi), "self").onConnected?.();
    assert.deepEqual(goi, []);
  });
});

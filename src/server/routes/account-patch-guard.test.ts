import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Hono } from "hono";
import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";
import { kiemTuKetBanVaChiDoc } from "./account-patch-guard.js";

describe("kiemTuKetBanVaChiDoc", () => {
  it("từ chối cả hai chiều và khi PATCH bật cả hai", () => {
    assert.notEqual(kiemTuKetBanVaChiDoc({ readOnly: true }, { autoAcceptFriends: true }), null);
    assert.notEqual(kiemTuKetBanVaChiDoc({ autoAcceptFriends: true }, { readOnly: true }), null);
    assert.notEqual(kiemTuKetBanVaChiDoc({}, { readOnly: true, autoAcceptFriends: true }), null);
  });

  it("cho qua các tổ hợp hợp lệ, và PATCH không đụng hai trường", () => {
    assert.equal(kiemTuKetBanVaChiDoc({ readOnly: true }, { autoAcceptFriends: false }), null);
    assert.equal(kiemTuKetBanVaChiDoc({ autoAcceptFriends: true }, { readOnly: false }), null);
    assert.equal(kiemTuKetBanVaChiDoc({ readOnly: true, autoAcceptFriends: true }, { readOnly: false }), null);
    assert.equal(kiemTuKetBanVaChiDoc({}, { readOnly: true }), null);
    assert.equal(kiemTuKetBanVaChiDoc({}, { autoAcceptFriends: true }), null);
    // tài khoản cũ lỡ cả hai: sửa trường khác không bị kẹt
    assert.equal(kiemTuKetBanVaChiDoc({ readOnly: true, autoAcceptFriends: true }, {}), null);
  });
});

describe("PATCH /api/accounts/:id", () => {
  let dataDir: string;
  let app: Hono;
  let cookie: string;
  let store: typeof import("../../config/account-store.js");
  let database: typeof import("../../conversation/database.js");
  const PASSWORD = "mat-khau-patch-123";

  before(async () => {
    dataDir = setupTestEnv({ DASHBOARD_PASSWORD: PASSWORD });
    const { buildDashboardApp } = await import("../dashboard-server.js");
    app = buildDashboardApp();
    store = await import("../../config/account-store.js");
    database = await import("../../conversation/database.js");
    store.createAccount({ id: "acc-chi-doc", label: "Chỉ đọc" });
    store.updateAccount("acc-chi-doc", { readOnly: true });
    store.createAccount({ id: "acc-tu-ket-ban", label: "Tự kết bạn" });
    store.updateAccount("acc-tu-ket-ban", { autoAcceptFriends: true });
    const login = await app.request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password: PASSWORD }),
      headers: { "content-type": "application/json" },
    });
    cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  });

  after(() => {
    database.closeDatabase();
    cleanupTestEnv(dataDir);
  });

  const patch = (id: string, body: unknown) =>
    app.request(`/api/accounts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", cookie },
    });

  it("bật tự kết bạn trên tài khoản chỉ đọc -> 400 và KHÔNG ghi DB", async () => {
    const res = await patch("acc-chi-doc", { autoAcceptFriends: true });
    assert.equal(res.status, 400);
    assert.equal(store.getAccount("acc-chi-doc")?.autoAcceptFriends, false);
  });

  it("bật chỉ đọc trên tài khoản đang tự kết bạn -> 400 và KHÔNG ghi DB", async () => {
    const res = await patch("acc-tu-ket-ban", { readOnly: true });
    assert.equal(res.status, 400);
    assert.equal(store.getAccount("acc-tu-ket-ban")?.readOnly ?? false, false);
  });

  it("tắt một bên rồi bật bên kia thì được", async () => {
    assert.equal((await patch("acc-chi-doc", { readOnly: false })).status, 200);
    assert.equal((await patch("acc-chi-doc", { autoAcceptFriends: true })).status, 200);
    assert.equal(store.getAccount("acc-chi-doc")?.autoAcceptFriends, true);
  });
});

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Hono } from "hono";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
import type { YeuCauCanKiem } from "./csrf-guard.js";

/** csrf-guard kéo env.js: phải setupTestEnv TRƯỚC khi import (không import tĩnh) */
const PASSWORD = "mat-khau-csrf-123";
const dataDir = setupTestEnv({ DASHBOARD_PASSWORD: PASSWORD });
const { kiemCsrf } = await import("./csrf-guard.js");

const goc: YeuCauCanKiem = {
  method: "POST",
  path: "/api/accounts/x",
  origin: "http://127.0.0.1:3900",
  host: "127.0.0.1:3900",
  forwardedHost: undefined,
  secFetchSite: "same-origin",
  contentType: "application/json",
  coThan: true,
};
const voi = (over: Partial<YeuCauCanKiem>, proxy = false) => kiemCsrf({ ...goc, ...over }, proxy);

describe("kiemCsrf (hàm thuần)", () => {
  it("request hợp lệ: Origin khớp Host + JSON", () => {
    assert.equal(voi({}), null);
    assert.equal(voi({ contentType: "application/json; charset=utf-8" }), null);
    assert.equal(voi({ contentType: "APPLICATION/JSON" }), null);
    assert.equal(voi({ method: "PATCH" }), null);
    assert.equal(voi({ method: "DELETE", contentType: undefined, coThan: false }), null);
  });

  it("GET/HEAD/OPTIONS không bị kiểm", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      assert.equal(voi({ method, origin: "https://evil.example", contentType: "text/plain" }), null);
    }
  });

  it("Origin lạ, khác cổng, null, rác -> 403", () => {
    for (const origin of ["https://evil.example", "http://127.0.0.1:4000", "http://localhost:3900", "null", "khong-phai-url", ""]) {
      assert.equal(voi({ origin })?.status, 403, origin);
    }
  });

  it("không Origin: client ngoài trình duyệt qua được; Sec-Fetch-Site cross-site thì chặn", () => {
    assert.equal(voi({ origin: undefined, secFetchSite: undefined }), null);
    assert.equal(voi({ origin: undefined, secFetchSite: "none" }), null);
    assert.equal(voi({ origin: undefined, secFetchSite: "cross-site" })?.status, 403);
    assert.equal(voi({ origin: undefined, secFetchSite: "same-site" })?.status, 403);
  });

  it("Content-Type không phải JSON (text/plain, form) -> 415, kể cả khi Origin đúng", () => {
    for (const contentType of ["text/plain", "application/x-www-form-urlencoded", "text/plain;charset=UTF-8", "application/jsonx"]) {
      assert.equal(voi({ contentType })?.status, 415, contentType);
    }
    assert.equal(voi({ contentType: undefined, coThan: true })?.status, 415, "có thân mà không khai kiểu");
  });

  it("multipart chỉ được ở route upload Kho tri thức", () => {
    assert.equal(voi({ path: "/api/kb/sources/file", contentType: "multipart/form-data; boundary=x" }), null);
    assert.equal(voi({ path: "/api/accounts/x", contentType: "multipart/form-data; boundary=x" })?.status, 415);
    assert.equal(voi({ method: "PUT", path: "/api/kb/sources/file", contentType: "multipart/form-data" })?.status, 415);
    // multipart vẫn phải qua lớp Origin
    assert.equal(voi({ path: "/api/kb/sources/file", contentType: "multipart/form-data", origin: "https://evil.example" })?.status, 403);
  });

  it("sau proxy: chấp nhận X-Forwarded-Host; không proxy thì bỏ qua header đó", () => {
    const r = { origin: "https://bot.example.com", host: "127.0.0.1:3900", forwardedHost: "bot.example.com" };
    assert.equal(voi(r, true), null);
    assert.equal(voi(r, false)?.status, 403);
    assert.equal(voi({ ...r, forwardedHost: "evil.example" }, true)?.status, 403);
  });
});

describe("csrfGuard trong dashboard", () => {
  let app: Hono;
  let cookie: string;
  let database: typeof import("../conversation/database.js");

  before(async () => {
    const { buildDashboardApp } = await import("./dashboard-server.js");
    app = buildDashboardApp();
    database = await import("../conversation/database.js");
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

  const goi = (headers: Record<string, string>, body: string | undefined = "{}") =>
    app.request("http://127.0.0.1:3900/api/auth/password", { method: "POST", body, headers: { cookie, ...headers } });

  it("POST từ Origin lạ bị 403 TRƯỚC khi đụng logic (kể cả có cookie hợp lệ)", async () => {
    const res = await goi({ "content-type": "application/json", origin: "http://127.0.0.1:4000", host: "127.0.0.1:3900" });
    assert.equal(res.status, 403);
  });

  it("POST text/plain bị 415 dù Origin đúng", async () => {
    const res = await goi({ "content-type": "text/plain", origin: "http://127.0.0.1:3900", host: "127.0.0.1:3900" });
    assert.equal(res.status, 415);
  });

  it("POST đúng Origin + JSON đi tiếp tới route (401 do thiếu session, không phải 403/415)", async () => {
    const res = await goi({ "content-type": "application/json", origin: "http://127.0.0.1:3900", host: "127.0.0.1:3900" });
    assert.equal(res.status, 401);
  });

  it("login cũng được bảo vệ", async () => {
    const res = await app.request("http://127.0.0.1:3900/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password: PASSWORD }),
      headers: { "content-type": "application/json", origin: "https://evil.example", host: "127.0.0.1:3900" },
    });
    assert.equal(res.status, 403);
  });

  it("GET vẫn chạy với Origin lạ (đọc không đổi trạng thái)", async () => {
    const res = await app.request("http://127.0.0.1:3900/api/auth/me", {
      headers: { cookie, origin: "https://evil.example" },
    });
    assert.equal(res.status, 200);
  });
});

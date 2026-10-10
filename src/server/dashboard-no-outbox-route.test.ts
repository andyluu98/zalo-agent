import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import type { Hono } from "hono";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

/**
 * R7: dashboard (cổng 3900, đăng nhập bằng cookie) KHÔNG được có đường duyệt / tạo / hủy tin
 * hộp thư đi. Duyệt chỉ qua CLI `pnpm outbox approve` (khóa HMAC nằm ngoài tầm dashboard):
 * thêm route ở đây là biến "vào được web" thành "gửi được tin Zalo".
 */

let dataDir: string;
let app: Hono;
let cookie: string;

before(async () => {
  dataDir = setupTestEnv({ DASHBOARD_PASSWORD: "mat-khau-test-123" });
  const { buildDashboardApp } = await import("./dashboard-server.js");
  app = buildDashboardApp();
  const login = await app.request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ password: "mat-khau-test-123" }),
    headers: { "content-type": "application/json" },
  });
  cookie = login.headers.get("set-cookie")!.split(";")[0]!;
});

after(async () => {
  const { closeDatabase } = await import("../conversation/database.js");
  closeDatabase();
  cleanupTestEnv(dataDir);
});

describe("dashboard không có route duyệt tin hộp thư đi", () => {
  const duongDan = [
    "/api/outbox",
    "/api/outbox/approve",
    "/api/outbox/acc/abc/approve",
    "/api/outbox/acc/abc/cancel",
    "/api/hop-thu-di",
    "/api/hop-thu-di/approve",
    "/api/accounts/acc/outbox/approve",
  ];

  it("đã đăng nhập vẫn 404 với mọi phương thức ghi / đọc", async () => {
    for (const p of duongDan) {
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
        const res = await app.request(p, {
          method,
          headers: { cookie, "content-type": "application/json" },
          ...(method === "GET" ? {} : { body: "{}" }),
        });
        assert.equal(res.status, 404, `${method} ${p} -> ${res.status}`);
      }
    }
  });

  it("không file nào trong src/server (trừ test) nhắc tới outbox / hop-thu-di", () => {
    const goc = path.resolve(fileURLToPath(import.meta.url), "..");
    const quet = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return quet(p);
        return e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") ? [p] : [];
      });
    const phamLuat = quet(goc).filter((f) => /outbox|hop-thu-di/i.test(fs.readFileSync(f, "utf8")));
    assert.deepEqual(phamLuat, []);
  });
});

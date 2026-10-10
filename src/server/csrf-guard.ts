import type { MiddlewareHandler } from "hono";
import { env } from "../config/env.js";

/**
 * Chống CSRF cho API dashboard (`/api/*`).
 *
 * Mối đe dọa thật: cookie phiên là `SameSite=Lax`, mà "site" KHÔNG tính cổng -
 * một trang ở `127.0.0.1:<cổng khác>` (hay `localhost:<cổng>`) bị XSS/độc hại
 * gọi được `fetch("http://127.0.0.1:3900/api/...", {credentials:"include"})`
 * và trình duyệt vẫn gửi cookie của chủ máy. Hai lớp chặn cho request GHI
 * (mọi method trừ GET/HEAD/OPTIONS):
 *  1. `Origin` (trình duyệt luôn gửi cho POST/PUT/PATCH/DELETE, trang web không
 *     sửa được) phải trùng host của chính dashboard. Không có `Origin` thì chỉ
 *     qua khi `Sec-Fetch-Site` không báo cross-site: đó là client ngoài trình
 *     duyệt (curl, test), không phải CSRF.
 *  2. Có `Content-Type` thì phải là JSON: `text/plain` / form là "simple
 *     request", trang lạ gửi được không cần preflight. Ngoại lệ DUY NHẤT là
 *     upload multipart của Kho tri thức (vẫn qua lớp 1).
 */

/** Route thật sự nhận multipart (đã rà `parseBody` trong src/server) */
const ROUTE_MULTIPART = new Set(["POST /api/kb/sources/file"]);

export type YeuCauCanKiem = {
  method: string;
  path: string;
  origin: string | undefined;
  host: string | undefined;
  forwardedHost: string | undefined;
  secFetchSite: string | undefined;
  contentType: string | undefined;
  /** Request có thân (content-length > 0 hoặc transfer-encoding) */
  coThan: boolean;
};

export type KetQuaCsrf = { status: 403 | 415; error: string } | null;

export function kiemCsrf(r: YeuCauCanKiem, dungProxy: boolean): KetQuaCsrf {
  const method = r.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return null;

  if (r.origin !== undefined) {
    if (!originKhopHost(r.origin, [r.host, dungProxy ? r.forwardedHost : undefined])) {
      return { status: 403, error: "Origin không khớp dashboard" };
    }
  } else if (r.secFetchSite !== undefined && r.secFetchSite !== "same-origin" && r.secFetchSite !== "none") {
    return { status: 403, error: "Request ghi từ trang khác bị chặn" };
  }

  const ct = (r.contentType ?? "").split(";")[0]!.trim().toLowerCase();
  if (ct === "" && !r.coThan) return null; // DELETE / POST không thân: không có gì để giả dạng
  if (ct === "application/json") return null;
  if (ct === "multipart/form-data" && ROUTE_MULTIPART.has(`${method} ${r.path}`)) return null;
  return { status: 415, error: "Request ghi phải có Content-Type: application/json" };
}

function originKhopHost(origin: string, hostChoPhep: (string | undefined)[]): boolean {
  let host: string;
  try {
    host = new URL(origin).host.toLowerCase(); // "null" (iframe sandbox) ném lỗi -> bị từ chối
  } catch {
    return false;
  }
  return hostChoPhep.some((h) => h !== undefined && h.trim().toLowerCase() === host);
}

export const csrfGuard: MiddlewareHandler = async (c, next) => {
  const lenh = c.req.header("content-length");
  const ketQua = kiemCsrf(
    {
      method: c.req.method,
      path: c.req.path,
      origin: c.req.header("origin"),
      host: c.req.header("host") ?? new URL(c.req.url).host,
      forwardedHost: c.req.header("x-forwarded-host")?.split(",")[0],
      secFetchSite: c.req.header("sec-fetch-site"),
      contentType: c.req.header("content-type"),
      coThan: (lenh !== undefined && lenh !== "0") || c.req.header("transfer-encoding") !== undefined,
    },
    env.DASHBOARD_BEHIND_PROXY,
  );
  if (ketQua) return c.json({ error: ketQua.error }, ketQua.status);
  await next();
};

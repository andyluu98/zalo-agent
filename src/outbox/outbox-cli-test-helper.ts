import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TinHopThu } from "./outbox-file-store.js";
import { ACC, NHOM, RIENG } from "./outbox-test-helper.js";

/**
 * Chạy CLI `scripts/outbox.ts` THẬT bằng tiến trình con, với CHAT_EXPORT_DIR và
 * DATA_DIR là thư mục tạm. Không bao giờ đụng F:\Zalo-Logs hay data/ thật:
 * cwd là thư mục tạm (nên .env của repo không được nạp) và hai biến trên set cứng.
 */

const SCRIPT = path.resolve(fileURLToPath(import.meta.url), "../../../scripts/outbox.ts");
const TSX = import.meta.resolve("tsx");

export type MoiTruongCli = ReturnType<typeof taoMoiTruongCli>;

export function taoMoiTruongCli(extraEnv: Record<string, string> = {}) {
  const goc = fs.mkdtempSync(path.join(os.tmpdir(), "outbox-cli-log-"));
  const duLieu = fs.mkdtempSync(path.join(os.tmpdir(), "outbox-cli-data-"));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "outbox-cli-cwd-"));
  const dirDanhBa = path.join(goc, ACC, "_du-lieu");
  fs.mkdirSync(dirDanhBa, { recursive: true });
  fs.writeFileSync(
    path.join(dirDanhBa, "danh-ba.json"),
    JSON.stringify({
      threads: { [NHOM]: { ten: "Nhóm A", laNhom: true }, [RIENG]: { ten: "Người B", laNhom: false } },
      nguoi: { "555": { ten: "Hải" } },
    }),
  );

  function chay(args: string[]): { status: number | null; stdout: string; stderr: string } {
    const r = spawnSync(process.execPath, ["--import", TSX, SCRIPT, "--account", ACC, ...args], {
      cwd,
      encoding: "utf8",
      timeout: 60_000,
      env: {
        PATH: process.env.PATH ?? "",
        SystemRoot: process.env.SystemRoot ?? "",
        NODE_ENV: "test",
        LOG_LEVEL: "error",
        LOG_FILE_ENABLED: "false",
        DATA_DIR: duLieu,
        CHAT_EXPORT_DIR: goc,
        CREDENTIALS_ENCRYPTION_KEY: "0".repeat(64),
        LLM_PROVIDER: "anthropic",
        LLM_API_KEY: "test-key",
        LLM_MODEL: "test-model",
        ...extraEnv,
      },
    });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  }

  /** Đường dẫn hộp thư đi của account thử */
  const hopThu = path.join(goc, "hop-thu-di", ACC);
  const dsFile = (): string[] => (fs.existsSync(hopThu) ? fs.readdirSync(hopThu).filter((f) => f.endsWith(".json")) : []);
  const docTin = (id: string) => JSON.parse(fs.readFileSync(path.join(hopThu, `${id}.json`), "utf8")) as TinHopThu;
  const idDauTien = (): string => dsFile()[0]!.replace(/\.json$/, "");

  function don(): void {
    for (const d of [goc, duLieu, cwd]) fs.rmSync(d, { recursive: true, force: true });
  }

  return { goc, duLieu, cwd, chay, hopThu, dsFile, docTin, idDauTien, don };
}

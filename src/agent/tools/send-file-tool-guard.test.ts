import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import type { API } from "zca-js";
import { ThreadType } from "zca-js";
import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";
import { ketQuaThanhCong, loiCuaTool } from "./tool-failure-result-test-helper.js";
import type { AccountConfig } from "../../config/account-store.js";
import type { ParsedMessage } from "../../zalo/zalo-message-parser.js";

/** A2 cho tool send_file của agent: kho shared-files cũng giải symlink / junction, không rò ra ngoài */

let dataDir: string;
let sendFile: typeof import("./send-file-tool.js");
let database: typeof import("../../conversation/database.js");
let daGui: { msg?: string; attachments?: string[] }[] = [];

before(async () => {
  dataDir = setupTestEnv();
  sendFile = await import("./send-file-tool.js");
  database = await import("../../conversation/database.js");
});
after(() => {
  // Gỡ chính liên kết junction (không đụng đích) rồi đóng DB (đang giữ file) trước khi dọn thư mục tạm
  const loiTat = path.join(dataDir, "shared-files", "loi-tat");
  if (fs.existsSync(loiTat)) fs.rmdirSync(loiTat);
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});
beforeEach(() => {
  daGui = [];
});

const api = {
  sendMessage: async (payload: { msg?: string; attachments?: string[] }) => {
    daGui.push(payload);
    return { message: { msgId: "m1" } };
  },
} as unknown as API;
const account = { id: "acc-guard", label: "T" } as AccountConfig;
const message = { accountId: account.id, threadId: "t1", threadType: ThreadType.User, isGroup: false } as ParsedMessage;

/* eslint-disable @typescript-eslint/no-explicit-any -- ctx giả tối thiểu, đúng mẫu simple-tools.test.ts */
const chay = (source: string): Promise<unknown> =>
  (sendFile.createSendFileTool({ api, account, message } as any) as any).execute({ source }, {});

describe("send_file - kho shared-files", () => {
  it("tệp thật trong kho gửi được, đúng đường dẫn thật", async () => {
    const kho = path.join(dataDir, "shared-files");
    fs.mkdirSync(kho, { recursive: true });
    fs.writeFileSync(path.join(kho, "bao-gia.pdf"), "pdf");
    assert.match(ketQuaThanhCong(await chay("bao-gia.pdf")), /Đã gửi file/);
    assert.equal(daGui.length, 1);
    assert.equal(path.basename(daGui[0]!.attachments![0]!), "bao-gia.pdf");
  });

  it("junction trong kho trỏ ra ngoài (cạnh cookie / DB) bị từ chối, KHÔNG gửi gì", async () => {
    const kho = path.join(dataDir, "shared-files");
    const ngoai = path.join(dataDir, "bi-mat-ngoai-kho");
    fs.mkdirSync(kho, { recursive: true });
    fs.mkdirSync(ngoai, { recursive: true });
    fs.symlinkSync(ngoai, path.join(kho, "loi-tat"), "junction");
    const ra = await chay("loi-tat");
    assert.match(loiCuaTool(ra), /ngoài kho cho phép/);
    assert.equal(daGui.length, 0);
  });

  it("symlink tệp trong kho trỏ ra ngoài bị từ chối (bỏ qua nếu máy không cho tạo symlink)", async (t) => {
    const kho = path.join(dataDir, "shared-files");
    const ngoai = path.join(dataDir, "bi-mat-ngoai-kho");
    fs.mkdirSync(kho, { recursive: true });
    fs.mkdirSync(ngoai, { recursive: true });
    fs.writeFileSync(path.join(ngoai, "cookie.txt"), "BI MAT");
    try {
      fs.symlinkSync(path.join(ngoai, "cookie.txt"), path.join(kho, "cookie.txt"), "file");
    } catch {
      t.skip("không tạo được symlink tệp trên máy này (cần quyền)");
      return;
    }
    assert.match(loiCuaTool(await chay("cookie.txt")), /ngoài kho cho phép/);
    assert.equal(daGui.length, 0);
  });
});

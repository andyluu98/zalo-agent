import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { taoMoiTruongCli, type MoiTruongCli } from "./outbox-cli-test-helper.js";
import { NHOM } from "./outbox-test-helper.js";

let cli: MoiTruongCli;
beforeEach(() => {
  cli = taoMoiTruongCli();
});
afterEach(() => cli.don());

function taoTin(): string {
  assert.equal(cli.chay(["add", "--thread", NHOM, "--text", "xin chào"]).status, 0);
  return cli.idDauTien();
}
function datTrangThai(id: string, trangThai: string): void {
  const t = { ...cli.docTin(id), trangThai };
  fs.writeFileSync(path.join(cli.hopThu, `${id}.json`), JSON.stringify(t));
}

describe("CLI cancel", () => {
  it("hủy tin cho_duyet thành công và file ghi đúng huy", () => {
    const id = taoTin();
    const r = cli.chay(["cancel", id]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Đã hủy tin/);
    assert.equal(cli.docTin(id).trangThai, "huy");
    assert.equal(fs.existsSync(path.join(cli.hopThu, `${id}.lock`)), false, "khóa được nhả");
  });

  it("hủy tin dang_gui / da_gui / loi bị từ chối, file giữ nguyên", () => {
    const id = taoTin();
    for (const tt of ["dang_gui", "da_gui", "loi"]) {
      datTrangThai(id, tt);
      const truoc = fs.readFileSync(path.join(cli.hopThu, `${id}.json`), "utf8");
      const r = cli.chay(["cancel", id]);
      assert.equal(r.status, 1, tt);
      assert.match(r.stderr, new RegExp(`đã ${tt}, không hủy được`));
      assert.equal(fs.readFileSync(path.join(cli.hopThu, `${id}.json`), "utf8"), truoc);
    }
  });

  it("tin đang bị tiến trình khác giữ khóa (bot đang giành): hủy thất bại, không ghi đè", () => {
    const id = taoTin();
    fs.writeFileSync(path.join(cli.hopThu, `${id}.lock`), "bot");
    const truoc = fs.readFileSync(path.join(cli.hopThu, `${id}.json`), "utf8");
    const r = cli.chay(["cancel", id]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /đang được tiến trình khác xử lý/);
    assert.equal(fs.readFileSync(path.join(cli.hopThu, `${id}.json`), "utf8"), truoc);
  });
});

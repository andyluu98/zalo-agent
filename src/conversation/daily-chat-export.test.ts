import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { xepHangTheoKhoa } from "../shared/xep-hang-theo-khoa.js";
import { BoGhiLogNgay, type DongLogTin } from "./daily-chat-export.js";

function taoThuMuc(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "zalo-export-"));
}

const ngayDir = (goc: string): string => path.join(goc, "acc", "2026-10-05");
const docFile = (goc: string, tuongDoi: string): string => fs.readFileSync(path.join(ngayDir(goc), tuongDoi), "utf8");

function dong(over: Partial<DongLogTin> = {}): DongLogTin {
  return {
    accountId: "acc",
    threadId: "g123",
    tenThread: "Nhóm Kinh Doanh",
    laNhom: true,
    sentAt: "2026-10-05T02:15:00.000Z",
    senderId: "u1",
    senderName: "Anh B",
    laToi: false,
    msgId: "m1",
    cliMsgId: "c1",
    loaiTin: "chu",
    noiDung: "Gửi báo giá cho khách A trước 17h nhé",
    anh: [],
    ...over,
  };
}

describe("BoGhiLogNgay", () => {
  it("bố cục mới: nhom/<ten>.md trong thư mục ngày, jsonl trong _du-lieu, có file hướng dẫn", () => {
    const goc = taoThuMuc();
    const bo = new BoGhiLogNgay(goc, () => "Asia/Ho_Chi_Minh");
    bo.damBaoHuongDan();
    bo.ghiTin(dong());

    assert.ok(fs.existsSync(path.join(goc, "CLAUDE.md")));
    assert.ok(fs.existsSync(path.join(goc, "AGENTS.md")));
    const md = docFile(goc, "nhom/nhom-kinh-doanh.md");
    assert.match(md, /^# Nhóm Kinh Doanh \(Nhóm\) - 2026-10-05/);
    assert.match(md, /- Thread ID: g123/);
    assert.match(md, /- 09:15 \*\*Anh B\*\*: Gửi báo giá cho khách A trước 17h nhé/);
    const json = JSON.parse(fs.readFileSync(path.join(goc, "acc", "_du-lieu", "2026-10-05.jsonl"), "utf8").trim());
    assert.equal(json.gio, "09:15");
    assert.equal(json.msgId, "m1");
    // Thư mục ngày chỉ còn mục lục + thư mục con, không lẫn file máy đọc
    assert.deepEqual(fs.readdirSync(ngayDir(goc)).sort(), ["00_muc-luc.md", "nhom"]);
  });

  it("tin 23h UTC hôm trước rơi vào thư mục ngày hôm sau theo giờ VN", () => {
    const goc = taoThuMuc();
    new BoGhiLogNgay(goc, () => "Asia/Ho_Chi_Minh").ghiTin(dong({ sentAt: "2026-10-04T23:30:00.000Z" }));
    assert.ok(fs.existsSync(ngayDir(goc)));
  });

  it("đổi tên nhóm giữa ngày / khởi động lại vẫn ghi chung một file (nhớ qua mục lục)", () => {
    const goc = taoThuMuc();
    new BoGhiLogNgay(goc, () => "Asia/Ho_Chi_Minh").ghiTin(dong());
    new BoGhiLogNgay(goc, () => "Asia/Ho_Chi_Minh").ghiTin(dong({ tenThread: "Tên Mới", msgId: "m2" }));
    assert.deepEqual(fs.readdirSync(path.join(ngayDir(goc), "nhom")), ["nhom-kinh-doanh.md"]);
    assert.equal((docFile(goc, "nhom/nhom-kinh-doanh.md").match(/\*\*Anh B\*\*/g) ?? []).length, 2);
  });

  it("hai cuộc trùng tên: cuộc sau thêm 4 số cuối ID; chat riêng vào rieng/", () => {
    const goc = taoThuMuc();
    const bo = new BoGhiLogNgay(goc, () => "Asia/Ho_Chi_Minh");
    bo.ghiTin(dong());
    bo.ghiTin(dong({ threadId: "g999456789", msgId: "m2" }));
    bo.ghiTin(dong({ threadId: "u9", tenThread: "Vũ Văn Hải", laNhom: false, msgId: "m3" }));
    assert.deepEqual(fs.readdirSync(path.join(ngayDir(goc), "nhom")).sort(), ["nhom-kinh-doanh-6789.md", "nhom-kinh-doanh.md"]);
    assert.match(docFile(goc, "rieng/vu-van-hai.md"), /^# Vũ Văn Hải \(Chat riêng\) - 2026-10-05/);
  });

  it("tin tự gửi, trích dẫn, đính kèm, nhiều dòng và thu hồi", () => {
    const goc = taoThuMuc();
    const bo = new BoGhiLogNgay(goc, () => "Asia/Ho_Chi_Minh");
    bo.ghiTin(
      dong({
        laToi: true,
        senderName: "Andy",
        noiDung: "ok anh\nchiều em gửi",
        trichDan: { nguoiGui: "Anh B", noiDung: "Gửi báo giá" },
        dinhKem: { ten: "bao-gia.xlsx", url: "https://f/x" },
        loaiTin: "file",
      }),
    );
    bo.ghiThuHoi({
      accountId: "acc",
      threadId: "g123",
      tenThread: "",
      laNhom: true,
      sentAt: "2026-10-05T02:20:00.000Z",
      senderName: "Andy",
      laToi: true,
      msgIdGoc: "m1",
    });
    const md = docFile(goc, "nhom/nhom-kinh-doanh.md");
    assert.match(md, /\*\*⟦CHỦ⟧ Tôi \(Andy\)\*\*: ok anh\n  chiều em gửi/);
    assert.match(md, /  > Trả lời \*\*Anh B\*\*: Gửi báo giá/);
    assert.match(md, /  - Đính kèm \(file\): \[bao-gia.xlsx\]\(https:\/\/f\/x\)/);
    assert.match(md, /- 09:20 \*\*⟦CHỦ⟧ Tôi \(Andy\)\*\* đã thu hồi một tin \(tin lúc 09:15: "ok anh chiều em gửi"\)/);
  });

  it("hướng dẫn cũ (không có dấu hiệu phiên bản) được CHUYỂN vào _backup rồi thay bản mới", () => {
    const goc = taoThuMuc();
    fs.writeFileSync(path.join(goc, "CLAUDE.md"), "bản cũ");
    new BoGhiLogNgay(goc, () => "UTC", () => new Date("2026-10-07T04:30:00Z")).damBaoHuongDan();
    assert.equal(fs.readFileSync(path.join(goc, "_backup", "CLAUDE_261007-1130.md"), "utf8"), "bản cũ");
    assert.match(fs.readFileSync(path.join(goc, "CLAUDE.md"), "utf8"), /zalo-agent-huong-dan v9/);
  });

  it("hướng dẫn đã đúng phiên bản thì giữ nguyên, không tạo backup", () => {
    const goc = taoThuMuc();
    const bo = new BoGhiLogNgay(goc, () => "UTC");
    bo.damBaoHuongDan();
    fs.appendFileSync(path.join(goc, "CLAUDE.md"), "\nghi chú tay");
    bo.damBaoHuongDan();
    assert.match(fs.readFileSync(path.join(goc, "CLAUDE.md"), "utf8"), /ghi chú tay/);
    assert.equal(fs.existsSync(path.join(goc, "_backup")), false);
  });

  it("danh bạ 00_danh-ba.md: cuộc trò chuyện + người + nhóm có mặt; mục lục ngày đếm đúng", () => {
    const goc = taoThuMuc();
    const bo = new BoGhiLogNgay(goc, () => "Asia/Ho_Chi_Minh");
    bo.ghiTin(dong());
    bo.ghiTin(dong({ msgId: "m2", senderId: "u2", senderName: "Chị C", sentAt: "2026-10-05T03:00:00.000Z" }));
    bo.ghiTin(dong({ msgId: "m3", threadId: "u1", tenThread: "Anh B", laNhom: false }));

    const danhBa = fs.readFileSync(path.join(goc, "acc", "00_danh-ba.md"), "utf8");
    assert.match(danhBa, /\| Nhóm Kinh Doanh \| Nhóm \| g123 \| 2026-10-05\/nhom\/nhom-kinh-doanh\.md \| 2026-10-05 \| 2026-10-05 \| 2 \|/);
    assert.match(danhBa, /\| Anh B \| u1 \| Có \| Nhóm Kinh Doanh \(1\) \|/);
    assert.ok(fs.existsSync(path.join(goc, "acc", "_du-lieu", "danh-ba.json")));
    assert.equal(bo.tenThreadDaBiet("acc", "g123"), "Nhóm Kinh Doanh");

    const mucLuc = docFile(goc, "00_muc-luc.md");
    assert.match(mucLuc, /2 cuộc trò chuyện, 3 tin/);
    assert.match(mucLuc, /\| Nhóm Kinh Doanh \| Nhóm \| 2 \| 09:15 \| 10:00 \| Anh B \(1\), Chị C \(1\) \| \[nhom\/nhom-kinh-doanh\.md\]/);
  });

  it("đọc được danh bạ bố cục cũ (_danh-ba.json) khi nâng cấp", () => {
    const goc = taoThuMuc();
    fs.mkdirSync(path.join(goc, "acc"), { recursive: true });
    fs.writeFileSync(
      path.join(goc, "acc", "_danh-ba.json"),
      JSON.stringify({ threads: { u7: { ten: "Long Nguyen", laNhom: false, ngayDau: "2026-10-04", ngayCuoi: "2026-10-04", soTin: 3 } }, nguoi: {} }),
    );
    assert.equal(new BoGhiLogNgay(goc, () => "UTC").tenThreadDaBiet("acc", "u7"), "Long Nguyen");
  });
});

describe("BoGhiLogNgay - tệp đã tải", () => {
  it("ảnh đã lưu: link đi lên ../tep/ (file chat nằm trong nhom/); tải hỏng ghi rõ lý do", () => {
    const goc = taoThuMuc();
    new BoGhiLogNgay(goc, () => "Asia/Ho_Chi_Minh").ghiTin(
      dong({
        noiDung: "[ảnh]",
        anh: ["https://zalo/anh.jpg"],
        tepDaLuu: [
          { loai: "anh", ten: "anh_m1", duongDan: "tep/0915_anh-m1.jpg" },
          { loai: "file", ten: "hd.pdf", loi: "vượt quá trần" },
        ],
      }),
    );
    const md = docFile(goc, "nhom/nhom-kinh-doanh.md");
    assert.match(md, /  - Đã lưu \(anh\): \[tep\/0915_anh-m1\.jpg\]\(\.\.\/tep\/0915_anh-m1\.jpg\)/);
    assert.match(md, /  - Không tải được file "hd\.pdf": vượt quá trần/);
    assert.doesNotMatch(md, /zalo\/anh\.jpg/);
  });
});

describe("xepHangTheoKhoa", () => {
  it("chạy nối tiếp theo khóa, lỗi một việc không chặn việc sau", async () => {
    const thuTu: number[] = [];
    const a = xepHangTheoKhoa("k", async () => {
      await new Promise((r) => setTimeout(r, 20));
      thuTu.push(1);
    });
    const b = xepHangTheoKhoa("k", () => {
      throw new Error("hỏng");
    });
    const c = xepHangTheoKhoa("k", () => {
      thuTu.push(3);
    });
    await a;
    await assert.rejects(b);
    await c;
    assert.deepEqual(thuTu, [1, 3]);
  });
});

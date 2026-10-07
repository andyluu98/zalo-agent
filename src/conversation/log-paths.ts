import path from "node:path";
import { sachTen } from "./log-text-utils.js";

/**
 * MỘT chỗ duy nhất biết bố cục thư mục log chỉ đọc:
 *
 *   <goc>/
 *     CLAUDE.md, AGENTS.md
 *     <accountId>/
 *       00_danh-ba.md, 00_trang-thai.md       người / AI đọc
 *       <yyyy-MM-dd>/
 *         00_muc-luc.md
 *         nhom/<ten>.md, rieng/<ten>.md       mỗi cuộc trò chuyện một file
 *         tep/                                tệp đã tải
 *       _du-lieu/                             máy đọc - người dùng không cần mở
 *         danh-ba.json, trang-thai.json
 *         <yyyy-MM-dd>.jsonl, muc-luc-<yyyy-MM-dd>.json
 *
 * Bố cục cũ (trước khi có `_du-lieu/`) còn được ĐỌC qua các hàm `cu*` để không
 * mất msgId cuối / danh bạ khi nâng cấp; ghi thì luôn theo bố cục mới.
 */
export class DuongDanLog {
  constructor(private readonly goc: string) {}

  acc(accountId: string): string {
    return path.join(this.goc, sachTen(accountId));
  }
  duLieu(accountId: string): string {
    return path.join(this.acc(accountId), "_du-lieu");
  }
  ngay(accountId: string, ngay: string): string {
    return path.join(this.acc(accountId), ngay);
  }
  jsonl(accountId: string, ngay: string): string {
    return path.join(this.duLieu(accountId), `${ngay}.jsonl`);
  }
  mucLucJson(accountId: string, ngay: string): string {
    return path.join(this.duLieu(accountId), `muc-luc-${ngay}.json`);
  }
  mucLucMd(accountId: string, ngay: string): string {
    return path.join(this.ngay(accountId, ngay), "00_muc-luc.md");
  }
  danhBaJson(accountId: string): string {
    return path.join(this.duLieu(accountId), "danh-ba.json");
  }
  danhBaMd(accountId: string): string {
    return path.join(this.acc(accountId), "00_danh-ba.md");
  }
  trangThaiJson(accountId: string): string {
    return path.join(this.duLieu(accountId), "trang-thai.json");
  }
  trangThaiMd(accountId: string): string {
    return path.join(this.acc(accountId), "00_trang-thai.md");
  }

  // Bố cục cũ - chỉ đọc khi bản mới chưa có
  cuTrangThaiJson(accountId: string): string {
    return path.join(this.acc(accountId), "_trang-thai.json");
  }
  cuDanhBaJson(accountId: string): string {
    return path.join(this.acc(accountId), "_danh-ba.json");
  }
}

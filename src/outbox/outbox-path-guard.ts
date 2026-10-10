import path from "node:path";

/**
 * `con` có nằm trong (hoặc bằng) thư mục `thuMuc` không. So sánh theo đường dẫn
 * đã chuẩn hóa; Windows không phân biệt hoa/thường (ổ `C:` = `c:`). Hàm THUẦN:
 * không chạm đĩa, nên cũng không giải symlink / junction - gọi nó trên đường
 * dẫn đã qua `fs.realpathSync` khi cần chống đường vòng.
 */
export function laTrongThuMuc(con: string, thuMuc: string): boolean {
  const chuanHoa = (p: string) => {
    const r = path.resolve(p);
    return process.platform === "win32" ? r.toLowerCase() : r;
  };
  const a = chuanHoa(con);
  const b = chuanHoa(thuMuc);
  const rel = path.relative(b, a);
  if (rel === "") return true;
  // Khác ổ / khác UNC: path.relative trả lại đường tuyệt đối
  return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

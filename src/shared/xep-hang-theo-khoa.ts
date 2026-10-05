/**
 * Hàng chờ nối tiếp theo từng thread: bước ghi log có thể phải ĐỢI lấy tên
 * nhóm (gọi mạng) lần đầu, mà tin sau không được ghi chen lên trước tin trước.
 */
const hangCho = new Map<string, Promise<void>>();

export function xepHangTheoKhoa(khoa: string, viec: () => Promise<void> | void): Promise<void> {
  const truoc = hangCho.get(khoa) ?? Promise.resolve();
  const sau = truoc.then(viec);
  // Lỗi của một việc không được chặn các việc sau trong hàng
  const giuHang = sau.catch(() => {});
  hangCho.set(khoa, giuHang);
  void giuHang.then(() => {
    if (hangCho.get(khoa) === giuHang) hangCho.delete(khoa);
  });
  return sau;
}

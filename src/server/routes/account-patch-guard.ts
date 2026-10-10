/**
 * Tài khoản CHỈ ĐỌC không được tự chấp nhận kết bạn: chấp nhận là một thao tác
 * GHI lên Zalo (người lạ thành bạn, thấy trạng thái online), trái lời hứa của chế độ chỉ đọc.
 *
 * Từ chối cả hai chiều (bật tự kết bạn trên tài khoản chỉ đọc, bật chỉ đọc trên tài
 * khoản đang tự kết bạn) thay vì tự tắt ngầm một bên: tự tắt làm người vận hành
 * tưởng cấu hình vừa lưu có hiệu lực. Chỉ xét khi PATCH có đụng tới một trong hai
 * trường, để tài khoản cũ lỡ ở trạng thái cả hai vẫn sửa nhãn/agent được.
 */
export function kiemTuKetBanVaChiDoc(
  hienTai: { readOnly?: boolean; autoAcceptFriends?: boolean },
  patch: { readOnly?: boolean; autoAcceptFriends?: boolean },
): string | null {
  if (patch.readOnly === undefined && patch.autoAcceptFriends === undefined) return null;
  const chiDoc = patch.readOnly ?? hienTai.readOnly ?? false;
  const tuKetBan = patch.autoAcceptFriends ?? hienTai.autoAcceptFriends ?? false;
  if (chiDoc && tuKetBan) {
    return "Tài khoản chỉ đọc không được bật tự động chấp nhận kết bạn (tắt một trong hai trước)";
  }
  return null;
}

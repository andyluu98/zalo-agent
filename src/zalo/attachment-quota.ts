/**
 * Hạn mức dung lượng tải tệp chỉ đọc theo NGÀY, theo tài khoản và theo người gửi.
 * Chặn một người (hay một nhóm bị spam) làm đầy ổ đĩa. Đếm trong RAM: restart
 * thì đếm lại từ 0 (chấp nhận - trần là lưới an toàn, không phải sổ kế toán).
 * 0 = không giới hạn.
 */
export class HanMucTaiTep {
  private ngay = "";
  private readonly theoKhoa = new Map<string, number>();

  constructor(
    private readonly mbMoiTaiKhoan: number,
    private readonly mbMoiNguoiGui: number,
  ) {}

  /** Trả lý do hết hạn mức, hoặc null nếu còn được tải. Chạy TRƯỚC khi tải. */
  kiem(ngay: string, accountId: string, senderId: string): string | null {
    this.quaNgay(ngay);
    if (this.mbMoiTaiKhoan > 0 && this.da(`a:${accountId}`) >= this.mbMoiTaiKhoan * MB) {
      return `hết hạn mức ${this.mbMoiTaiKhoan} MB/ngày của tài khoản`;
    }
    if (this.mbMoiNguoiGui > 0 && this.da(`s:${accountId}:${senderId}`) >= this.mbMoiNguoiGui * MB) {
      return `hết hạn mức ${this.mbMoiNguoiGui} MB/ngày của người gửi`;
    }
    return null;
  }

  /** Ghi số byte đã tải xong */
  ghi(ngay: string, accountId: string, senderId: string, bytes: number): void {
    this.quaNgay(ngay);
    for (const k of [`a:${accountId}`, `s:${accountId}:${senderId}`]) this.theoKhoa.set(k, this.da(k) + bytes);
  }

  private da(khoa: string): number {
    return this.theoKhoa.get(khoa) ?? 0;
  }

  private quaNgay(ngay: string): void {
    if (ngay === this.ngay) return;
    this.ngay = ngay;
    this.theoKhoa.clear();
  }
}

const MB = 1024 * 1024;

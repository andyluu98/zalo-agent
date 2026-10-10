import { z } from "zod";

/** Kiểu dữ liệu + hằng số của hộp thư đi (xem outbox-file-store.ts) */

export const THU_MUC_HOP_THU = "hop-thu-di";
export const TRAN_KY_TU = 2000;
/** Trần tệp đính kèm mỗi tin và dung lượng mỗi tệp */
export const TRAN_SO_TEP = 10;
export const TRAN_MB_TEP = 100;

export const TRANG_THAI = ["cho_duyet", "da_duyet", "dang_gui", "da_gui", "loi", "huy"] as const;
export type TrangThaiTin = (typeof TRANG_THAI)[number];

const tepSchema = z.object({
  /** Đường dẫn TUYỆT ĐỐI trên máy */
  duongDan: z.string().min(1),
  kichThuoc: z.number().int().nonnegative(),
  /** sha256 nội dung tệp lúc tạo tin - tệp bị thay sau đó thì không gửi */
  bam: z.string(),
});
export type TepDinhKem = z.infer<typeof tepSchema>;

/** Trần số người được tag trong một tin */
export const TRAN_SO_TAG = 20;
/** uid đặc biệt của zca-js nghĩa là tag tất cả (@All) */
export const UID_TAG_TAT_CA = "-1";

const tagSchema = z.object({
  uid: z.string().regex(/^(-1|\d+)$/),
  /** Vị trí ký tự (UTF-16, đúng cách zca-js đếm) của "@Tên" trong noiDung */
  pos: z.number().int().nonnegative(),
  len: z.number().int().positive(),
});
export type TagTen = z.infer<typeof tagSchema>;

export const tinSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  accountId: z.string().min(1),
  threadId: z.string().regex(/^\d+$/),
  loaiCuoc: z.enum(["nhom", "rieng"]),
  tenCuoc: z.string().default(""),
  noiDung: z.string(),
  tepDinhKem: z.array(tepSchema).max(TRAN_SO_TEP).optional(),
  nhacTen: z.array(tagSchema).max(TRAN_SO_TAG).optional(),
  trangThai: z.enum(TRANG_THAI),
  taoLuc: z.string(),
  duyetLuc: z.string().optional(),
  /** `bamTin` lúc duyệt (nội dung + tệp) - sửa nội dung hay thay tệp sau khi duyệt thì không gửi */
  banBam: z.string().optional(),
  guiLuc: z.string().optional(),
  msgId: z.string().optional(),
  loi: z.string().optional(),
});
export type TinHopThu = z.infer<typeof tinSchema>;

export function laIdHopLe(id: string): boolean {
  return /^[a-z0-9-]+$/.test(id);
}

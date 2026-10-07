import type { API } from "zca-js";
import { setThreadDisplayName } from "../conversation/thread-store.js";
import { createLogger } from "../shared/logger.js";

const log = createLogger("message-router");

/**
 * Lấy tên group 1 lần khi gặp lần đầu, cache vào bảng threads. Trả luôn tên:
 * thread chỉ có tin tự gửi thì chưa có dòng trong bảng threads, UPDATE không ăn,
 * nên caller (log chỉ đọc) cần chính giá trị này.
 */
export async function resolveGroupName(accountId: string, api: API, threadId: string): Promise<string> {
  try {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const info: any = await api.getGroupInfo(threadId);
    const name = info?.gridInfoMap?.[threadId]?.name ?? info?.name;
    if (name) setThreadDisplayName(accountId, threadId, String(name));
    return name ? String(name) : "";
  } catch (err) {
    log.debug({ accountId, threadId, err }, "Không lấy được tên nhóm - để trống");
    return "";
  }
}

/** Tên hiển thị của một người theo uid (chat riêng mà chủ tài khoản nhắn trước) */
export async function resolveUserName(api: API, uid: string): Promise<string> {
  try {
    const resp = await api.getUserInfo(uid);
    const prof = Object.values(resp?.changed_profiles ?? {})[0] as
      | { displayName?: string; zaloName?: string }
      | undefined;
    return prof?.displayName || prof?.zaloName || "";
  } catch (err) {
    log.debug({ uid, err }, "Không lấy được tên người dùng - để trống");
    return "";
  }
}

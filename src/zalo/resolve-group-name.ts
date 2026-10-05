import type { API } from "zca-js";
import { setThreadDisplayName } from "../conversation/thread-store.js";
import { createLogger } from "../shared/logger.js";

const log = createLogger("message-router");

/** Lấy tên group 1 lần khi gặp lần đầu, cache vào bảng threads */
export async function resolveGroupName(accountId: string, api: API, threadId: string): Promise<void> {
  try {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const info: any = await api.getGroupInfo(threadId);
    const name = info?.gridInfoMap?.[threadId]?.name ?? info?.name;
    if (name) setThreadDisplayName(accountId, threadId, String(name));
  } catch (err) {
    log.debug({ accountId, threadId, err }, "Không lấy được tên nhóm - để trống");
  }
}

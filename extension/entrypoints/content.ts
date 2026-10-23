import { getPlatformAdapter } from '@/src/platforms';
import { BUILD_ID } from '@/src/build';

// 防重复注入：popup 在检测到旧版脚本后会补注入本文件，
// 同一页面里重复执行 main() 会导致重复上报/重复监听，这里只允许初始化一次。
const INJECT_FLAG = '__hwContentReady__';

// 应答 popup 的版本探测：正在运行的是哪一次构建的脚本。
interface PingResponse {
  ok: true;
  buildId: string;
  platformId: string | null;
}

export default defineContentScript({
  matches: [
    'https://study.neusoft.edu.cn/*',
    'https://*.pigai.org/*',
    'https://sso.unipus.cn/*',
    'https://itestcloud.unipus.cn/*',
    'https://*.unipus.cn/*',
    'https://i.chaoxing.com/*',
  ],
  runAt: 'document_idle',
  main() {
    const state = globalThis as unknown as Record<string, unknown>;
    if (state[INJECT_FLAG]) {
      return;
    }
    state[INJECT_FLAG] = BUILD_ID;

    const adapter = getPlatformAdapter(window.location.href);

    if (!adapter) {
      return;
    }

    // allowAutoOpen：页面自动上报时不允许主动点标签（避免打断用户）；
    // 用户在看板点“刷新当前平台”时允许（可自动打开“作业”标签取数）。
    const reportPage = async (allowAutoOpen: boolean) => {
      const result = await adapter.extract(document, window.location.href, { allowAutoOpen });

      // null = 当前页面与作业无关，静默跳过，不更新缓存。
      if (!result) {
        return;
      }

      void browser.runtime.sendMessage({
        type: 'PLATFORM_PAGE_READY',
        platformId: adapter.id,
        url: window.location.href,
        status: result.status,
        assignments: result.assignments,
        courseId: result.courseId,
        courseName: result.courseName,
        courseIds: result.courseIds,
        replaceAll: result.replaceAll,
        message: result.message,
        buildId: BUILD_ID,
      });
    };

    void reportPage(false);

    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      // 版本探测：popup 用它确认本页脚本是否为最新构建。
      if (message?.type === 'HW_PING') {
        const response: PingResponse = { ok: true, buildId: BUILD_ID, platformId: adapter.id };
        sendResponse(response);
        return;
      }

      if (message?.type === 'SYNC_ACTIVE_PAGE') {
        sendResponse({ ok: true, buildId: BUILD_ID });
        void reportPage(true);
      }
    });
  },
});

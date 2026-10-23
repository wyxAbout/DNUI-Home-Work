import { getPlatformAdapter } from '@/src/platforms';
import { BUILD_ID } from '@/src/build';
import type { PlatformExtractionResult } from '@/src/models';
import { SelectorError, SELECTORS_VERSION } from '@/src/selectors';

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
    'https://notice.chaoxing.com/*',
  ],
  // 关键：学习通收件箱渲染在 i.chaoxing.com 页面内嵌的 notice.chaoxing.com iframe 中，
  // 顶层主框架读不到跨域 iframe 的内容（chaoxing.ts 对 i.chaoxing.com 顶层直接 return null）。
  // 必须让 content script 也注入子框架，才能在 notice.chaoxing.com/myNotice 上下文里解析列表。
  // 其它平台的非列表 iframe 经 getPlatformAdapter 按 host 过滤后会 return null，不受影响。
  allFrames: true,
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
      let result: PlatformExtractionResult | null;
      try {
        result = await adapter.extract(document, window.location.href, { allowAutoOpen });
      } catch (err) {
        // 解析器抛出 SelectorError（关键选择器缺失）或意外错误：转为显式状态，
        // 让看板与日志可见，而不是静默跳过（反馈 2.3：失效时明确报错别静默跳过）。
        const message =
          err instanceof SelectorError
            ? `${err.message}（selectorsVersion=${SELECTORS_VERSION}）`
            : `解析异常：${err instanceof Error ? err.message : String(err)}`;
        result = {
          status: err instanceof SelectorError ? 'needs-verification' : 'error',
          assignments: [],
          message,
        };
      }

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

    // 触发一次同步，并把请求转发到所有子框架。
    // 原因：background 的 tabs.sendMessage 默认只送达顶层 frame，
    // 而学习通收件箱解析发生在 notice.chaoxing.com 这个跨域 iframe 里，
    // 必须把同步请求转发过去才能覆盖它（无需新增 webNavigation 权限）。
    const triggerSync = () => {
      void reportPage(true);
      for (const frame of Array.from(window.frames)) {
        try {
          frame.postMessage({ __hwRelay: 'SYNC_ACTIVE_PAGE' }, '*');
        } catch {
          // 跨域 frame 无法 postMessage 时忽略（其 content script 会在自身加载时自动上报）。
        }
      }
    };

    // 接收来自顶层 frame 转发的同步请求（iframe 自身不会被 tabs.sendMessage 命中）。
    window.addEventListener('message', (e: MessageEvent) => {
      if (e.data && (e.data as { __hwRelay?: string }).__hwRelay === 'SYNC_ACTIVE_PAGE') {
        void reportPage(true);
      }
    });

    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      // 版本探测：popup 用它确认本页脚本是否为最新构建。
      if (message?.type === 'HW_PING') {
        const response: PingResponse = { ok: true, buildId: BUILD_ID, platformId: adapter.id };
        sendResponse(response);
        return;
      }

      if (message?.type === 'SYNC_ACTIVE_PAGE') {
        sendResponse({ ok: true, buildId: BUILD_ID });
        triggerSync();
      }
    });
  },
});

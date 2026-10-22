import { getPlatformAdapter } from '@/src/platforms';

export default defineContentScript({
  matches: [
    'https://study.neusoft.edu.cn/*',
    'https://*.pigai.org/*',
    'https://sso.unipus.cn/*',
    'https://itestcloud.unipus.cn/*',
    'https://*.unipus.cn/*',
  ],
  runAt: 'document_idle',
  main() {
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
      });
    };

    void reportPage(false);

    browser.runtime.onMessage.addListener((message) => {
      if (message?.type === 'SYNC_ACTIVE_PAGE') {
        void reportPage(true);
      }
    });
  },
});

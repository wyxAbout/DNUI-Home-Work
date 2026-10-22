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

    const reportPage = () => {
      const result = adapter.extract(document, window.location.href);

      void browser.runtime.sendMessage({
        type: 'PLATFORM_PAGE_READY',
        platformId: adapter.id,
        url: window.location.href,
        status: result.status,
        assignments: result.assignments,
        message: result.message,
      });
    };

    reportPage();

    browser.runtime.onMessage.addListener((message) => {
      if (message?.type === 'SYNC_ACTIVE_PAGE') {
        reportPage();
      }
    });
  },
});

import {
  getAllAssignments,
  type HomeworkStore,
  type PlatformId,
} from '@/src/models';
import { loadHomeworkStore, updatePlatformSnapshot } from '@/src/storage';

interface PlatformPageReadyMessage {
  type: 'PLATFORM_PAGE_READY';
  platformId: PlatformId;
  url: string;
  status: 'success' | 'login-required' | 'needs-verification' | 'error';
  assignments?: HomeworkStore['platforms'][PlatformId]['assignments'];
  message: string;
}

const NOTIFICATION_ID = 'homework-summary';

async function notifyFromCache(): Promise<void> {
  const store = await loadHomeworkStore();
  const assignments = getAllAssignments(store);

  if (assignments.length === 0) {
    return;
  }

  await browser.notifications.create(NOTIFICATION_ID, {
    type: 'basic',
    iconUrl: browser.runtime.getURL('/icon/128.png'),
    title: '作业整合看板',
    message: `当前有 ${assignments.length} 项未提交作业。数据来自最近一次平台访问。`,
  });
}

export default defineBackground(() => {
  browser.runtime.onStartup.addListener(() => {
    void notifyFromCache();
  });

  browser.runtime.onMessage.addListener((message: PlatformPageReadyMessage) => {
    if (message?.type !== 'PLATFORM_PAGE_READY') {
      return;
    }

    const update = {
      status: message.status,
      lastVisitedUrl: message.url,
      message: message.message,
      ...(message.status === 'success' && message.assignments
        ? {
            assignments: message.assignments,
            lastSyncedAt: new Date().toISOString(),
          }
        : {}),
    };

    void updatePlatformSnapshot(message.platformId, update);
  });
});

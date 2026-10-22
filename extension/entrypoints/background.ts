import {
  getAllAssignments,
  mergeAssignmentsByCourse,
  PLATFORM_LABELS,
  type HomeworkStore,
  type PlatformId,
  type PlatformSnapshot,
} from '@/src/models';
import { loadHomeworkStore, updatePlatformSnapshot } from '@/src/storage';
import { appendLog } from '@/src/log';

interface PlatformPageReadyMessage {
  type: 'PLATFORM_PAGE_READY';
  platformId: PlatformId;
  url: string;
  status: 'success' | 'login-required' | 'needs-verification' | 'error';
  assignments?: HomeworkStore['platforms'][PlatformId]['assignments'];
  courseId?: string;
  courseName?: string;
  courseIds?: string[];
  replaceAll?: boolean;
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

  browser.runtime.onMessage.addListener(async (message: PlatformPageReadyMessage) => {
    if (message?.type !== 'PLATFORM_PAGE_READY') {
      return;
    }

    // 计算本次更新：成功同步按课程合并缓存，支持同一平台下多门课程作业汇总（而非整平台覆盖）。
    let update: Partial<PlatformSnapshot>;
    if (message.status === 'success') {
      const current = await loadHomeworkStore();
      const existing = current.platforms[message.platformId].assignments;
      // 合并范围：优先用显式 courseIds（首页跨多门 / 课程页单门，即使本次为空也能清空旧作业）；
      // 否则退回按 incoming 自身课程集合。
      const scope =
        message.courseIds && message.courseIds.length > 0
          ? message.courseIds
          : message.courseId
            ? [message.courseId]
            : [];
      // replaceAll：本次结果对该平台整体有效（如首页空态），整组替换；否则按课程合并。
      const merged = message.replaceAll
        ? (message.assignments ?? [])
        : mergeAssignmentsByCourse(existing, message.assignments ?? [], scope);
      update = {
        status: message.status,
        lastVisitedUrl: message.url,
        message: message.message,
        assignments: merged,
        lastSyncedAt: new Date().toISOString(),
      };
    } else {
      update = {
        status: message.status,
        lastVisitedUrl: message.url,
        message: message.message,
      };
    }

    const label = PLATFORM_LABELS[message.platformId];
    if (message.status === 'success') {
      void appendLog(
        'info',
        'sync',
        `${label} 同步成功：${message.assignments?.length ?? 0} 项未提交作业`,
      );
    } else if (message.status === 'needs-verification') {
      void appendLog('warn', 'sync', `${label} 解析器待验证，未更新作业数据`);
    } else if (message.status === 'login-required') {
      void appendLog('warn', 'sync', `${label} 需要登录，未更新作业数据`);
    } else if (message.status === 'error') {
      void appendLog('error', 'sync', `${label} 同步失败：${message.message ?? '未知错误'}`);
    }

    void updatePlatformSnapshot(message.platformId, update);
  });
});

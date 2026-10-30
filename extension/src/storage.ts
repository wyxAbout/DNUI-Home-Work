import {
  createIdleCrawlState,
  type ChaoxingCrawlState,
} from './chaoxing-crawl.ts';
import {
  createEmptyStore,
  PLATFORM_IDS,
  type Assignment,
  type ChaoxingCourse,
  type HomeworkStore,
  type PlatformId,
  type PlatformSnapshot,
} from './models.ts';

const STORE_KEY = 'homework-store';
const HIDE_EXPIRED_KEY = 'hide-expired';
// 学习通课程注册表（阶段 A）：与作业缓存分开存，整体覆盖式写入，
// 不参与「按课程合并」逻辑，也不受平台快照更新影响。
const CHAOXING_COURSES_KEY = 'chaoxing-courses';

// 兼容旧缓存：早期数据没有 courseId / courseName 字段，按作业 id 前缀（neusoft:<courseId>:<index>）回填，
// 避免 UI 读到 undefined。新版同步写入后会自然补齐这两个字段。
function backfillAssignment(assignment: Assignment): Assignment {
  const hasCourse = !!assignment.courseId && !!assignment.courseName;
  const hasSource = assignment.source === 'home' || assignment.source === 'course';
  if (hasCourse && hasSource) {
    return assignment;
  }
  const parts = assignment.id.split(':');
  // 首页来源 id：neusoft:home:<课程slug>:...；课程详情页来源：neusoft:<courseId>:<序号>。
  const courseId = parts[1] === 'home' ? (parts[2] ?? 'unknown') : (parts[1] ?? 'unknown');
  return {
    ...assignment,
    courseId,
    courseName: assignment.courseName ?? '（旧数据，课程未知）',
    source: hasSource ? assignment.source : 'course',
  };
}

function normalizeSnapshot(snapshot: PlatformSnapshot): PlatformSnapshot {
  if (snapshot.assignments.length === 0) {
    return snapshot;
  }
  const assignments = snapshot.assignments.map(backfillAssignment);
  const changed = assignments.some((a, i) => a !== snapshot.assignments[i]);
  return changed ? { ...snapshot, assignments } : snapshot;
}

export async function loadHomeworkStore(): Promise<HomeworkStore> {
  const result = await browser.storage.local.get(STORE_KEY);
  const stored = result[STORE_KEY] as Partial<HomeworkStore> | undefined;
  const empty = createEmptyStore();

  if (!stored?.platforms) {
    return empty;
  }

  const platforms = {} as Record<PlatformId, PlatformSnapshot>;
  for (const id of PLATFORM_IDS) {
    platforms[id] = normalizeSnapshot(stored.platforms[id] ?? empty.platforms[id]);
  }
  return { platforms, updatedAt: stored.updatedAt ?? null };
}

export async function saveHomeworkStore(store: HomeworkStore): Promise<void> {
  await browser.storage.local.set({ [STORE_KEY]: store });
}

export async function updatePlatformSnapshot(
  platformId: PlatformId,
  update: Partial<PlatformSnapshot>,
): Promise<HomeworkStore> {
  const store = await loadHomeworkStore();
  const current = store.platforms[platformId];

  const next: HomeworkStore = {
    ...store,
    platforms: {
      ...store.platforms,
      [platformId]: {
        ...current,
        ...update,
      },
    },
    updatedAt: new Date().toISOString(),
  };

  await saveHomeworkStore(next);
  return next;
}

// 学习通课程注册表：整体覆盖（每次访问「我的课程」页都以当页清单为准）。
export async function loadChaoxingCourses(): Promise<ChaoxingCourse[]> {
  const result = await browser.storage.local.get(CHAOXING_COURSES_KEY);
  const list = result[CHAOXING_COURSES_KEY];
  return Array.isArray(list) ? (list as ChaoxingCourse[]) : [];
}

export async function saveChaoxingCourses(courses: ChaoxingCourse[]): Promise<void> {
  await browser.storage.local.set({ [CHAOXING_COURSES_KEY]: courses });
}

// 逐课同步（阶段 B）的状态存档：后台写、弹窗读。
// 不走 sendMessage 返回值的原因见 src/chaoxing-crawl.ts 的注释（应答通道会被既有 async 监听器占掉）。
const CHAOXING_CRAWL_STATE_KEY = 'chaoxing-crawl-state';

export async function loadChaoxingCrawlState(): Promise<ChaoxingCrawlState> {
  try {
    const result = await browser.storage.local.get(CHAOXING_CRAWL_STATE_KEY);
    const state = result[CHAOXING_CRAWL_STATE_KEY] as ChaoxingCrawlState | undefined;
    if (!state || typeof state !== 'object') {
      return createIdleCrawlState();
    }
    return { ...createIdleCrawlState(), ...state };
  } catch {
    return createIdleCrawlState();
  }
}

export async function saveChaoxingCrawlState(state: ChaoxingCrawlState): Promise<void> {
  await browser.storage.local.set({ [CHAOXING_CRAWL_STATE_KEY]: state });
}

// 每门课「上次真的解析成功过」的任务列表地址（含会话参数）。
// 逐课抓取时优先用它、自己拼的地址作后备：两边互为兜底，见 chaoxing-crawl.ts 的注释。
const CHAOXING_TASK_URLS_KEY = 'chaoxing-task-urls';

export async function loadChaoxingTaskUrls(): Promise<Record<string, string>> {
  try {
    const result = await browser.storage.local.get(CHAOXING_TASK_URLS_KEY);
    const map = result[CHAOXING_TASK_URLS_KEY];
    return map && typeof map === 'object' ? (map as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export async function saveChaoxingTaskUrls(map: Record<string, string>): Promise<void> {
  await browser.storage.local.set({ [CHAOXING_TASK_URLS_KEY]: map });
}

// 显示偏好：“自动隐藏已过期项”。默认关闭（false）。
// 该开关只影响看板渲染（隐藏 dueAt 已过去的作业），不改动缓存中的未提交作业。
export async function loadHideExpired(): Promise<boolean> {
  const result = await browser.storage.local.get(HIDE_EXPIRED_KEY);
  return result[HIDE_EXPIRED_KEY] === true;
}

export async function saveHideExpired(value: boolean): Promise<void> {
  await browser.storage.local.set({ [HIDE_EXPIRED_KEY]: value });
}

// 「重新打开浏览器时强制播报」开关，默认开启（保持原有行为）。
// 存 storage 而非内存：MV3 后台会被回收，需要跨会话持久化；未设置时默认开启。
const STARTUP_NOTIFY_ENABLED_KEY = 'startup-notify-enabled';

export async function loadStartupNotifyEnabled(): Promise<boolean> {
  try {
    const result = await browser.storage.local.get(STARTUP_NOTIFY_ENABLED_KEY);
    // 未设置过时默认开启；仅显式 false 才关闭。
    return result[STARTUP_NOTIFY_ENABLED_KEY] !== false;
  } catch {
    // 读不到按默认开启，避免存储异常导致功能静默失效。
    return true;
  }
}

export async function saveStartupNotifyEnabled(value: boolean): Promise<void> {
  await browser.storage.local.set({ [STARTUP_NOTIFY_ENABLED_KEY]: value });
}

// 「在页面内显示浮层」开关，默认开启（保持原有行为：打开作业站点即显示右下角浮层）。
// 关闭后 content script 不再注入/显示页面浮层，仅保留扩展图标角标与弹窗。
const SHOW_PAGE_BADGE_KEY = 'show-page-badge';

export async function loadShowPageBadge(): Promise<boolean> {
  try {
    const result = await browser.storage.local.get(SHOW_PAGE_BADGE_KEY);
    // 未设置过时默认开启；仅显式 false 才关闭。
    return result[SHOW_PAGE_BADGE_KEY] !== false;
  } catch {
    // 读不到按默认开启，避免存储异常导致浮层静默消失。
    return true;
  }
}

export async function saveShowPageBadge(value: boolean): Promise<void> {
  await browser.storage.local.set({ [SHOW_PAGE_BADGE_KEY]: value });
}

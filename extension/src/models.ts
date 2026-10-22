export type PlatformId = 'neusoft' | 'pigai' | 'itest';

export type PlatformSyncStatus =
  | 'never'
  | 'success'
  | 'login-required'
  | 'needs-verification'
  | 'error';

export interface Assignment {
  id: string;
  platformId: PlatformId;
  // 课程维度：同一平台可承载多门课程，用于跨课程汇总与缓存合并。
  courseId: string;
  courseName: string;
  title: string;
  dueAt: string | null;
  url: string;
  status: 'unsubmitted';
  syncedAt: string;
  // 数据来源：
  // - 'home'   来自首页“我的学习任务”（跨课程的全局待办视图，自带截止时间）；
  // - 'course' 来自课程详情页 → 作业标签（单门课程，无截止时间）。
  // 用于界定首页同步的清理范围：某门课作业全部完成后会从首页列表消失，
  // 若不清理其旧条目，看板会残留已完成的作业。
  source: 'home' | 'course';
}

// 平台解析结果：成功时携带待提交作业；失败/待验证时 assignments 为空，后台不会覆盖缓存。
export interface PlatformExtractionResult {
  status: PlatformSyncStatus;
  assignments: Assignment[];
  message: string;
  // 仅支持多课程汇总的平台（如东软）会携带，用于后台按课程合并缓存；缺失则不替换其它课程。
  courseId?: string;
  courseName?: string;
  // 本次同步覆盖的课程集合（用于后台按课程合并缓存）。
  // 首页“我的学习任务”会跨多门课程，故用数组；课程详情页为单元素数组。
  courseIds?: string[];
  // true 表示本次结果对该平台整体有效（如首页空态=确实没有待办），
  // 后台应整组替换而非按课程合并。仅在能确认“真的为空”时才置 true。
  replaceAll?: boolean;
}

export interface PlatformSnapshot {
  platformId: PlatformId;
  status: PlatformSyncStatus;
  assignments: Assignment[];
  lastSyncedAt: string | null;
  lastVisitedUrl: string | null;
  message: string | null;
}

export interface HomeworkStore {
  platforms: Record<PlatformId, PlatformSnapshot>;
  updatedAt: string | null;
}

export const PLATFORM_IDS: PlatformId[] = ['neusoft', 'pigai', 'itest'];

export const PLATFORM_LABELS: Record<PlatformId, string> = {
  neusoft: '东软智慧教育',
  pigai: '批改网',
  itest: 'iTEST',
};

export const PLATFORM_HOSTS: Record<PlatformId, string[]> = {
  neusoft: ['study.neusoft.edu.cn'],
  pigai: ['pigai.org', 'www.pigai.org'],
  itest: ['sso.unipus.cn', 'itestcloud.unipus.cn'],
};

export function createEmptyStore(): HomeworkStore {
  return {
    platforms: {
      neusoft: createEmptySnapshot('neusoft'),
      pigai: createEmptySnapshot('pigai'),
      itest: createEmptySnapshot('itest'),
    },
    updatedAt: null,
  };
}

export function createEmptySnapshot(platformId: PlatformId): PlatformSnapshot {
  return {
    platformId,
    status: 'never',
    assignments: [],
    lastSyncedAt: null,
    lastVisitedUrl: null,
    message: null,
  };
}

export function getAllAssignments(store: HomeworkStore): Assignment[] {
  return PLATFORM_IDS.flatMap((platformId) => store.platforms[platformId].assignments);
}

// 跨课程合并：清除 scopeCourseIds 所覆盖课程的旧作业，再并入本次解析到的作业，
// 从而实现同一平台下多门课程作业的汇总，而非互相覆盖。
// - 课程详情页：scope 为该课程（即使本次 unsubmitted 为空，也能清空该课程旧作业）。
// - 首页“我的学习任务”：scope 为本次出现的全部课程（仅清除有在列课程的旧作业）。
// 若 scope 为空且本次无新作业，则保守保留全部旧缓存，避免误清空。
export function mergeAssignmentsByCourse(
  existing: Assignment[],
  incoming: Assignment[],
  scopeCourseIds: string[] = [],
): Assignment[] {
  const scope = new Set(
    scopeCourseIds.length > 0 ? scopeCourseIds : incoming.map((a) => a.courseId),
  );
  // 本次来自首页时，把“此前由首页写入、但本次已不在列表中”的课程也纳入清理范围，
  // 否则某门课作业全部完成后，其旧条目会永久残留在看板里。
  // 课程详情页来源的条目不受影响（首页列表可能只是全局待办的一部分，不应被清掉）。
  if (incoming.some((a) => a.source === 'home')) {
    for (const item of existing) {
      if (item.source === 'home') {
        scope.add(item.courseId);
      }
    }
  }
  if (scope.size === 0) {
    return existing;
  }
  const kept = existing.filter((a) => !scope.has(a.courseId));
  return dedupeAssignments([...kept, ...unifyCourseAttribution(kept, incoming)]);
}

// 归属统一：同一平台下标题完全相同的作业视为同一项。
// 首页“我的学习任务”与课程详情页是两条独立解析路径，课程标识不同
// （首页按课程名 slug，课程页按 URL 数字 id），若不统一，同一门课会在看板里裂成两个分组。
// 因此当已存在条目来自信息更完整的来源（含截止时间）而本次不含时，沿用其课程归属。
function unifyCourseAttribution(existing: Assignment[], incoming: Assignment[]): Assignment[] {
  if (existing.length === 0 || incoming.length === 0) {
    return incoming;
  }
  const byTitle = new Map<string, Assignment>();
  for (const item of existing) {
    const key = `${item.platformId}|${item.title.trim()}`;
    if (!byTitle.has(key)) {
      byTitle.set(key, item);
    }
  }
  return incoming.map((item) => {
    const prev = byTitle.get(`${item.platformId}|${item.title.trim()}`);
    if (prev && prev.courseId !== item.courseId && prev.dueAt && !item.dueAt) {
      return { ...item, courseId: prev.courseId, courseName: prev.courseName };
    }
    return item;
  });
}

// 去重：同一平台 + 同一课程 + 同一标题只保留一条（保留信息更完整的一条，有截止时间优先）。
export function dedupeAssignments(items: Assignment[]): Assignment[] {
  const best = new Map<string, Assignment>();
  for (const item of items) {
    const key = `${item.platformId}|${item.courseId}|${item.title.trim()}`;
    const prev = best.get(key);
    if (!prev) {
      best.set(key, item);
      continue;
    }
    const score = (a: Assignment): number => (a.dueAt ? 1 : 0);
    if (score(item) > score(prev)) {
      best.set(key, item);
    }
  }
  return [...best.values()];
}

// 统计已覆盖的课程数（平台+课程唯一组合）。
export function countCoveredCourses(store: HomeworkStore): number {
  const ids = new Set<string>();
  for (const assignment of getAllAssignments(store)) {
    ids.add(`${assignment.platformId}:${assignment.courseId}`);
  }
  return ids.size;
}

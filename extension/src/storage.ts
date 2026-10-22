import {
  createEmptyStore,
  type Assignment,
  type HomeworkStore,
  type PlatformId,
  type PlatformSnapshot,
} from './models';

const STORE_KEY = 'homework-store';

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

  return {
    platforms: {
      neusoft: normalizeSnapshot(stored.platforms.neusoft ?? empty.platforms.neusoft),
      pigai: normalizeSnapshot(stored.platforms.pigai ?? empty.platforms.pigai),
      itest: normalizeSnapshot(stored.platforms.itest ?? empty.platforms.itest),
    },
    updatedAt: stored.updatedAt ?? null,
  };
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

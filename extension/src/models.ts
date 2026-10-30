export type PlatformId = 'neusoft' | 'pigai' | 'itest' | 'chaoxing';

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
  // 提交状态（学习通作业/考试/任务页统一枚举，源自“学习通任务完成判定规则”）。
  // - 'unsubmitted' 未提交/待做（仍可作答或待参与），看板显示“未提交”。
  // - 'expired'     已错过截止（如 iTEST 缺考、考试窗口已关闭），看板“已过期”，
  //                 受“自动隐藏已过期项”开关控制（默认不隐藏）。
  // - 'in_progress' 进行中（任务/活动窗口仍开放，如开放的签到），看板“进行中”。
  // - 'submitted'   已提交待批阅，看板“已提交”。
  // - 'completed'   已完成（作业已交且无需重做），看板“已完成”，默认隐藏。
  // - 'ended'       任务/活动页“已结束”且无提交状态（等同于 completed 的隐藏语义，用于签到/选人等活动），
  //                 看板“已完成”，默认隐藏。
  // - 'returned'    已退回需重交（作业被老师退回），看板“需重交”，必须显示（不能隐藏）。
  // - 'retake'      已完成但可重考（存在“重考”按钮/提示），看板“已完成（可重考）”，显示。
  status:
    | 'unsubmitted'
    | 'expired'
    | 'in_progress'
    | 'submitted'
    | 'completed'
    | 'ended'
    | 'returned'
    | 'retake';
  syncedAt: string;
  // 数据来源：
  // - 'home'   来自首页“我的学习任务”（跨课程的全局待办视图，自带截止时间）；
  // - 'course' 来自课程详情页 → 作业标签（单门课程，无截止时间）。
  // 用于界定首页同步的清理范围：某门课作业全部完成后会从首页列表消失，
  // 若不清理其旧条目，看板会残留已完成的作业。
  source: 'home' | 'course';
}

// 学习通「课程注册表」条目（阶段 A）。
// 来源：「我的课程」页（mooc2-ans.chaoxing.com/visit/interaction 或 mooc1 的 stucoursemiddle）。
// 有了 courseId + clazzId 才能把不同入口（收件箱通知 / 课程页列表）的数据归到同一门课，
// 也是后续逐课抓取作业/考试/任务列表、构造稳定 ID 的前提。
export interface ChaoxingCourse {
  // 课程 ID（课程卡片 id="c_<courseId>" 的数字部分，如 259363438）。
  courseId: string;
  // 教学班 ID（课程卡片 class 里的 stu_<clazzId>，如 139380153）。
  // 与课程页 URL 的 clazzid 同值（2026-10-25 已用「线性代数」交叉验证一致）。
  clazzId: string;
  name: string;
  teacher: string;
  // 班级/学期别名（如「本校学生用课程」），可为空。
  alias?: string;
  // 任务点进度原文（如「任务点进度: 62/62 100%」）。
  // ⚠️ 这是**章节视频学习进度**，不是作业/考试提交状态，二者不得混用。
  progressText?: string;
  progressDone?: number;
  progressTotal?: number;
  syncedAt: string;
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
  // 课程注册表（目前仅学习通「我的课程」页产出）：整体覆盖式写入，不参与作业合并。
  courses?: ChaoxingCourse[];
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

export const PLATFORM_IDS: PlatformId[] = ['neusoft', 'pigai', 'itest', 'chaoxing'];

export const PLATFORM_LABELS: Record<PlatformId, string> = {
  neusoft: '东软智慧教育',
  pigai: '批改网',
  itest: 'iTEST',
  chaoxing: '学习通邮箱',
};

export const PLATFORM_HOSTS: Record<PlatformId, string[]> = {
  neusoft: ['study.neusoft.edu.cn'],
  pigai: ['pigai.org', 'www.pigai.org'],
  itest: ['sso.unipus.cn', 'itestcloud.unipus.cn'],
  chaoxing: [
    'i.chaoxing.com',
    'notice.chaoxing.com',
    'mooc1.chaoxing.com',
    'mooc2-ans.chaoxing.com',
    'mobilelearn.chaoxing.com',
  ],
};

// 各平台主页：用于弹窗「快捷跳转」按钮，让用户在没有待办任务时也能一键直达站点。
export const PLATFORM_HOME: Record<PlatformId, string> = {
  neusoft: 'https://study.neusoft.edu.cn/',
  pigai: 'https://www.pigai.org/',
  itest: 'https://itestcloud.unipus.cn/',
  chaoxing: 'https://i.chaoxing.com/',
};

export function createEmptyStore(): HomeworkStore {
  const platforms = {} as Record<PlatformId, PlatformSnapshot>;
  for (const id of PLATFORM_IDS) {
    platforms[id] = createEmptySnapshot(id);
  }
  return { platforms, updatedAt: null };
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

// 页面细分种类：同一门课会被拆成多次上报（学习通：任务列表 / 作业·考试列表），
// 各次上报的课程作用域完全相同，但覆盖的是**不同的条目**。
// 不带这个细分就会互相清空：任务页上报时把作用域内「作业」条目一并删掉，
// 若此时作业页恰好失败或尚未上报，看板就永久看不到作业
// —— 这正是 2026-10-29「逐课同步全部成功，但看板没有作业」的成因之一。
export type AssignmentScopeKind = 'task' | 'exam';

export interface MergeScopeOptions {
  // 只在本次上报确实对应某个细分种类时传。缺省 = 旧行为（整个课程作用域一起清）。
  kind?: AssignmentScopeKind;
}

// 学习通条目 id 形如 `chaoxing:<课程键>:<种类>:<hash>`，此处取出中间的「种类」段。
// 非学习通平台 / 旧格式 id 没有种类段，返回 null，一律按旧行为处理。
const SCOPED_ID_KIND_RE = /^chaoxing:[^:]+:(task|exam):/;

// 跨课程合并：清除 scopeCourseIds 所覆盖课程的旧作业，再并入本次解析到的作业，
// 从而实现同一平台下多门课程作业的汇总，而非互相覆盖。
// - 课程详情页：scope 为该课程（即使本次 unsubmitted 为空，也能清空该课程旧作业）。
// - 首页“我的学习任务”：scope 为本次出现的全部课程（仅清除有在列课程的旧作业）。
// 若 scope 为空且本次无新作业，则保守保留全部旧缓存，避免误清空。
export function mergeAssignmentsByCourse(
  existing: Assignment[],
  incoming: Assignment[],
  scopeCourseIds: string[] = [],
  options: MergeScopeOptions = {},
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
  const kept = existing.filter((a) => !isAssignmentInScope(a, scope, options.kind));
  return dedupeAssignments([...kept, ...unifyCourseAttribution(kept, incoming)]);
}

// 判断既有条目是否落在本次合并范围内。
// 除直接比对 courseId 外，还要匹配「稳定 ID 中内嵌的课程键」：
// 学习通任务页的 assignment.courseId 用课程名 slug（保证与收件箱同课程在看板只出现一个分组），
// 而合并作用域用 `courseid-clazzid`（稳定、不受课程改名影响）。
// 若只比对 courseId，两者永远不相等 → 单课程合并实际不生效，表现为：
// ① 活动从「进行中」变为「已结束」后，旧条目残留、看板一直显示“进行中”；
// ② 教师删除活动后，旧条目永不消失。
// 任务项 id 形如 `chaoxing:259363438-139380153:task:<hash>`，故用 `:<key>:` 做边界匹配，
// 避免 2593634 误匹配 259363438 这类前缀相同的情况。
//
// kind 参数是「二次过滤」：落进作用域后，还要看条目属于哪一页。
// - 条目 id 带种类段（学习通 task/exam）：只有同种类才归本次清理，其它种类留给它自己的上报；
// - 条目 id 无种类段（收件箱通知、其它平台、旧格式）：保持旧行为，照常清理。
// 这样任务页与作业页各自只替换自己那份数据，不再互相清空。
function isAssignmentInScope(
  item: Assignment,
  scope: Set<string>,
  kind?: AssignmentScopeKind,
): boolean {
  let inScope = scope.has(item.courseId);
  if (!inScope) {
    for (const key of scope) {
      if (key && item.id.includes(`:${key}:`)) {
        inScope = true;
        break;
      }
    }
  }
  if (!inScope) {
    return false;
  }
  if (!kind) {
    return true;
  }
  const matched = item.id.match(SCOPED_ID_KIND_RE);
  return matched ? matched[1] === kind : true;
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

// 是否已过期：仅当存在有效截止时间且早于当前时刻才视为过期。
// 无截止时间（dueAt 为 null）或无法解析的时间一律按“未过期”处理，
// 避免把没有截止时间的作业误隐藏。dueAt 为本地时间 ISO（无时区后缀），
// new Date() 按本机时区解析，与 Date.now() 比较即可，无需时区换算。
export function isAssignmentExpired(dueAt: string | null): boolean {
  if (!dueAt) {
    return false;
  }
  const t = new Date(dueAt).getTime();
  if (Number.isNaN(t)) {
    return false;
  }
  return t < Date.now();
}

// 是否已过期（综合判定）：平台已在状态上明确标记为 'expired' 的条目，即使缺截止时间
// 也按“已过期”处理（状态权威，不依赖 dueAt）；其余情况仍按截止时间判定。
// 这样「自动隐藏已过期项」开关对“平台标已过期但页面未给截止时间”的条目也生效，
// 避免它们在看板里无限期显示“未提供截止时间”（见 2026-10-29 修改意见·问题 2）。
export function isAssignmentExpiredByStatus(
  status: Assignment['status'],
  dueAt: string | null,
): boolean {
  if (status === 'expired') {
    return true;
  }
  return isAssignmentExpired(dueAt);
}

// 看板“是否可见”的统一判定：后台角标 / 通知与弹窗看板必须共用同一套口径，
// 否则会出现“角标 58、看板 19”这类数字对不上的问题（2026-10-29 修改意见·问题 1）。
// 规则：
//  - 默认隐藏 completed / ended（已结束且无提交状态）；
//  - 开启“自动隐藏已过期项”时，再隐藏已过期条目（dueAt 已过 或 状态为 expired）。
export function isAssignmentVisible(
  a: Assignment,
  options: { hideExpired: boolean },
): boolean {
  if (isAssignmentHiddenByDefault(a.status)) {
    return false;
  }
  if (options.hideExpired && isAssignmentExpiredByStatus(a.status, a.dueAt)) {
    return false;
  }
  return true;
}

// 学习通作业/考试/任务项的看板状态标签（源自“学习通任务完成判定规则”）。
// 与 isAssignmentHiddenByDefault 配套：'completed'/'ended' 默认隐藏；'returned'/'retake' 必须显示。
export function assignmentStatusLabel(status: Assignment['status']): string {
  switch (status) {
    case 'unsubmitted':
      return '未提交';
    case 'expired':
      return '已过期';
    case 'in_progress':
      return '进行中';
    case 'submitted':
      return '已提交';
    case 'completed':
      return '已完成';
    case 'ended':
      return '已完成';
    case 'returned':
      return '需重交';
    case 'retake':
      return '已完成（可重考）';
  }
}

// 默认隐藏（无需任何开关）：'completed'/'ended' 代表“已完成/已结束且无提交状态”，
// 按判定规则看板处理为“已完成，隐藏”，避免已完成项长期占位。
// 注意：'expired' 不在此列——它受独立开关“自动隐藏已过期项”控制，默认仍显示。
export function isAssignmentHiddenByDefault(status: Assignment['status']): boolean {
  return status === 'completed' || status === 'ended';
}

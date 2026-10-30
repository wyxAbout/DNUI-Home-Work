// 阶段 B：基于「课程注册表」(courseId + clazzId) 逐课抓取任务/活动列表。
//
// 为什么需要它：学习通网页版没有跨课程的“我的作业”聚合页（2026-10-25 已确认），
// 只能一门一门课进去看。注册表落地后，courseId/clazzId 已与其课程页 URL 交叉验证一致
// （线性代数 = 259363438 / 139380153），因此可以直接拼出每门课的任务列表地址，
// 由后台顺序开“临时后台标签”让页面自己渲染并上报，用户不必手动点进 6 门课。
//
// 端点是 2026-10-25 诊断取证得到的真实地址，不是猜测：
//   https://mobilelearn.chaoxing.com/page/active/stuActiveList?courseid=<courseId>&clazzid=<clazzId>
//
// 注意：该页是 SPA（先出骨架、XHR 再填列表），后台 fetch HTML 拿到的是空壳，
// 所以必须“开标签 → 等 content script 在真实渲染后上报”，与本项目既有的
// 「先取证、再落地」路线一致（诊断工具走的也是同一条确定性路径）。
import type { ChaoxingCourse } from './models';

export const CHAOXING_TASK_LIST_BASE =
  'https://mobilelearn.chaoxing.com/page/active/stuActiveList';

// 作业/考试列表端点（2026-10-29 诊断取证的真实地址）。
// 注意：该页标题叫「考试列表」，但实际是**作业 + 测验 + 课堂活动**的混合列表，
// 是作业进看板的唯一来源；同期取证的 mooc2/work/list 打开只有弹窗、取不到列表，故不用它。
export const CHAOXING_EXAM_LIST_BASE =
  'https://mooc1.chaoxing.com/exam-ans/mooc2/exam/exam-list';

// 一门课需要抓的页面种类：
// - task：任务/活动列表（签到、选人…）→ 进行中 / 已结束；
// - exam：作业/考试列表（作业、测验、课堂活动）→ 未完成 / 已完成 / 已过期。
// 历史缺陷：只抓 task，导致看板里永远没有作业（本轮回补）。
export type ChaoxingCrawlPageKind = 'task' | 'exam';

// 从地址反推页面种类：后台等待表按「种类+课程」分键，必须能从上报的 URL 判断种类。
export function chaoxingCrawlPageKindOf(url: string): ChaoxingCrawlPageKind | null {
  if (!url) return null;
  if (url.includes('stuActiveList')) return 'task';
  if (url.includes('exam-list')) return 'exam';
  return null;
}

// 页面种类的中文名（日志/提示用）。
export function chaoxingCrawlPageLabel(kind: ChaoxingCrawlPageKind): string {
  return kind === 'task' ? '任务列表' : '作业/考试列表';
}

// 单次逐课抓取的课程上限：注册表异常膨胀时避免连开几十个标签把浏览器拖死。
export const CHAOXING_CRAWL_MAX_COURSES = 12;

// 单门课的等待上限：任务列表 SPA 渲染约 3s，这里给网络较慢的情况留足余量。
export const CHAOXING_CRAWL_TIMEOUT_MS = 25_000;

// 一门课里的一页（一门课有 task / exam 两页）。
export interface ChaoxingCrawlPage {
  kind: ChaoxingCrawlPageKind;
  url: string;
}

// 一门课的抓取计划（已校验 ID、已去重）。
export interface ChaoxingCrawlTarget {
  courseId: string;
  clazzId: string;
  name: string;
  // 稳定课程键 `courseid-clazzid`，与任务项 id、合并作用域用的是同一个值。
  courseKey: string;
  // 任务页地址（保留该字段：历史调用方与日志都以它作为“这门课的主地址”）。
  url: string;
  // 本门课要抓的全部页面：任务页 + 作业/考试页。
  pages: ChaoxingCrawlPage[];
}

// 单页抓取结果。必须在整批结果里逐页保留：
// 「6 门课全部成功，但看板没有作业」这种事故，只有把两页各自的成败摊开来看才定位得到
// —— 汇总数字（哪怕加了 partial）都会把“作业页到底成没成”糊过去。
export interface ChaoxingCrawlPageResult {
  kind: ChaoxingCrawlPageKind;
  ok: boolean;
  message: string;
  // 本页解析出的条目数。成功时必须带上：
  // 只说“成功”的话，「作业页成功但 0 条」和「作业页成功抓到 8 条」长得一模一样，
  // 用户没法判断这次同步到底有用没用（2026-10-29 就被“6 门课全部成功”误导过一次）。
  count?: number;
}

// 单门课的抓取结果。
export interface ChaoxingCrawlOutcome {
  courseKey: string;
  name: string;
  ok: boolean;
  message: string;
  // 本门课两页的明细（任务列表 / 作业·考试列表），供弹窗展开查看。
  pages: ChaoxingCrawlPageResult[];
  // 部分成功：至少一页拿到数据，但有页面失败。
  // 必须单独标出来——否则「6 门课全部成功」会把“作业页其实没抓到”掩盖掉，
  // 而“同步成功但看板没有作业”正是 2026-10-29 用户踩到的现象。
  partial?: boolean;
}

// 整批抓取的结果（回给弹窗展示，并逐条写运行日志）。
export interface ChaoxingCrawlReport {
  ok: boolean;
  total: number;
  succeeded: number;
  failed: number;
  items: ChaoxingCrawlOutcome[];
  message: string;
}

// 稳定课程键：与 `chaoxing:<courseKey>:task:<hash>` 的中间段保持一致，
// 也是 mergeAssignmentsByCourse 的作用域值。
export function chaoxingCourseKey(course: { courseId: string; clazzId: string }): string {
  return `${course.courseId}-${course.clazzId}`;
}

// 拼任务/活动列表地址。ID 走 URLSearchParams 编码，避免拼接注入/空值。
export function buildChaoxingTaskListUrl(course: {
  courseId: string;
  clazzId: string;
}): string {
  const params = new URLSearchParams();
  params.set('courseid', course.courseId);
  params.set('clazzid', course.clazzId);
  return `${CHAOXING_TASK_LIST_BASE}?${params.toString()}`;
}

// 拼作业/考试列表地址（参数取自 2026-10-29 取证的真实 URL：courseid/clazzid + v/hideHead/pageHeader）。
// 不含 enc：该参数是会话令牌，随登录态变化，硬编码会立刻失效；
// 首次抓取靠会话鉴权，成功后由「地址记忆」把带 enc 的真实地址记下来供下次优先使用。
export function buildChaoxingExamListUrl(course: { courseId: string; clazzId: string }): string {
  const params = new URLSearchParams();
  params.set('courseid', course.courseId);
  params.set('clazzid', course.clazzId);
  params.set('v', '2');
  params.set('hideHead', '0');
  params.set('pageHeader', '0');
  return `${CHAOXING_EXAM_LIST_BASE}?${params.toString()}`;
}

// 地址记忆的键：页面种类 + 课程键。
// 必须带种类——否则任务页与作业页会互相覆盖，记住的地址永远只剩最后一次成功的那个。
export function crawlUrlMemoryKey(kind: ChaoxingCrawlPageKind, courseKey: string): string {
  return `${kind}:${courseKey}`;
}

// 从一条「页面上报」反推它属于哪几门课，用来兑现逐课同步的等待表。
// 为什么必须从 url 兜底：**解析失败时上报里没有任何课程标识**——
// 页面都没解析出来，自然给不出 courseId/courseIds（content script 的 catch 分支
// 只有 status + message）。若只认 message.courseIds，失败上报永远匹配不到正在等待的课程，
// 于是明明页面早就答复了「列表未渲染」，后台还要硬等到超时，最后把原因误报成
// 「超时，可能未登录」（2026-10-29 用户实测：6 门课中 1 门作业页“超时”，实为解析失败）。
// URL 上的 courseid/clazzid 是唯一在成败两种情况下都存在的线索。
export function crawlCourseKeysOfReport(report: {
  url: string;
  courseId?: string;
  courseIds?: string[];
}): string[] {
  const keys = new Set<string>();
  for (const raw of report.courseIds ?? []) {
    const key = (raw ?? '').trim();
    if (key) {
      keys.add(key);
    }
  }
  const single = (report.courseId ?? '').trim();
  if (single) {
    keys.add(single);
  }
  try {
    const params = new URL(report.url).searchParams;
    const cid = (params.get('courseid') || params.get('courseId') || '').trim();
    const lid = (params.get('clazzid') || params.get('classId') || '').trim();
    if (cid && lid) {
      keys.add(`${cid}-${lid}`);
    }
  } catch {
    // URL 异常时只用手上已有的键，不抛错（宁可少兑现，也不能让上报流程失败）。
  }
  return [...keys];
}

// 把注册表转成抓取计划：跳过缺 ID 的残缺条目、按 courseKey 去重、限制总门数。
// 顺序即注册表顺序（「我的课程」页的展示顺序），保证每次抓取顺序稳定、便于对照日志。
export function planChaoxingCrawl(
  courses: ChaoxingCourse[],
  max = CHAOXING_CRAWL_MAX_COURSES,
): ChaoxingCrawlTarget[] {
  const seen = new Set<string>();
  const plan: ChaoxingCrawlTarget[] = [];
  for (const course of courses) {
    const courseId = (course.courseId ?? '').trim();
    const clazzId = (course.clazzId ?? '').trim();
    if (!courseId || !clazzId) {
      continue;
    }
    const courseKey = chaoxingCourseKey({ courseId, clazzId });
    if (seen.has(courseKey)) {
      continue;
    }
    seen.add(courseKey);
    const taskUrl = buildChaoxingTaskListUrl({ courseId, clazzId });
    plan.push({
      courseId,
      clazzId,
      name: course.name || courseKey,
      courseKey,
      url: taskUrl,
      pages: [
        { kind: 'task', url: taskUrl },
        { kind: 'exam', url: buildChaoxingExamListUrl({ courseId, clazzId }) },
      ],
    });
    if (plan.length >= max) {
      break;
    }
  }
  return plan;
}

// 汇总成一句给用户看的话（写日志与弹窗同一口径）。
export function summarizeChaoxingCrawl(items: ChaoxingCrawlOutcome[]): string {
  const total = items.length;
  if (total === 0) {
    return '没有可抓取的课程（课程注册表为空或缺少 courseId/clazzId）';
  }
  const succeeded = items.filter((it) => it.ok).length;
  const failed = total - succeeded;
  const partial = items.filter((it) => it.ok && it.partial).length;
  if (failed === 0 && partial === 0) {
    return `逐课同步完成：${total} 门课全部成功`;
  }
  if (failed === 0) {
    return `逐课同步完成：${total} 门课均有数据入库，其中 ${partial} 门有页面失败（详见运行日志）`;
  }
  if (succeeded === 0) {
    return `逐课同步失败：${total} 门课均未成功（详见运行日志）`;
  }
  return `逐课同步完成：${succeeded}/${total} 门课成功，${failed} 门失败（详见运行日志）`;
}

// 某一页失败时，把“下一步该做什么”补进 message。
// 只报“超时 / 未渲染”对用户没有可操作性；作业页的典型失败是缺会话参数（enc），
// 而解法非常具体：在浏览器里打开一次该课程的「作业」页，让扩展记住带参数的地址。
export function withChaoxingPageAdvice(
  kind: ChaoxingCrawlPageKind,
  ok: boolean,
  message: string,
): string {
  if (ok) {
    return message;
  }
  const examAdvice =
    '作业/考试列表需要页面自带的会话参数（enc），请先在浏览器里打开一次该课程的「作业」页，再重试逐课同步';
  // 判定顺序很重要：先「未渲染/解析失败」，再「超时」，最后才是「登录」通配。
  // 反过来会被 /登录/ 吃掉——超时文案本身就写着“可能未登录”，
  // 于是所有失败都只剩一句“请先登录”，而真正有效的一步（打开一次作业页）永远说不出来。
  if (/未渲染|解析异常|选择器|无法识别/.test(message)) {
    return kind === 'exam' ? `${message}。${examAdvice}` : `${message}。页面可能加载过慢，请重试逐课同步`;
  }
  if (/超时/.test(message)) {
    return kind === 'exam'
      ? `${message}。${examAdvice}`
      : `${message}。请确认已登录学习通后重试逐课同步`;
  }
  if (/未登录|登录|login/i.test(message)) {
    return `${message}。请先在浏览器里登录学习通，再重试逐课同步`;
  }
  if (kind === 'exam') {
    return `${message}。${examAdvice}`;
  }
  return message;
}

// 逐课同步的**状态存档**：写在本机 storage，弹窗读它来显示进度/结果。
// 为什么不靠 sendMessage 的返回值：Chrome 的 onMessage 一条消息只能有一个应答者，
// 而 background 里既有的“页面上报”监听器是 async 函数（返回 Promise ⇒ 会被当成应答，
// 直接回 `undefined`），把逐课同步的响应通道先占掉了 —— 表现为弹窗永远显示“未返回结果”。
// 改用状态存档后：后台照常干活、弹窗关掉再开也能看到结果，且不受消息语义影响。
export interface ChaoxingCrawlState {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  total: number;
  succeeded: number;
  failed: number;
  message: string | null;
  // 逐门课、逐页的结果明细。存档里保留它，弹窗才能回答
  // 「作业页到底抓没抓到、拿到几条」——只看汇总数字永远查不出问题在哪。
  items: ChaoxingCrawlOutcome[];
}

export function createIdleCrawlState(): ChaoxingCrawlState {
  return {
    running: false,
    startedAt: null,
    finishedAt: null,
    total: 0,
    succeeded: 0,
    failed: 0,
    message: null,
    items: [],
  };
}

// 开跑时的状态：清掉上一轮结果，避免弹窗把旧结论当成本轮结果展示。
export function createRunningCrawlState(startedAt: string): ChaoxingCrawlState {
  return {
    running: true,
    startedAt,
    finishedAt: null,
    total: 0,
    succeeded: 0,
    failed: 0,
    message: null,
    items: [],
  };
}

export function createFinishedCrawlState(
  report: ChaoxingCrawlReport,
  startedAt: string,
  finishedAt: string,
): ChaoxingCrawlState {
  return {
    running: false,
    startedAt,
    finishedAt,
    total: report.total,
    succeeded: report.succeeded,
    failed: report.failed,
    message: report.message,
    items: report.items,
  };
}

// 候选内容页 URL 的合并：外壳 URL 的查询参数（courseid/clazzid/cpi…）补进左侧菜单
// `a[data-url]` 的地址里，**只补缺失的键**（data-url 自带的 enc/cpi 优先）。
// 反面教材（本次修复的 bug）：直接 `dataUrl + '?courseid=…'` 会拼出两个 `?`，
// 参数被截断 → 作业/考试列表页打开后是空壳或错误页，于是“只能诊断任务，作业/考试诊断不出来”。
export function mergeChaoxingFrameUrl(base: string, extraQuery: string, origin: string): string {
  try {
    const url = new URL(base, origin);
    const extra = new URLSearchParams(extraQuery.startsWith('?') ? extraQuery.slice(1) : extraQuery);
    extra.forEach((value, key) => {
      if (!url.searchParams.has(key)) {
        url.searchParams.set(key, value);
      }
    });
    return url.toString();
  } catch {
    return base;
  }
}

// 诊断输出必须去敏：URL 只保留 origin+pathname，查询串（含 stuenc/cpi 等会话参数）省略。
export function redactDiagnosticUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.search ? `${u.origin}${u.pathname}?…[查询参数已省略]` : `${u.origin}${u.pathname}`;
  } catch {
    return url.replace(/\?.*$/, '?…');
  }
}

// 课程任务列表的地址候选顺序：**先用上次真实成功过的地址，再用自己拼的地址**。
// 原因：泛雅外壳给 iframe 的地址常带会话参数（stuenc/t/cpi 等），
// 自己拼的 `?courseid=&clazzid=` 通常能打开，但换环境/换登录态时可能不被接受；
// 反过来，记下来的地址可能因会话更新而失效。两者互为后备，比只赌一个稳。
export function orderCrawlCandidateUrls(constructed: string, remembered?: string): string[] {
  const urls = [remembered, constructed].filter(
    (u): u is string => typeof u === 'string' && u.trim().length > 0,
  );
  return [...new Set(urls)];
}

// 记住某门课“刚才真的解析成功”的那个地址（由 background 在收到成功上报时写入）。
// 只保留最近 N 门，避免长期运行后无限增长。
export const CHAOXING_TASK_URL_MEMORY_LIMIT = 24;

export function rememberCourseTaskUrl(
  memory: Record<string, string>,
  courseKey: string,
  url: string,
  limit = CHAOXING_TASK_URL_MEMORY_LIMIT,
): Record<string, string> {
  if (!courseKey || !url) {
    return memory;
  }
  const next: Record<string, string> = { ...memory, [courseKey]: url };
  const keys = Object.keys(next);
  if (keys.length > limit) {
    for (const key of keys.slice(0, keys.length - limit)) {
      delete next[key];
    }
  }
  return next;
}

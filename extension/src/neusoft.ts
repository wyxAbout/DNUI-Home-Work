// 东软智慧教育作业解析器（真实实现，非占位）。
//
// 依据：已核实的“课程详情 → 作业”页可见文本结构（脱敏诊断样本，2026-10-22）：
//   汇总：已完成 X/Y
//   每项：<两位序号><中文标题> <类型如“课后”> 剩余作答次数：N 进行中 状态： 已作答|作答中|未作答
//         公布答案：截止后自动公布 公布成绩：截止后自动公布 <详情|去作答>
//
// 状态语义（小任务 3 结论）：
//   已作答 = 已提交（排除）；
//   作答中 / 未作答 = 尚未提交（纳入看板）。
//
// 安全与正确性约束（来自交接文档）：
// - 不猜测 API / 字段；仅基于已核实的可见结构解析。
// - 只有确认列表完整（解析条数 === 汇总总数）且解析成功时，才返回 success。
// - 列表未渲染 / 不完整 / 非课程页 / 登录失效时，返回 null 或 needs-verification，
//   绝不覆盖上次成功的缓存。

import type { Assignment, PlatformExtractionResult } from './models';
import { PLATFORM_SELECTOR_CONFIG } from './selectors.ts';

// 选择器集中配置（反馈 2.3：抽成配置，避免学校改版时逐个翻解析器）。
const neusoftCfg = PLATFORM_SELECTOR_CONFIG.neusoft;

interface NeusoftExtractOptions {
  // 是否允许主动点击“作业”标签。
  // - 页面自动上报（document_idle）：false，避免打断用户当前所在的标签页；
  // - 用户在看板点“刷新当前平台”（SYNC_ACTIVE_PAGE）：true，允许自动打开作业标签取数。
  allowAutoOpen: boolean;
}

interface ParsedItem {
  index: string;
  title: string;
  remainingAttempts: string;
  status: string;
  action: string;
  submitted: boolean;
}

const ASSIGNMENT_MARKER = /剩余作答次数|已完成\s*\d+\s*\/\s*\d+/;

// 首页“我的学习任务”区块标题（跨课程汇总的主来源）。
const HOME_SECTION_RE = /我的学习任务/;

// 严格规则：类型固定为“课后”（已验证的真实结构）。
const STRICT_ITEM_RE =
  /(\d{2})(?=[\u4e00-\u9fff])(.+?)\s+课后\s+剩余作答次数：(\d+)\D*?状态：\s*(已作答|作答中|未作答)[\s\S]*?(详情|去作答)/g;
// 宽松规则：类型槽位放宽为任意 1~8 个非空白字符（兼容“测验/作业”等其它类型），
// 仅在严格规则一无所获时启用，避免误判。
const LOOSE_ITEM_RE =
  /(\d{2})(?=[\u4e00-\u9fff])(.+?)\s+\S{1,8}\s+剩余作答次数：(\d+)\D*?状态：\s*(已作答|作答中|未作答)[\s\S]*?(详情|去作答)/g;

function parseWith(re: RegExp, text: string): ParsedItem[] {
  const items: ParsedItem[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const status = m?.[4] ?? '';
    items.push({
      index: m?.[1] ?? '',
      title: (m?.[2] ?? '').replace(/\s+/g, ' ').trim(),
      remainingAttempts: m?.[3] ?? '',
      status,
      action: m?.[5] ?? '',
      submitted: status === '已作答',
    });
  }
  return items;
}

// 纯文本解析（无 DOM 依赖，便于单测）：把作业区可见文本解析为作业项数组。
export function parseNeusoftAssignmentText(text: string): ParsedItem[] {
  const strict = parseWith(STRICT_ITEM_RE, text);
  if (strict.length > 0) return strict;
  return parseWith(LOOSE_ITEM_RE, text);
}

// ============ 首页“我的学习任务”解析（跨课程，无需点击标签） ============
//
// 已核实结构（2026-10-22 主页诊断）：
//   <序号?><标题> 作业 截止时间：YYYY-MM-DD HH:MM:SS所属课程：<课程名> 去作答
// 例：
//   11第十一章 以保障和改善民生为重点加强社会建设 作业 截止时间：2026-12-11 23:59:59所属课程：习近平新时代中国特色社会主义思想概论 去作答
//   人工智能基础篇：计算机视觉基础与图像识别原理 作业 截止时间：2026-10-27 23:59:59所属课程：人工智能通识 去作答
//
// 要点：
// - 该区块在首页直接渲染，无需点击任何标签，是跨课程汇总的最佳单一来源。
// - 每项自带“所属课程”（课程名）与“截止时间”（截止日期），天然支持跨课程 + 截止时间展示。
// - 仅捕获动作=“去作答”的项（即尚未提交），与看板“只显示未提交”的语义一致。
// - 序号可选（部分项无序号，如“人工智能基础篇…”），用 CJK 前瞻区分“序号+中文标题”与误命中。

// 锚点：每项任务的核心字段（截止时间 + 所属课程 + 去作答动作）。
// 注意：**类型标签不能写死**——实测同一区块内既有“作业”，也有“测验”“考试”等，
//       早期写成 `作业\s*截止时间：` 会把“测验”类任务整条漏掉（2026-10-22 实测踩坑）。
// 标题不写进正则，而是取“上一个锚点结尾 ~ 本锚点开头”之间的文本，
// 这样标题里出现“作业/测验”等字样也不会破坏解析（纯惰性匹配会把界面文案一起吞掉）。
const HOME_ANCHOR_RE =
  /截止时间：(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s*所属课程：(.+?)\s*去作答/g;

// 标题区末尾会紧跟一个类型标签（作业/测验/考试/课堂练习…），剥掉它使标题保持干净。
// 只剥“末尾独立、且很短”的那个词：标题本身可能以“测验”结尾（《新思想概论》测验三），
// 不能因为含关键词就把标题尾巴当类型切掉。
const HOME_TYPE_SUFFIX_RE = /(?:^|\s)([^\s]{1,6})$/;
const HOME_TYPE_KEYWORD_RE = /作业|测验|考试|实验|练习|测试|讨论|互评|任务/;

// 首项之前会残留区块标题与筛选器文案（“我的学习任务”“请选择所属课程”“未作答/作答中”等），
// 取最后一个已知分隔符之后的文本作为标题，避免把界面文案误当作作业标题。
const HOME_CHROME_MARKERS = ['去作答', '请选择所属课程', '作答中', '我的学习任务'];

function stripHomeChrome(region: string): string {
  let cut = 0;
  for (const marker of HOME_CHROME_MARKERS) {
    const at = region.lastIndexOf(marker);
    if (at >= 0) {
      cut = Math.max(cut, at + marker.length);
    }
  }
  return region.slice(cut).trim();
}

// 剥掉标题末尾的类型标签（“《新思想概论》测验三 测验 作业” → “《新思想概论》测验三”）。
// 部分行会同时渲染多个标签（如“测验”“作业”），故最多连续剥 3 次。
function stripTrailingType(region: string): string {
  let out = region;
  for (let i = 0; i < 3; i += 1) {
    const token = out.match(HOME_TYPE_SUFFIX_RE)?.[1];
    if (!token || !HOME_TYPE_KEYWORD_RE.test(token)) {
      break;
    }
    const next = out.slice(0, out.length - token.length).trim();
    if (!next) {
      break;
    }
    out = next;
  }
  return out;
}

export interface ParsedHomeItem {
  index: string | null;
  title: string;
  courseName: string;
  dueAt: string; // 本地时间 ISO（由“YYYY-MM-DD HH:MM:SS”转换）
}

export function parseNeusoftHomeTasks(text: string): ParsedHomeItem[] {
  const items: ParsedHomeItem[] = [];
  const re = new RegExp(HOME_ANCHOR_RE.source, 'g');
  let prevEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = m.index ?? 0;
    const region = stripTrailingType(stripHomeChrome(text.slice(prevEnd, start)));
    prevEnd = start + (m[0]?.length ?? 0);

    // 可选的序号：标题以数字开头且紧接中文时视为序号（如“11第十一章 …”）。
    const idxMatch = region.match(/^(\d+)(?=[\u4e00-\u9fff])/);
    const index = idxMatch?.[1] ?? null;
    const title = (index ? region.slice(index.length) : region).replace(/\s+/g, ' ').trim();
    const courseName = (m?.[2] ?? '').replace(/\s+/g, ' ').trim();
    const dueRaw = m?.[1] ?? '';
    if (!title || !courseName) continue;
    // “截止时间：2026-12-11 23:59:59” → 本地时间 ISO（“ ”替换为“T”，浏览器按本地时区解析）。
    const dueAt = dueRaw ? dueRaw.replace(' ', 'T') : '';
    items.push({ index, title, courseName, dueAt });
  }
  return items;
}

// 由课程名生成稳定课程标识（与平台无关，仅用于本机分组/合并键）。
export function slugifyCourse(name: string): string {
  const s = name.trim().replace(/\s+/g, '_');
  return s.replace(/[^\w一-龥]/g, '_').slice(0, 60) || 'unknown';
}

function hashString(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (h * 31 + value.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

// 主动寻找“作业”类标签（优先 Element UI 标签选择器，再回退到通用可点击节点）。
function findAssignmentTab(doc: Document): HTMLElement | null {
  const isAssignmentTab = (el: Element): boolean => {
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!/^作业/.test(text)) return false;
    if (text.length > 12) return false;
    return true;
  };

  // 1) 优先标准标签选择器，避免全量遍历大 DOM。
  for (const sel of neusoftCfg.fields.assignmentTab!.split(',').map((s) => s.trim())) {
    for (const el of Array.from(doc.querySelectorAll(sel))) {
      if (isAssignmentTab(el)) return el as HTMLElement;
    }
  }

  // 2) 回退：通用可点击节点。
  for (const el of Array.from(doc.querySelectorAll('*'))) {
    if (!isAssignmentTab(el)) continue;
    if (el.children.length > 3) continue;
    if (el.tagName === 'BODY' || el.tagName === 'HTML') continue;
    const tag = el.tagName.toLowerCase();
    const cls = typeof el.className === 'string' ? el.className : '';
    const clickable =
      tag === 'a' ||
      tag === 'button' ||
      /tab|menu|item|click|cursor-pointer/.test(cls) ||
      (el as HTMLElement).onclick != null;
    if (clickable) return el as HTMLElement;
  }
  return null;
}

function waitFor(predicate: () => boolean, timeoutMs: number, intervalMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      try {
        if (predicate()) {
          resolve(true);
          return;
        }
      } catch {
        /* 忽略瞬时读取异常 */
      }
      if (Date.now() - start >= timeoutMs) {
        resolve(false);
        return;
      }
      window.setTimeout(tick, intervalMs);
    };
    tick();
  });
}

// 从课程页 URL 中提取稳定课程标识（优先取末段长数字），用于生成稳定作业 ID。
function deriveCourseId(url: string): string {
  try {
    const u = new URL(url);
    const nums = u.pathname.match(/\d{3,}/g);
    if (nums && nums.length > 0) return nums[nums.length - 1] ?? 'unknown';
    const slug = u.pathname.replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '');
    return slug.slice(-48) || 'unknown';
  } catch {
    return 'unknown';
  }
}

// 从课程页提取可读课程名（best-effort，绝不影响解析主流程）：
// 优先内容区主标题，回退页面标题剥离站点后缀，再回退 courseId。
function extractCourseName(doc: Document, fallback: string): string {
  const headingSelectors = neusoftCfg.fields.courseTitle!.split(',').map((s) => s.trim());
  for (const sel of headingSelectors) {
    const el = doc.querySelector(sel);
    const text = (el?.textContent || '').replace(/\s+/g, ' ').trim();
    if (text && text.length > 0 && text.length <= 60) {
      return text;
    }
  }
  const titleMatch = (doc.title || '').match(/^([^_\-—|]+)/);
  const title = titleMatch ? (titleMatch[1] ?? '').trim() : '';
  if (title && title.length <= 60) {
    return title;
  }
  return fallback;
}

// 定位首页“我的学习任务”区块本身。
// 注意：不能直接用 `.my-task`——它同时包住“我的考试”等其它区块，
// 后者自带 `.noData` 空态，会让“学习任务为空”的判定误命中（2026-10-22 实测踩坑）。
export function findHomeTaskBlock(doc: Document): HTMLElement | null {
  const nodes = Array.from(doc.querySelectorAll(neusoftCfg.fields.homeTaskBlock!));
  for (const el of nodes) {
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    // 标题可能带后缀（如“我的学习任务（3）”），故用前缀匹配 + 长度上限。
    if (!text.startsWith('我的学习任务') || text.length > 10) continue;
    // 从标题向上找，取第一个真正包含任务列表或空态的容器（最多上溯 5 层）。
    let node = el.parentElement;
    let first: HTMLElement | null = null;
    for (let depth = 0; node && depth < 5; depth += 1) {
      if (!first) first = node;
      const inner = (node.innerText || '').replace(/\s+/g, ' ');
      if (/去作答/.test(inner) || hasEmptyMarker(node)) {
        return node;
      }
      node = node.parentElement;
    }
    return first;
  }
  return null;
}

// 空态标记：Element UI / 平台自定义的空状态组件。
function hasEmptyMarker(el: HTMLElement): boolean {
  return !!el.querySelector(neusoftCfg.fields.emptyMarker!);
}

// 首页“我的学习任务”空态判定：只看该区块内部，DOM 空状态组件优先，回退文本关键词。
// 仅用于“区块已渲染但没有任何待办”的场合，避免结构变化时被误判成“全部已完成”而清空缓存。
function hasHomeEmptyState(block: HTMLElement): boolean {
  const text = (block.textContent || '').replace(/\s+/g, ' ');
  // 只要区块里出现“去作答”动作，就一定有可作答项，绝不判为空（防止空态类名误命中清缓存）。
  if (/去作答/.test(text)) {
    return false;
  }
  if (hasEmptyMarker(block)) {
    return true;
  }
  return /暂无|无待办|没有待|无任务|无数据|空空如也/.test(text);
}

export async function extractNeusoftAssignments(
  doc: Document,
  url: string,
  options: NeusoftExtractOptions,
): Promise<PlatformExtractionResult | null> {
  const getContentEl = (): HTMLElement | null => {
    // 课程详情页用 .v-content-wrap；首页“我的学习任务”用 .my-task（回退 .v-layout-content / body）。
    const el =
      doc.querySelector(neusoftCfg.fields.contentWrap!) ??
      doc.querySelector(neusoftCfg.fields.myTask!) ??
      doc.querySelector(neusoftCfg.fields.layoutContent!) ??
      doc.body;
    return (el as HTMLElement | null) ?? null;
  };

  // 0) SPA 挂载等待：document_idle 时 Vue 应用可能尚未渲染出内容容器，
  //    需要有限等待，否则会误判为“非课程页”。
  if (!getContentEl()) {
    const appeared = await waitFor(
      () => !!getContentEl(),
      options.allowAutoOpen ? 4000 : 2500,
      200,
    );
    if (!appeared) {
      // 仍无内容容器：登录失效则报 login-required，否则视为非课程页静默跳过。
      const hasPassword = !!doc.querySelector('input[type="password"]');
      if (hasPassword && /登录|login/i.test(doc.title || '')) {
        return { status: 'login-required', assignments: [], message: '东软需要登录，未更新数据。' };
      }
      return null;
    }
  }

  // 内容容器文本过短时回退整页：首页 .my-task 可能是先渲染的空壳，
  // 真正的任务列表稍后才填充，直接用整页文本可避免漏抓。
  const readText = () => {
    const primary = (getContentEl()?.innerText || '').replace(/\s+/g, ' ').trim();
    if (primary.length >= 40) {
      return primary;
    }
    return (doc.body?.innerText || '').replace(/\s+/g, ' ').trim();
  };

  // 首页任务区文本：优先只看“我的学习任务”区块（排除“我的考试/我的项目”等干扰），
  // 区块未定位到时回退整页文本。
  const readHomeText = () =>
    (findHomeTaskBlock(doc)?.innerText || '').replace(/\s+/g, ' ').trim() || readText();

  // 0.5) 等待 SPA 渲染出有意义的内容：首页任务区块或课程作业标记任一出现即可。
  //     document_idle 时 Vue 应用可能连 body 都还没渲染出文本，直接判定会漏同步。
  const pageReady = () => {
    if (findHomeTaskBlock(doc)) {
      return true;
    }
    const t = readText();
    return t.length > 0 && (HOME_SECTION_RE.test(t) || ASSIGNMENT_MARKER.test(t));
  };
  if (!pageReady()) {
    await waitFor(pageReady, options.allowAutoOpen ? 5000 : 3000, 200);
  }

  // 1) 首页“我的学习任务”优先：该区块在首页直接渲染，且天然跨多门课程，
  //    每项自带所属课程与截止时间，是跨课程汇总的最佳单一来源，无需点击任何标签。
  //
  //    注意时序：区块标题可能已渲染而列表仍在异步加载，
  //    故标题出现但解析为空时，做一次有界等待再判定。
  const readHomeItems = () => parseNeusoftHomeTasks(readHomeText());

  let homeItems = readHomeItems();
  if (homeItems.length === 0 && HOME_SECTION_RE.test(readText())) {
    const rendered = await waitFor(
      () => readHomeItems().length > 0,
      options.allowAutoOpen ? 5000 : 3000,
      200,
    );
    if (rendered) {
      homeItems = readHomeItems();
    }
  }

  if (homeItems.length > 0) {
    const syncedAt = new Date().toISOString();
    const assignments: Assignment[] = homeItems.map((item) => {
      const courseId = slugifyCourse(item.courseName);
      const id = `neusoft:home:${courseId}:${item.index ?? 'x'}:${hashString(item.title)}`;
      return {
        id,
        platformId: 'neusoft',
        courseId,
        courseName: item.courseName,
        title: item.title,
        dueAt: item.dueAt || null,
        // “去作答”为按钮而非 <a href>，无逐项深链，回退到首页 URL。
        url,
        status: 'unsubmitted',
        syncedAt,
        source: 'home',
      };
    });
    const courseIds = [...new Set(assignments.map((a) => a.courseId))];
    return {
      status: 'success',
      assignments,
      message: `东软首页“我的学习任务”：待提交 ${assignments.length} 项，覆盖 ${courseIds.length} 门课程。`,
      courseIds,
    };
  }

  // 首页“我的学习任务”区块存在但待办为空：
  // - 若命中明确的空态标记（“暂无数据”等），说明确实没有待提交作业 → 成功且清空该平台缓存。
  // - 否则视为结构变化/渲染不全 → 静默跳过，绝不覆盖上次成功的缓存。
  // 无论哪种情况都不再走课程详情逻辑，避免误点首页的筛选标签。
  const homeBlock = findHomeTaskBlock(doc);
  if (homeBlock || HOME_SECTION_RE.test(readText())) {
    // 空态必须只看“我的学习任务”区块自身：`.my-task` 里还有“我的考试”，
    // 它自带 `.noData`，用整块判定会把“有任务”误判成“没有待办”并清空缓存。
    if (homeBlock && hasHomeEmptyState(homeBlock)) {
      return {
        status: 'success',
        assignments: [],
        message: '东软首页“我的学习任务”：暂无待提交作业。',
        replaceAll: true,
      };
    }
    // 区块在、也没判空，却解析不出条目 → 明确报“待验证”，让看板状态与日志可见，
    // 而不是静默跳过（否则用户只看到数据不更新，无从判断原因）。
    return {
      status: 'needs-verification',
      assignments: [],
      message: `东软首页：未从“我的学习任务”解析出条目（区块文本 ${(readHomeText().length)} 字，列表可能仍在渲染或结构已变化），未更新数据。`,
    };
  }

  const hasMarkers = () => ASSIGNMENT_MARKER.test(readText());

  // 2) 作业列表未渲染时：
  //    - 被动上报：短暂等待渲染（用户可能已停在作业标签）；仍未出现则静默跳过。
  //    - 显式刷新：主动点击“作业”标签并等待渲染。
  if (!hasMarkers()) {
    if (!options.allowAutoOpen) {
      const rendered = await waitFor(hasMarkers, 2000, 200);
      if (!rendered) return null;
    } else {
      const tab = findAssignmentTab(doc);
      if (!tab) {
        return {
          status: 'needs-verification',
          assignments: [],
          message: '未找到“作业”标签，未更新数据。',
        };
      }
      try {
        tab.click();
      } catch {
        /* 点击失败按未渲染处理 */
      }
      const rendered = await waitFor(hasMarkers, 4500, 200);
      if (!rendered) {
        return {
          status: 'needs-verification',
          assignments: [],
          message: '已点击“作业”标签但列表未渲染，未更新数据。',
        };
      }
    }
  }

  // 3) 解析汇总与逐项。
  const text = readText();
  const summaryMatch = text.match(/已完成\s*(\d+)\s*\/\s*(\d+)/);
  if (!summaryMatch) {
    return {
      status: 'needs-verification',
      assignments: [],
      message: '未找到作业完成汇总，未更新数据。',
    };
  }
  const done = Number(summaryMatch[1]);
  const total = Number(summaryMatch[2]);

  const parsed = parseNeusoftAssignmentText(text);

  // 4) 完整性校验：解析条数必须等于汇总总数，否则视为渲染不全，不覆盖缓存。
  if (parsed.length !== total) {
    return {
      status: 'needs-verification',
      assignments: [],
      message: `作业列表可能未完整渲染（解析 ${parsed.length}/${total}），未更新数据。`,
    };
  }

  // 5) 仅纳入未提交项（作答中 / 未作答），已作答视为已提交并排除。
  const unsubmitted = parsed.filter((item) => !item.submitted);
  const courseId = deriveCourseId(url);
  const courseName = extractCourseName(doc, courseId);
  const syncedAt = new Date().toISOString();

  const assignments: Assignment[] = unsubmitted.map((item) => ({
    id: `neusoft:${courseId}:${item.index}`,
    platformId: 'neusoft',
    courseId,
    courseName,
    title: item.title,
    // 可见文本未提供明确截止时间（仅“截止后自动公布”），按“若无则不填”处理。
    dueAt: null,
    // “去作答/详情”为 JS 按钮而非 <a href>，无法稳定取得逐项深链，回退到课程页 URL。
    url,
    status: 'unsubmitted',
    syncedAt,
    source: 'course',
  }));

  return {
    status: 'success',
    assignments,
    message: `东软作业（${courseName}）：已完成 ${done}/${total}，待提交 ${assignments.length} 项。`,
    courseId,
    courseName,
    courseIds: [courseId],
  };
}

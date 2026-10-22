// iTEST 作业（考试）解析器（真实实现，基于已核实的页面诊断样本，2026-10-22）。
//
// 依据：用户在已登录的 iTEST 学生考试页（itestcloud.unipus.cn/utest/itest/s/exam）
// 运行去敏诊断（diagnose.ts）后贴回的真实结构：
//
//   顶部汇总：全部考试 12 待完成 2 已完成 10 诊断报告 0
//   每条考试：<标签 如“日常”> <名称（含“（ID：数字）”> <类型 如“学校考试”>
//            <状态按钮/标签 如“进入考试”/“缺考”> <状态提示 如“考试已开始，请进入作答”>
//            考试终端：… 考试总分：… 考试时长：… 进入时间：YYYY-MM-DD HH:MM:SS - YYYY-MM-DD HH:MM:SS 考试地点：…
//   分页：共 N 条
//
// “未提交”语义（对应平台“待完成”桶）：
//   - 待完成 / 仍可作答：状态提示含“考试已开始，请进入作答”“进入考试”等
//     → 归类为 pending（纳入看板）。
//   - 缺考 / 已错过：状态提示含“考试已结束，无法参加考试”或“缺考”标签
//     → 归类为 absent（同样属于平台“待完成”计数，纳入看板并提示已错过截止）。
//   - 已完成：状态提示含“已完成 / 已提交 / 已交卷 / 成绩已出”等 → 排除。
//
// 实现约束（同东软交接文档，不猜测）：
//   - 仅基于已核实的可见文本结构解析，不猜 API / 字段 / 深链。
//   - “进入考试”为 JS 按钮而非 <a href>，无逐项深链证据 → url 回退到考试列表页。
//   - 只有解析出的“未提交”条数与页面“待完成”汇总一致（或页面确实为空）时，
//     才返回 success；否则返回 needs-verification，后台绝不覆盖上次成功的缓存。

import type { Assignment, PlatformExtractionResult } from './models';
import { slugifyCourse } from './neusoft.ts';

interface ItestExtractOptions {
  // 是否允许主动交互（语义同 neusoft.ts / platforms.ts）：
  // - 页面自动上报（document_idle）：false；
  // - 用户在看板点“刷新当前平台”（SYNC_ACTIVE_PAGE）：true。
  // 当前 iTEST 解析为纯只读文本扫描，不点击任何元素；该参数仅用于放宽 SPA 渲染等待时长。
  allowAutoOpen: boolean;
}

export type ItestItemStatus = 'done' | 'absent' | 'pending' | 'unknown';

export interface ParsedItestItem {
  examId: string | null;
  title: string;
  type: string | null;
  tag: string | null;
  // 截止时间：进入时间窗口的结束时刻（本地时间 ISO），无则为 null。
  dueAt: string | null;
  // 未提交分类：done=已完成（排除）；absent=缺考/已错过；pending=仍可作答；unknown=无法判定。
  status: ItestItemStatus;
}

// ============ 纯文本解析（无 DOM 依赖，便于单测） ============
//
// 设计：不以 CSS module 哈希类名为锚（每次前端发布都会变），而以用户稳定可见的
// “（ID：数字）”作为每条考试的边界；标题/标签取该边界前紧邻的两个词，类型/状态/时间
// 取该边界之后的片段。这样即使样式类名变更，只要可见文案不变即可解析。

const ID_RE = /（ID：(\d+)）/g;

// 单条考试未提交状态分类（基于该条可见文本）。
export function classifyItestStatus(text: string): ItestItemStatus {
  const t = (text || '').replace(/\s+/g, ' ');
  if (/已完成|已提交|已交卷|成绩已出|已批阅/.test(t)) return 'done';
  if (/已结束|无法参加|缺考/.test(t)) return 'absent';
  if (/请进入作答|已进入|进行中|可进入|未开始|考试已开始|进入考试/.test(t)) return 'pending';
  return 'unknown';
}

// 从单条考试的“边界之后片段”抽取类型（首个词）与截止时间（进入时间窗口结束时刻）。
function parseRest(rest: string): { type: string | null; dueAt: string | null } {
  const trimmed = rest.replace(/^\s+/, '');
  const typeMatch = trimmed.match(/^(\S+)/);
  const type = typeMatch && typeMatch[1] && !/^（/.test(typeMatch[1]) ? typeMatch[1] : null;
  const dueMatch = rest.match(
    /进入时间：\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\s*-\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/,
  );
  const dueAt = dueMatch ? (dueMatch[1] ?? '').replace(' ', 'T') : null;
  return { type, dueAt };
}

// 解析整页可见文本：返回“待完成”汇总数与每条考试的结构化结果。
export function parseItestExamPageText(text: string): {
  pendingCount: number | null;
  items: ParsedItestItem[];
} {
  const pendingMatch = text.match(/待完成\s*(\d+)/);
  const pendingCount = pendingMatch ? Number(pendingMatch[1]) : null;

  // 先收集所有“（ID：数字）”边界位置。
  const ids: { id: string; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  ID_RE.lastIndex = 0;
  while ((m = ID_RE.exec(text)) !== null) {
    ids.push({ id: m[1] ?? '', start: m.index, end: m.index + (m[0]?.length ?? 0) });
  }

  const items: ParsedItestItem[] = [];
  for (let i = 0; i < ids.length; i += 1) {
    const cur = ids[i] as { id: string; start: number; end: number };
    const prevEnd = i > 0 ? (ids[i - 1] as { end: number }).end : 0;
    const nextStart = i + 1 < ids.length ? (ids[i + 1] as { start: number }).start : text.length;

    // 头部 = 上一条边界之后 ~ 本条 ID 之前：末尾两词为 [标签, 标题]。
    const head = text.slice(prevEnd, cur.start).replace(/\s+$/, '');
    const headTokens = head.split(/\s+/).filter(Boolean);
    const title = headTokens.length > 0 ? (headTokens[headTokens.length - 1] ?? '') : '';
    const tag =
      headTokens.length >= 2 ? (headTokens[headTokens.length - 2] ?? null) : null;

    // 尾部 = 本条 ID 之后 ~ 下一条 ID 之前：类型 / 状态 / 时间。
    const rest = text.slice(cur.end, nextStart);
    const { type, dueAt } = parseRest(rest);

    if (!title) continue;
    items.push({
      examId: cur.id || null,
      title,
      type,
      tag,
      dueAt,
      status: classifyItestStatus(rest),
    });
  }

  return { pendingCount, items };
}

// 把“未提交”考试映射为 Assignment（纯函数，便于单测）。
export function mapItestAssignments(
  items: ParsedItestItem[],
  ctx: { courseId: string; courseName: string; url: string; syncedAt: string },
): Assignment[] {
  return items
    .filter((it) => it.status === 'pending' || it.status === 'absent')
    .map((it) => ({
      id: `itest:${it.examId ?? slugifyCourse(it.title)}`,
      platformId: 'itest',
      courseId: ctx.courseId,
      courseName: ctx.courseName,
      title: it.title,
      dueAt: it.dueAt,
      // “进入考试”为 JS 按钮而非 <a href>，无逐项深链证据，回退到考试列表页 URL。
      url: ctx.url,
      status: 'unsubmitted',
      syncedAt: ctx.syncedAt,
      // 考试列表为聚合视图（类比东软首页“我的学习任务”），source=home 使后台按课程合并、
      // 并在确实无待办时清空该课程旧条目。
      source: 'home',
    }));
}

// ============ DOM 胶水层 ============

function waitFor(predicate: () => boolean, timeoutMs: number, intervalMs: number): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      let ok = false;
      try {
        ok = predicate();
      } catch {
        ok = false;
      }
      if (ok || Date.now() - start >= timeoutMs) {
        resolve();
        return;
      }
      window.setTimeout(tick, intervalMs);
    };
    tick();
  });
}

// 从“我的班级”区块提取班级名（best-effort，作为看板分组维度；缺失则回退 'iTEST'）。
function extractClassName(doc: Document): string | null {
  const el = doc.querySelector('[class*="stuClsInfo"]');
  const t = (el?.textContent || '').replace(/\s+/g, ' ').trim();
  if (t && t.length <= 60) return t;
  return null;
}

function isExamListText(text: string): boolean {
  return /（ID：\d+）/.test(text);
}

export async function extractItestAssignments(
  doc: Document,
  url: string,
  options: ItestExtractOptions,
): Promise<PlatformExtractionResult | null> {
  let hostname = '';
  try {
    hostname = new URL(url).hostname;
  } catch {
    hostname = '';
  }

  // SSO 登录域：未登录，报 login-required，不更新缓存。
  if (hostname === 'sso.unipus.cn') {
    return {
      status: 'login-required',
      assignments: [],
      message: 'iTEST 需要登录（sso.unipus.cn），未更新数据。',
    };
  }

  // 仅处理 unipus 域；非 unipus 直接跳过（理论上 platforms.ts 已过滤，此处双保险）。
  if (hostname && !hostname.endsWith('.unipus.cn') && hostname !== 'itestcloud.unipus.cn') {
    return null;
  }

  const readText = (): string => (doc.body?.innerText || '').replace(/\s+/g, ' ').trim();

  // 等待 SPA（React + qiankun 微应用）渲染出考试列表。
  const listReady = (): boolean => {
    const t = readText();
    return /待完成/.test(t) && isExamListText(t);
  };
  if (!listReady()) {
    await waitFor(listReady, options.allowAutoOpen ? 4000 : 2500, 200);
  }

  const text = readText();

  // 非考试列表页（如训练 / 比赛 / 班级 / 个人空间）：无考试项，静默跳过。
  if (!isExamListText(text)) {
    return null;
  }

  const { pendingCount, items } = parseItestExamPageText(text);
  const nonDone = items.filter((it) => it.status === 'pending' || it.status === 'absent');

  // 完整性校验：解析出的“未提交”条数应与页面“待完成”汇总一致；
  // 不一致视为列表未完整渲染或结构已变化，先再等一轮，仍不一致则报 needs-verification。
  if (pendingCount !== null && nonDone.length !== pendingCount) {
    await waitFor(
      () => {
        const r = parseItestExamPageText(readText());
        return (
          r.pendingCount !== null &&
          r.items.filter((i) => i.status === 'pending' || i.status === 'absent').length ===
            r.pendingCount
        );
      },
      options.allowAutoOpen ? 3000 : 2000,
      200,
    );
    const re = parseItestExamPageText(readText());
    const reNonDone = re.items.filter((i) => i.status === 'pending' || i.status === 'absent');
    if (re.pendingCount !== null && reNonDone.length !== re.pendingCount) {
      return {
        status: 'needs-verification',
        assignments: [],
        message: `iTEST：解析未提交 ${reNonDone.length} 项，与“待完成”汇总 ${re.pendingCount} 不一致（列表可能未完整渲染或页面结构已变化），未更新数据。`,
      };
    }
    return buildResult(re.items, re.pendingCount, doc, url);
  }

  return buildResult(items, pendingCount, doc, url);
}

function buildResult(
  items: ParsedItestItem[],
  pendingCount: number | null,
  doc: Document,
  url: string,
): PlatformExtractionResult {
  const nonDone = items.filter((it) => it.status === 'pending' || it.status === 'absent');
  const syncedAt = new Date().toISOString();
  const courseName = extractClassName(doc) ?? 'iTEST';
  const courseId = slugifyCourse(courseName);

  // 确实没有任何待办：replaceAll 整组清空该平台缓存，
  // 避免因班级名提取波动导致 courseId 不一致而残留旧条目。
  if (nonDone.length === 0) {
    return {
      status: 'success',
      assignments: [],
      message: 'iTEST 考试页：暂无待完成考试。',
      replaceAll: true,
    };
  }

  const assignments = mapItestAssignments(nonDone, { courseId, courseName, url, syncedAt });
  const pending = nonDone.filter((i) => i.status === 'pending').length;
  const absent = nonDone.length - pending;

  let message: string;
  if (absent > 0) {
    message = `iTEST 考试页：待完成 ${nonDone.length} 项（其中 ${pending} 项仍可作答，${absent} 项已错过截止时间）。`;
  } else {
    message = `iTEST 考试页：待完成 ${nonDone.length} 项。`;
  }

  return {
    status: 'success',
    assignments,
    message,
    courseIds: [courseId],
  };
}

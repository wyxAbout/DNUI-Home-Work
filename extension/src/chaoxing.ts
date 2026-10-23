// 学习通邮箱（i.chaoxing.com 个人空间 → notice.chaoxing.com 收件箱 iframe）作业解析器。
// 真实实现，基于 2026-10-23 两次去敏诊断证据（先取证、再落地，不猜结构/接口/状态文案）。
//
// 证据关键结论：
// 1) 入口 i.chaoxing.com 个人空间左菜单“收件箱”（id=first521830，class 含 active/cur）激活后，
//    右侧内容区 #mainright 是一个 <iframe>，src 指向 https://notice.chaoxing.com/pc/notice/myNotice，
//    真实消息列表渲染在该 iframe 内。顶层 i.chaoxing.com 文档读不到 iframe 内容（跨域），
//    故解析器在 iframe 上下文（notice.chaoxing.com）中执行；顶层 i.chaoxing.com 直接返回 null，
//    不覆盖 iframe 已写入的缓存。
// 2) 真实结构（来自 notice.chaoxing.com 诊断的 tree）：
//    每条消息 = <li class="dataBody_td dataBody_item" data-id="<GUID>">
//                <div class="dataBody_file"><span class="redDot"></span></div>   // redDot = 未读
//                <div class="openNotice" data-url="/pc/notice/$CACG$<uuid>/detail?sendTag=0">
//                  <div class="dataBody_text clearfix">
//                    <span class="notice_unread"><a class="notice_title">标题</a></span>
//                    <span class="notice_time fr">MM-DD(星期X) HH:MM</span>
//                  </div>
//                  <div class="dataBody_receiver">
//                    <span class="receiver">发件人：</span><span class="receiverName">学习通知</span>
//                  </div>
//                </div>
//              </li>
// 3) 标题规律（来自真实 mainText + 2026-10-23 用户截图证据）：
//    - “作业：《课程》描述” —— 作业下发通知，视为“还需要做的任务”；
//    - “作业结束提醒”      —— 作业已结束的提示，非待办，排除；
//    - “考试通知”          —— 考试下发通知，计入待办（见下方考试判定规则）。
//    规则：标题以“作业”开头且不含“结束提醒” → homework；
//          标题以“考试”开头 → exam；其余排除。
// 4) 作业下发通知：收件箱不提供“是否已提交”状态，统一 status='unsubmitted'（不臆测）、dueAt=null。
//
// 考试通知判定规则（用户 2026-10-23 口述 + 两张截图证据）：
//   1. 注意时间：考试通知详情页（列表项 openNotice[data-url]，同域 notice.chaoxing.com，
//      fetch 带 cookie 等价于手动点开，不触发页面跳转/不会误入答题）含结构化文本：
//      “课程名称：… 考试名称：… 开始时间：YYYY-MM-DD HH:MM 结束时间：YYYY-MM-DD HH:MM …”。
//      解析出 结束时间 → dueAt；当前时间已过结束时间 → 考试已结束（status='expired'，
//      看板显示“已过期”，配合“自动隐藏已过期项”即不再占位）。
//   2. 交卷成功：点击详情页“考试”卡片后若显示“交卷成功（提交方式：学生交卷）”则判定作业结束。
//      该卡片真实链接/DOM 尚无证据（铁律不猜），待用户对详情页与交卷成功页各做一轮诊断后，
//      再以 fetch 方式静默核验“交卷成功”文案（fetch 不导航，不会误启动考试）。

import type { Assignment, PlatformExtractionResult } from './models';
import { slugifyCourse } from './neusoft.ts';

interface ChaoxingExtractOptions {
  // 语义同 neusoft.ts / itest.ts / pigai.ts：
  // - 页面自动上报（document_idle）：false；
  // - 用户在看板点“刷新当前平台”（SYNC_ACTIVE_PAGE）：true（放宽渲染等待时长）。
  allowAutoOpen: boolean;
}

// 消息类别：homework=作业下发（计入待办）/ homework_closed=作业结束提醒（排除）/
// exam=考试下发通知（计入待办，按时间判定）/ other=其它（排除）。
export type ChaoxingTitleKind = 'homework' | 'homework_closed' | 'exam' | 'other';

// 纯函数：根据标题判定类别（不依赖 DOM，便于单测，使用真实样本）。
export function classifyChaoxingTitle(title: string): ChaoxingTitleKind {
  const t = (title ?? '').trim();
  if (!t) return 'other';
  if (/^作业/.test(t)) {
    return /结束提醒/.test(t) ? 'homework_closed' : 'homework';
  }
  if (/^考试/.test(t)) {
    return 'exam';
  }
  return 'other';
}

// 纯函数：从标题抽取《课程名》（无则空，由调用方回退到默认课程）。
export function extractChaoxingCourse(title: string): string {
  const m = (title ?? '').match(/《([^》]+)》/);
  return m ? (m[1] ?? '').trim() : '';
}

export interface RawChaoxingItem {
  id: string; // 消息 GUID（li[data-id]）
  title: string;
  sender: string;
  detailUrl: string; // 已拼接为绝对地址
}

// 考试通知详情页解析结果（字段名与截图中的结构化文本一一对应）。
export interface ChaoxingExamDetail {
  courseName: string;
  examTitle: string;
  // 本地时间 ISO（YYYY-MM-DDTHH:MM[:SS]，无时区后缀，与其它平台 dueAt 同构）。
  startAt: string | null;
  endAt: string | null;
}

// 把 “YYYY-MM-DD HH:MM(:SS)?” 归一为本地 ISO（YYYY-MM-DDTHH:MM(:SS)?）。
// 日期与时刻之间的空白可选：textContent 会把相邻元素无空格拼接（“2026-10-2111:18”）。
export function normalizeChaoxingExamTime(raw: string): string | null {
  const m = (raw ?? '').match(/(\d{4}-\d{2}-\d{2})\s*(\d{2}:\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const date = m[1] ?? '';
  const hm = m[2] ?? '';
  const ss = m[3] ? `:${m[3]}` : '';
  return `${date}T${hm}${ss}`;
}

// 纯函数：从考试通知详情页正文中解析结构化字段。
// 证据 = 用户截图（详情页按行渲染“课程名称：/考试名称：/开始时间：/结束时间：/考试形式：”）。
// 关键：DOMParser 的 textContent 会把相邻块级元素无空格拼接（“大学物理考试名称：…”，
// 2026-10-23 首次抓取失败即此因），故字段停止点用零宽前瞻（不要求空白）、日期与时刻间空白可选。
// 既无“考试名称”也无“结束时间”→ 视为不是考试详情页，返回 null。
export function parseChaoxingExamDetailText(text: string): ChaoxingExamDetail | null {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  const grab = (label: string, stopLabels: string[]): string => {
    const stops = stopLabels.map((s) => `(?=${s})`).join('|');
    const re = new RegExp(`${label}\\s*[：:]\\s*(.*?)\\s*(?:${stops}|$)`);
    const m = flat.match(re);
    return (m?.[1] ?? '').trim();
  };
  const courseName = grab('课程名称', ['考试名称', '开始时间', '结束时间', '考试形式']);
  const examTitle = grab('考试名称', ['开始时间', '结束时间', '考试形式']);
  const startRaw = flat.match(/开始时间\s*[：:]\s*(\d{4}-\d{2}-\d{2})\s*(\d{2}:\d{2}(?::\d{2})?)/);
  const endRaw = flat.match(/结束时间\s*[：:]\s*(\d{4}-\d{2}-\d{2})\s*(\d{2}:\d{2}(?::\d{2})?)/);
  if (!examTitle && !endRaw) {
    return null;
  }
  return {
    courseName,
    examTitle,
    startAt: startRaw ? normalizeChaoxingExamTime(`${startRaw[1] ?? ''} ${startRaw[2] ?? ''}`) : null,
    endAt: endRaw ? normalizeChaoxingExamTime(`${endRaw[1] ?? ''} ${endRaw[2] ?? ''}`) : null,
  };
}

// 纯函数：考试状态判定（“注意时间”）。
// 有结束时间且已过 → 'expired'（考试已结束，无论是否交卷都不再是待办）；
// 无结束时间/解析失败/未到结束时间 → 'unsubmitted'（仍可作答）。
export function decideChaoxingExamStatus(endAt: string | null, nowMs: number): 'unsubmitted' | 'expired' {
  if (!endAt) return 'unsubmitted';
  const t = new Date(endAt).getTime();
  if (Number.isNaN(t)) return 'unsubmitted';
  return t < nowMs ? 'expired' : 'unsubmitted';
}

// 纯函数：把一条考试通知（+ 可选的详情页解析结果）映射为 Assignment。
// 详情解析失败时诚实降级：沿用列表标题、课程回退、dueAt=null、unsubmitted（不臆测）。
export function mapChaoxingExamAssignment(
  item: RawChaoxingItem,
  detail: ChaoxingExamDetail | null,
  ctx: { syncedAt: string; nowMs: number; fallbackCourse?: string },
): Assignment {
  const course = detail?.courseName || ctx.fallbackCourse || '学习通考试通知';
  const endAt = detail?.endAt ?? null;
  return {
    id: `chaoxing:${item.id}`,
    platformId: 'chaoxing',
    courseId: slugifyCourse(course),
    courseName: course,
    title: detail?.examTitle || item.title,
    dueAt: endAt,
    url: item.detailUrl,
    status: decideChaoxingExamStatus(endAt, ctx.nowMs),
    syncedAt: ctx.syncedAt,
    source: 'home',
  };
}

// 纯函数：把原始消息映射为 Assignment（source='home'，与批改网“未完成”聚合视图同构）。
export function mapChaoxingAssignments(
  items: RawChaoxingItem[],
  ctx: { syncedAt: string; fallbackCourse?: string },
): Assignment[] {
  return items.map((it) => {
    const course = extractChaoxingCourse(it.title) || ctx.fallbackCourse || '学习通作业通知';
    return {
      id: `chaoxing:${it.id}`,
      platformId: 'chaoxing',
      courseId: slugifyCourse(course),
      courseName: course,
      title: it.title,
      dueAt: null,
      url: it.detailUrl,
      status: 'unsubmitted',
      syncedAt: ctx.syncedAt,
      source: 'home',
    };
  });
}

function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  intervalMs: number,
): Promise<void> {
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

// 仅依赖诊断证据中的稳定 class（dataBody_item / notice_title / notice_time / receiverName /
// openNotice[data-url] / li[data-id]），不猜任何未出现在证据里的字段。
function readRawItems(doc: Document): RawChaoxingItem[] {
  const out: RawChaoxingItem[] = [];
  for (const li of Array.from(doc.querySelectorAll('li.dataBody_item'))) {
    const id = li.getAttribute('data-id')?.trim() ?? '';
    const title = (li.querySelector('.notice_title')?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const sender = (li.querySelector('.receiverName')?.textContent ?? '').trim();
    const openEl = li.querySelector('.openNotice');
    const rel = openEl?.getAttribute('data-url')?.trim() ?? '';
    if (!id || !title || !rel) {
      continue;
    }
    const detailUrl = /^https?:\/\//i.test(rel)
      ? rel
      : `https://notice.chaoxing.com${rel}`;
    out.push({ id, title, sender, detailUrl });
  }
  return out;
}

// fetch 考试通知详情页正文（同域 notice.chaoxing.com，带 cookie 等价于手动点开通知，
// 不触发导航、不会进入答题页）。失败返回 null，由调用方诚实降级。
async function fetchNoticeDetailText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return null;
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.body?.textContent ?? '';
  } catch {
    return null;
  }
}

export async function extractChaoxingAssignments(
  doc: Document,
  url: string,
  options: ChaoxingExtractOptions,
): Promise<PlatformExtractionResult | null> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }
  const hostname = parsedUrl.hostname;

  // 仅处理学习通域；非学习通直接跳过（platforms.ts 已按 host 过滤，此处双保险）。
  if (hostname && !/(^|\.)chaoxing\.com$/.test(hostname)) {
    return null;
  }

  // 顶层 i.chaoxing.com 读不到跨域 iframe 内容，交给 iframe（notice.chaoxing.com）解析；
  // 顶层返回 null，避免用空结果覆盖 iframe 已写入的缓存。
  if (hostname === 'i.chaoxing.com') {
    return null;
  }

  // notice.chaoxing.com 下仅收件箱列表页（/pc/notice/myNotice）具备解析权；
  // 其它页面（如单条通知详情）没有列表 DOM，若按“0 条”处理会整组清空缓存，必须返回 null。
  if (!parsedUrl.pathname.includes('myNotice')) {
    return null;
  }

  // 以下在 notice.chaoxing.com 收件箱 iframe 上下文执行。
  // 等列表渲染（document_idle 通常已就绪，仍做有界等待以防偏早）。
  const ready = (): boolean => doc.querySelectorAll('li.dataBody_item').length > 0;
  if (!ready()) {
    await waitFor(ready, options.allowAutoOpen ? 4000 : 2500, 200);
  }

  const raw = readRawItems(doc);
  const homeworkItems = raw.filter((it) => classifyChaoxingTitle(it.title) === 'homework');
  const examItems = raw.filter((it) => classifyChaoxingTitle(it.title) === 'exam');

  const syncedAt = new Date().toISOString();
  const nowMs = Date.now();

  // 考试通知：逐条 fetch 详情页解析“课程/考试名/开始/结束时间”（“注意时间”判定）。
  // 顺序请求，条数通常为个位数；失败降级为列表信息（不臆测）。
  const examAssignments: Assignment[] = [];
  for (const item of examItems) {
    const text = await fetchNoticeDetailText(item.detailUrl);
    const detail = text ? parseChaoxingExamDetailText(text) : null;
    examAssignments.push(mapChaoxingExamAssignment(item, detail, { syncedAt, nowMs }));
  }

  const assignments = [
    ...mapChaoxingAssignments(homeworkItems, { syncedAt }),
    ...examAssignments,
  ];

  // 收件箱为空或无可计入的任务：replaceAll 整组清空该平台旧条目，避免残留。
  if (assignments.length === 0) {
    return {
      status: 'success',
      assignments: [],
      message: '学习通邮箱：收件箱暂无未处理任务通知。',
      replaceAll: true,
    };
  }

  const pendingCount = assignments.filter((a) => a.status === 'unsubmitted').length;
  return {
    status: 'success',
    assignments,
    message: `学习通邮箱：作业 ${homeworkItems.length} 项、考试 ${examItems.length} 项（其中 ${pendingCount} 项待处理）。`,
    replaceAll: true,
  };
}

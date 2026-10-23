// 学习通邮箱（i.chaoxing.com 个人空间 → notice.chaoxing.com 收件箱 iframe）作业解析器。
// 真实实现，基于 2026-10-23 两次去敏诊断证据（先取证、再落地，不猜结构/接口/状态文案）。
//
// 证据关键结论：
// 1) 用户真实入口为 https://i.chaoxing.com/base?t=... （“收件箱”），该页内嵌一个 <iframe>，
//    src 指向 https://notice.chaoxing.com/pc/notice/myNotice，真实消息列表渲染在该 iframe 内。
//    顶层 i.chaoxing.com 文档读不到 iframe 内容（跨域），故解析器在 iframe 上下文
//    （notice.chaoxing.com）中执行；顶层 i.chaoxing.com 直接返回 null，不覆盖 iframe 已写入的缓存。
//    2026-10-23 诊断证实：content.ts 必须开启 allFrames:true，否则自动 content script 不会注入
//    该 iframe，导致看板长期显示“未访问”（诊断工具因显式 allFrames 才成功取证）。
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
// 考试通知判定规则（用户 2026-10-23 口述 + 两张截图证据 + 收件箱诊断 JSON 验证）：
//   1. 注意时间（已落地，自动化可行）：
//      考试通知详情页（列表项 openNotice[data-url]，同域 notice.chaoxing.com）含结构化文本：
//      “课程名称：… 考试名称：… 开始时间：YYYY-MM-DD HH:MM 结束时间：YYYY-MM-DD HH:MM …”。
//      解析出 结束时间 → dueAt；当前时间已过结束时间 → 考试已结束（status='expired'，
//      看板显示“已过期”，配合“自动隐藏已过期项”即不再占位）。
//      取证手段（关键修复）：此前 fetch 详情页只拿到 SPA 静态外壳（无考试字段，parsed 恒 null），
//      故改用隐藏同源 iframe 加载详情、读取“已渲染的实时 DOM”再解析 —— 已用诊断验证
//      method=injected-iframe 且 parsed 真实有效（课程名/考试名/起止时间齐全）。
//   1b. 第二种详情格式（2026-10-23 看板截图证据，如“【64】概率论第1章单元测试”）：
//       部分考试通知详情不含“开始时间/结束时间”标签，而是
//       “考试时间： MM-DD HH:MM 至 MM-DD HH:MM”（无年份，其后可能附“考试时长： N分钟”）。
//       解析规则：考试名称在“考试时间/考试时长”标签前截断（否则会吞掉整段时间文本）；
//       “考试时间”区间两端归一为 startAt/endAt。缺省年份“就近补齐 + 跨年前翻”：
//       先按调用方年份补齐；若补齐后的结束时间早于 now-180 天（典型：12 月发 1 月考，
//       按当前年补会落进遥远的过去），判为跨年通知、起止时间整体 +1 年。
//       残余局限（如实记录）：补齐后已落后超过 180 天的陈旧过期通知会被翻到下一年——
//       但收件箱按时间倒序、首屏几乎不含如此陈旧的通知，且平台侧详情不带年份、
//       单条数据本身无法彻底消除歧义，只能用“通知面向近期考试”这一事实做启发式。
//   2. 交卷成功（自动化不可行，已用证据坐实，须如实记录）：
//      用户规则“点击‘考试’后若显示‘交卷成功（提交方式：学生交卷）’则判定作业结束”。
//      但 2026-10-23 的诊断证实：收件箱“通知详情”页只渲染“课程名称/考试名称/起止时间/考试形式”
//      + 评论区，根本不含“交卷成功”提交状态；“交卷成功”位于真正的“考试”答题页，
//      进入该页有触发答题/交卷风险，违反铁律“绝不误点‘考试’按钮启动答题”，故不能自动核验。
//      结论：本模块以“注意时间”作为自动化信号（窗口内=待做，窗口外=已过期并隐藏）；
//      “交卷成功”需用户手动在平台确认，无法由扩展静默判定。

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
// 证据一（2026-10-23 截图）：详情页按行渲染“课程名称：/考试名称：/开始时间：/结束时间：/考试形式：”。
// 证据二（2026-10-23 看板截图）：另一批通知用“考试时间： MM-DD HH:MM 至 MM-DD HH:MM
// （考试时长： N分钟）”，无“开始/结束时间”标签、无年份 —— 见头部规则 1b。
// 关键：DOMParser 的 textContent 会把相邻块级元素无空格拼接（“大学物理考试名称：…”，
// 2026-10-23 首次抓取失败即此因），故字段停止点用零宽前瞻（不要求空白）、日期与时刻间空白可选。
// 既无“考试名称”也无任何可解析的时间 → 视为不是考试详情页，返回 null。
export interface ParseChaoxingExamDetailOptions {
  // 格式 2（“考试时间：MM-DD HH:MM 至 MM-DD HH:MM”）不带年份，用该年份补齐；
  // 缺省取“当前年份”（调用方传同步时刻对应的年份）。
  year?: number;
  // “就近补年”的基准时刻（缺省取当前时刻）；单测传入固定值以消除对真实时钟的依赖。
  nowMs?: number;
}

export function parseChaoxingExamDetailText(
  text: string,
  options?: ParseChaoxingExamDetailOptions,
): ChaoxingExamDetail | null {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  const grab = (label: string, stopLabels: string[]): string => {
    const stops = stopLabels.map((s) => `(?=${s})`).join('|');
    const re = new RegExp(`${label}\\s*[：:]\\s*(.*?)\\s*(?:${stops}|$)`);
    const m = flat.match(re);
    return (m?.[1] ?? '').trim();
  };
  // “考试时间/考试时长”同样是字段标签：格式 2 里它们紧跟考试名称，不截断会把
  // 整段时间文本吞进考试名称（2026-10-23 看板截图证据）。
  const courseName = grab('课程名称', [
    '考试名称',
    '考试时间',
    '考试时长',
    '开始时间',
    '结束时间',
    '考试形式',
  ]);
  const examTitle = grab('考试名称', [
    '考试时间',
    '考试时长',
    '开始时间',
    '结束时间',
    '考试形式',
  ]);
  const startRaw = flat.match(/开始时间\s*[：:]\s*(\d{4}-\d{2}-\d{2})\s*(\d{2}:\d{2}(?::\d{2})?)/);
  const endRaw = flat.match(/结束时间\s*[：:]\s*(\d{4}-\d{2}-\d{2})\s*(\d{2}:\d{2}(?::\d{2})?)/);
  // 格式 2：考试时间： MM-DD HH:MM 至 MM-DD HH:MM（年份可有可无，空白可有可无）。
  const rangeRaw = flat.match(
    /考试时间\s*[：:]\s*((?:\d{4}-)?\d{2}-\d{2})\s*(\d{2}:\d{2}(?::\d{2})?)\s*至\s*((?:\d{4}-)?\d{2}-\d{2})\s*(\d{2}:\d{2}(?::\d{2})?)/,
  );
  if (!examTitle && !endRaw && !rangeRaw) {
    return null;
  }
  // 格式 2 的时间归一：无年份的 MM-DD 按调用方年份（缺省当前年）补齐；
  // 若补齐后的结束时间早于 now-180 天，判为跨年通知、起止时间整体 +1 年（“就近补年”启发式，见头部 1b）。
  const baseYear = options?.year ?? new Date().getFullYear();
  const nowMs = options?.nowMs ?? Date.now();
  const YEARLESS_ROLL_THRESHOLD_MS = 180 * 24 * 60 * 60 * 1000;
  const yearless = (date: string | undefined): boolean => !!date && /^\d{2}-\d{2}$/.test(date);
  const withYear = (date: string, hm: string, yearOffset = 0): string | null => {
    if (!/^\d{2}-\d{2}$/.test(date) && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const full = /^\d{4}-/.test(date) ? date : `${baseYear + yearOffset}-${date}`;
    return normalizeChaoxingExamTime(`${full} ${hm}`);
  };
  // 把本地 ISO 的年份 +n（月日时刻不变），用于跨年整体翻年。
  const shiftYear = (iso: string, n: number): string | null => {
    const m = iso.match(/^(\d{4})-(\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)$/);
    return m ? `${Number(m[1]) + n}-${m[2] ?? ''}` : null;
  };
  const resolveRange = (): { startAt: string | null; endAt: string | null } => {
    const startAt = withYear(rangeRaw?.[1] ?? '', rangeRaw?.[2] ?? '');
    const endAt = withYear(rangeRaw?.[3] ?? '', rangeRaw?.[4] ?? '');
    // 仅对“无年份”的结束时间做跨年前翻；带年份的日期本身无歧义。
    if (endAt && yearless(rangeRaw?.[3])) {
      const endT = new Date(endAt).getTime();
      if (!Number.isNaN(endT) && nowMs - endT > YEARLESS_ROLL_THRESHOLD_MS) {
        const startAt2 = startAt ? shiftYear(startAt, 1) : null;
        const endAt2 = shiftYear(endAt, 1);
        if (endAt2) return { startAt: startAt2, endAt: endAt2 };
      }
    }
    return { startAt, endAt };
  };
  const range = rangeRaw ? resolveRange() : null;
  return {
    courseName,
    examTitle,
    startAt: startRaw
      ? normalizeChaoxingExamTime(`${startRaw[1] ?? ''} ${startRaw[2] ?? ''}`)
      : (range?.startAt ?? null),
    endAt: endRaw
      ? normalizeChaoxingExamTime(`${endRaw[1] ?? ''} ${endRaw[2] ?? ''}`)
      : (range?.endAt ?? null),
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

// 读取考试通知详情页“已渲染的实时 DOM”正文（关键修复，2026-10-23 确诊并落地）。
//
// 根因（用户同日前述诊断证实）：直接 fetch 详情页只返回 SPA 静态外壳
// （仅工具栏 + 内联脚本，不含“课程名称/考试名称/开始/结束时间”等字段），
// 故此前 parseChaoxingExamDetailText 永远拿不到 endAt，“注意时间”判定彻底失效。
// 考试字段由前端 JS 异步渲染进 DOM，必须读取“已渲染的实时 DOM”才能拿到。
//
// 取证手段（与诊断工具 probeExamDetail 情形 B 完全一致，已验证 method=injected-iframe
// 且 parsed 真实有效）：列表页与详情页同域 notice.chaoxing.com，自建一个隐藏的同源
// iframe 加载该详情（等价手动点开“通知”——主页面不跳转、也绝不误点“考试”按钮启动答题），
// 待其 JS 渲染出考试字段后，读取 contentDocument.body.innerText（已渲染文本），
// 再交给 parseChaoxingExamDetailText。失败（跨域/CSP/超时）返回 null，由调用方诚实降级。
//
// 安全边界：此 iframe 只读“通知详情”页，绝不加载“考试”答题页；后者含“交卷成功”的提交状态，
// 但进入该页有触发答题/交卷风险，违反铁律，故“交卷成功”自动核验不在本函数范围内（见头部规则 2）。
async function readNoticeDetailText(doc: Document, url: string): Promise<string | null> {
  const body = doc.body;
  if (!body) return null;
  const frame = doc.createElement('iframe');
  frame.setAttribute(
    'style',
    'position:absolute;left:-9999px;top:-9999px;width:0;height:0;border:0;display:none;',
  );
  frame.src = url;
  body.appendChild(frame);
  try {
    const readRendered = (): string => {
      const d = (frame as HTMLIFrameElement).contentDocument;
      if (!d || !d.body) return '';
      return (d.body.innerText || '').replace(/\s+/g, ' ').trim();
    };
    // 有界等待渲染：最多 6s、200ms 轮询，直到正文出现考试字段（含格式 2 的“考试时间”）。
    await waitFor(() => /考试名称|考试时间|开始时间|结束时间/.test(readRendered()), 6000, 200);
    const text = readRendered();
    return text || null;
  } catch {
    return null;
  } finally {
    frame.remove();
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
  // 格式 2 详情（“考试时间：MM-DD HH:MM 至 …”）无年份，按同步时刻所在年份补齐（见头部规则 1b）。
  const detailYear = new Date(nowMs).getFullYear();

  // 考试通知：逐条读取详情页“已渲染 DOM”解析“课程/考试名/开始/结束时间”（“注意时间”判定）。
  // 列表页与详情页同域 notice.chaoxing.com，自建隐藏 iframe 等价于手动点开“通知”
  // （主页面不跳转、绝不误点“考试”按钮），并行取数以缩短等待；单条失败降级为列表信息（不臆测）。
  const examDetails: (ChaoxingExamDetail | null)[] = await Promise.all(
    examItems.map((item) =>
      readNoticeDetailText(doc, item.detailUrl).then((text) =>
        text ? parseChaoxingExamDetailText(text, { year: detailYear, nowMs }) : null,
      ),
    ),
  );
  const examAssignments: Assignment[] = examItems.map((item, i) =>
    mapChaoxingExamAssignment(item, examDetails[i] ?? null, { syncedAt, nowMs }),
  );

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

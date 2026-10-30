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
//       “考试时间”区间两端归一为 startAt/endAt。
//       **年份消歧（彻底解决跨年，2026-10-23 收件箱诊断证据）**：详情页自带时间无年份，
//       故用“列表发送时间”锚定真实年份——收件箱按时间倒序、每行 span.notice_time 含
//       “MM-DD(星期X) HH:MM”，由 resolveChaoxingNoticeYears 以顶部项为锚向下推断每项年份
//       （MM-DD 反向跳变即跨年 -1）。再以该年份补齐“考试时间”的 MM-DD；若考试 MM-DD 小于通知
//       MM-DD（如 12 月通知 1 月考）再加 1 年。此路径无需任何“当前年”猜算，跨年不再误判。
//       回退：若列表时间缺失（置顶/异常行），沿用当前年 + “早于 now-180 天则 +1 年”的启发式兜底。
//   2. 交卷成功（自动化不可行，已用证据坐实，须如实记录）：
//      用户规则“点击‘考试’后若显示‘交卷成功（提交方式：学生交卷）’则判定作业结束”。
//      但 2026-10-23 的诊断证实：收件箱“通知详情”页只渲染“课程名称/考试名称/起止时间/考试形式”
//      + 评论区，根本不含“交卷成功”提交状态；“交卷成功”位于真正的“考试”答题页，
//      进入该页有触发答题/交卷风险，违反铁律“绝不误点‘考试’按钮启动答题”，故不能自动核验。
//      结论：本模块以“注意时间”作为自动化信号（窗口内=待做，窗口外=已过期并隐藏）；
//      “交卷成功”需用户手动在平台确认，无法由扩展静默判定。

import { assignmentStatusLabel } from './models.ts';
import type { Assignment, ChaoxingCourse, PlatformExtractionResult } from './models';
import { slugifyCourse } from './neusoft.ts';
import { PLATFORM_SELECTOR_CONFIG, SelectorError } from './selectors.ts';

// 选择器集中配置（反馈 2.3：抽成配置，避免学校改版时逐个翻解析器）。
const chaoxingCfg = PLATFORM_SELECTOR_CONFIG.chaoxing;

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
  // 列表行的发送时间文本（span.notice_time.fr，如 "10-21(星期三) 11:19"），用于跨年消歧。
  // 置顶/异常行可能无时间，故可缺省。
  noticeTime?: string;
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
  // 为“列表发送时间锚定的真实年份”（见 resolveChaoxingNoticeYears），缺省取当前年份。
  year?: number;
  // “就近补年”的基准时刻（缺省取当前时刻）；单测传入固定值以消除对真实时钟的依赖。
  nowMs?: number;
  // 通知本身的“月-日”数值（如 12-25 → 1225）。考试 MM-DD 小于通知 MM-DD（如 12 月通知 1 月考）
  // 即跨年，整体 +1 年。该规则精确无歧义，取代旧的“落后 180 天即翻年”启发式；
  // 缺省（无通知时间）时回退到 180 天阈值启发式。
  noticeMonthDay?: number;
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
  const mdOf = (date: string | undefined): number | null => {
    const m = (date ?? '').match(/(\d{1,2})-(\d{1,2})/);
    return m ? Number(m[1]) * 100 + Number(m[2]) : null;
  };
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
  // 跨年判定（精确）：同域无年份“考试时间”的补齐基准是“通知所在年份”；
  // 若考试 MM-DD 小于通知 MM-DD（如 12 月通知 1 月考），考试实际落在次年 → +1 年。
  // 逐端独立比较，可正确处理“12-25 至 01-10”（开始当年、结束次年）。
  const maybeBump = (iso: string | null, dateStr: string | undefined): string | null => {
    if (!iso) return null;
    const nmd = options?.noticeMonthDay;
    const emd = mdOf(dateStr);
    if (nmd != null && emd != null && emd < nmd) return shiftYear(iso, 1);
    return iso;
  };
  const resolveRange = (): { startAt: string | null; endAt: string | null } => {
    const startAt = maybeBump(withYear(rangeRaw?.[1] ?? '', rangeRaw?.[2] ?? ''), rangeRaw?.[1]);
    const endAt = maybeBump(withYear(rangeRaw?.[3] ?? '', rangeRaw?.[4] ?? ''), rangeRaw?.[3]);
    // 回退：无通知时间可供精确判定时，才用“落后 180 天即翻年”的粗略启发式。
    if (options?.noticeMonthDay == null && endAt && yearless(rangeRaw?.[3])) {
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

// 有界并发：收件箱可能有 50+ 条考试通知，若用 Promise.all 一次性开 50 个隐藏 iframe，
// 浏览器渲染/网络排队极易导致部分 iframe 超时、详情读不到而退化为“未提供截止时间”。
// 限制同时进行的详情抓取数（默认 5），既保住速度又避免把正常项误判成无截止。
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const idx = cursor;
      cursor += 1;
      results[idx] = await fn(items[idx]!);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

// 仅依赖诊断证据中的稳定 class（dataBody_item / notice_title / notice_time / receiverName /
// openNotice[data-url] / li[data-id]），不猜任何未出现在证据里的字段。
function readRawItems(doc: Document): RawChaoxingItem[] {
  const out: RawChaoxingItem[] = [];
  const itemSel = chaoxingCfg.item ?? 'li.dataBody_item';
  const titleSel = chaoxingCfg.fields.title!;
  const senderSel = chaoxingCfg.fields.sender!;
  const detailSel = chaoxingCfg.fields.detailUrl!;
  const detailAttr = chaoxingCfg.fields.detailUrlAttr!;
  const timeSel = chaoxingCfg.fields.time!;
  const idAttr = chaoxingCfg.fields.itemIdAttr!;
  for (const li of Array.from(doc.querySelectorAll(itemSel))) {
    const id = li.getAttribute(idAttr)?.trim() ?? '';
    const title = (li.querySelector(titleSel)?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const sender = (li.querySelector(senderSel)?.textContent ?? '').trim();
    const openEl = li.querySelector(detailSel);
    const rel = openEl?.getAttribute(detailAttr)?.trim() ?? '';
    if (!id || !title || !rel) {
      continue;
    }
    const detailUrl = /^https?:\/\//i.test(rel)
      ? rel
      : `https://notice.chaoxing.com${rel}`;
    const noticeTime = (li.querySelector(timeSel)?.textContent ?? '').replace(/\s+/g, ' ').trim() || undefined;
    out.push({ id, title, sender, detailUrl, noticeTime });
  }
  return out;
}

// ============ 收件箱翻页（反馈：学习通此前只读第一页） ============
// 在收件箱 iframe 内点击“下一页”并累加各页消息；以 data-id 去重防止重复计数。
// 只点击列表分页的“下一页”（绝不点“考试/交卷”按钮，符合既有铁律），并受 MAX_CHAOXING_PAGES
// 上限与“翻页无新增即停止”双重保护，避免死循环；分页控件缺失时只处理当前页。

const MAX_CHAOXING_PAGES = 20;

// 在分页条内定位“下一页”按钮：文本命中配置 nextTexts 且未被禁用（末页）。
// 仅在本模块内用于翻页；导出便于单测覆盖“末页/禁用/无匹配”等判定。
export function findNextPageButton(doc: Document): HTMLElement | null {
  const containerSel = chaoxingCfg.pagination?.container;
  const nextTexts = chaoxingCfg.pagination?.nextTexts ?? [];
  if (!containerSel || nextTexts.length === 0) return null;
  for (const root of Array.from(doc.querySelectorAll(containerSel))) {
    for (const el of Array.from(root.querySelectorAll('button, a, li, span'))) {
      const text = (el.textContent || '').replace(/\s+/g, '').trim();
      if (!nextTexts.includes(text)) continue;
      const cls = typeof el.className === 'string' ? el.className : '';
      if (/disabled|is-disabled|btn-disabled/.test(cls)) continue;
      if ((el as HTMLButtonElement).disabled === true) continue;
      return el as HTMLElement;
    }
  }
  return null;
}

// 逐页累加收件箱消息；返回按 data-id 去重后的全部条目（跨页不重复计数）。
async function collectAllPages(
  doc: Document,
  firstPage: RawChaoxingItem[],
): Promise<RawChaoxingItem[]> {
  const seen = new Map<string, RawChaoxingItem>();
  for (const it of firstPage) seen.set(it.id, it);
  const itemSel = chaoxingCfg.item ?? 'li.dataBody_item';
  const idAttr = chaoxingCfg.fields.itemIdAttr!;

  for (let page = 1; page < MAX_CHAOXING_PAGES; page += 1) {
    const nextBtn = findNextPageButton(doc);
    if (!nextBtn) break; // 无“下一页”= 末页
    const prevIds = new Set(seen.keys());
    try {
      nextBtn.click();
    } catch {
      break; // 点击失败则停止，不强行翻页
    }
    // 等列表刷新：要求出现“新的非空 data-id 集合”，避免把加载中（空列表）误判为已刷新。
    const rerendered = (): boolean => {
      const ids = Array.from(doc.querySelectorAll(itemSel))
        .map((li) => li.getAttribute(idAttr)?.trim() ?? '')
        .filter(Boolean);
      return ids.length > 0 && ids.some((id) => !prevIds.has(id));
    };
    await waitFor(rerendered, 6000, 200);
    if (!rerendered()) break; // 翻页无响应，停止
    const pageItems = readRawItems(doc);
    let added = 0;
    for (const it of pageItems) {
      if (!seen.has(it.id)) {
        seen.set(it.id, it);
        added += 1;
      }
    }
    if (added === 0) break; // 无新增 = 已到末页或内容重复，停止
  }
  return [...seen.values()];
}

// 从收件箱列表的“发送时间”为每条通知锚定真实年份（彻底解决跨年无年份歧义）。
// 证据：诊断 DOM 中每条 li 含 span.notice_time（如 "10-21(星期三) 11:19"），且列表按时间倒序
// （thead 的 "按时间排序" 升/降箭头）。同域详情页的“考试时间：MM-DD”无年份，默认按通知所在年份补齐；
// 若考试 MM-DD 小于通知 MM-DD（如 12 月通知 1 月考），再加 1 年（见 parseChaoxingExamDetailText 的回退）。
// 算法：以“最顶部项”为锚（与 now 差距 < 300 天判今年，否则去年），向下遍历；因列表倒序，
// 当某项的 MM-DD “大于”上一项（时间向前跳）即跨年，年份 -1。
export function resolveChaoxingNoticeYears(
  items: RawChaoxingItem[],
  nowMs: number,
): Map<string, number> {
  const result = new Map<string, number>();
  const thisYear = new Date(nowMs).getFullYear();
  const mdOf = (s: string | undefined): number | null => {
    const m = (s ?? '').match(/(\d{1,2})-(\d{1,2})/);
    if (!m) return null;
    const mo = Number(m[1]);
    const da = Number(m[2]);
    if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
    return mo * 100 + da;
  };
  let prevYear: number | null = null;
  let prevMd: number | null = null;
  for (const it of items) {
    const md = mdOf(it.noticeTime);
    if (md === null) {
      // 置顶/异常行无时间文本：沿用上一项年份（不更新 prevMd，避免误判跨年）。
      if (prevYear !== null) result.set(it.id, prevYear);
      continue;
    }
    if (prevYear === null) {
      const d = new Date(thisYear, Math.floor(md / 100) - 1, md % 100).getTime();
      const diffDays = Math.abs(d - nowMs) / 86400000;
      prevYear = diffDays > 300 ? thisYear - 1 : thisYear;
    } else if (md > (prevMd ?? md)) {
      // 倒序列表中 MM-DD 反而更大 → 跨年。
      prevYear -= 1;
    }
    result.set(it.id, prevYear);
    prevMd = md;
  }
  return result;
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

// ============ 任务/活动列表（mobilelearn.chaoxing.com/page/active/stuActiveList） ============
// 证据（2026-10-25 用户贴回的诊断 JSON，顶层文档直接诊断）：
//   - 课程名：h2#classObjName 文本（如“25数据科学34”）。
//   - 课程标识：URL 查询参数 courseid / clazzid（稳定，用于构成稳定 ID 与课程分组）。
//   - 分组：.bottomList 内顺序出现 .status 分组标题（进行中 / 已结束），其后紧邻的 ul 为该组条目；
//     分组标题形如“进行中（0）”“已结束（15）”，括号内为计数。
//   - 单条 li：.right-content p（任务标题，如“普通签到”）/ .time（结束时间：MM-DD HH:mm）/
//     .tag[class*=icon-]（类型图标：icon-signin-g=签到、icon-xr-g=选人、icon-tp=通用）。
//   - 判定规则（用户 2026-10-25 判定表）：任务页“仅 已结束 且无提交状态” → 已完成、看板默认隐藏；
//     “进行中” → 看板显示“进行中”。

// 任务/活动类型图标 → 中文标签（仅基于已有诊断证据，不臆测未出现的图标语义）。
const CHAOXING_TASK_TYPE_ICONS: Record<string, string> = {
  'icon-signin-g': '签到',
  'icon-xr-g': '选人',
  // 2026-10-25 实证：任务页会聚合「作业/测验」（不只是活动），对应图标为 icon-cy-g，
  // 其条目标题实证形如「10.19日作业：…提交学习通作业」。图标语义未 100% 锁定，
  // 故用中性词，不臆测为「测验」；该标签会影响稳定 id（类型参与哈希）。
  'icon-cy-g': '作业或测验',
  'icon-tp': '任务',
};

// 纯函数：从类型图标 class 推断活动类型。优先取“具体类型”图标（非通用 icon-tp）。
export function mapChaoxingTaskTypeIcon(classes: string): string {
  const list = (classes || '').split(/\s+/).filter(Boolean);
  for (const c of list) {
    if (c !== 'icon-tp' && c.startsWith('icon-') && c.endsWith('-g') && CHAOXING_TASK_TYPE_ICONS[c]) {
      return CHAOXING_TASK_TYPE_ICONS[c]!;
    }
  }
  if (list.includes('icon-tp')) return CHAOXING_TASK_TYPE_ICONS['icon-tp']!;
  const m = list.find((c) => c.startsWith('icon-'));
  if (m) return m.replace(/^icon-/, '').replace(/-g$/, '');
  return '其它';
}

// 纯函数：把“结束时间：05-20 08:06”（无年份）归一为本地 ISO；yearless 用当前年补齐，
// 若 isEnded 且补齐后晚于 now，则回退到前一年（取最近一次过去时间，避免把已结束项误判到未来）。
export function normalizeChaoxingTaskDeadline(
  raw: string,
  options?: { nowMs?: number; isEnded?: boolean },
): string | null {
  const m = (raw || '').match(/(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const nowMs = options?.nowMs ?? Date.now();
  const baseYear = new Date(nowMs).getFullYear();
  const iso = (year: number): string => `${year}-${m[1]}-${m[2]}T${m[3]}:${m[4]}`;
  let result = iso(baseYear);
  if (options?.isEnded) {
    const t = new Date(result).getTime();
    if (!Number.isNaN(t) && t > nowMs) {
      result = iso(baseYear - 1);
    }
  }
  return result;
}

export interface RawChaoxingTaskItem {
  title: string;
  type: string; // 签到/选人/任务/其它
  deadlineText: string; // 原始“结束时间：…”文本
  dueAt: string | null;
  section: '进行中' | '已结束';
}

// 纯函数：从任务/活动列表 DOM 抽取结构化原始项（不含映射副作用，便于单测）。
// 返回 null 表示页面不是任务列表（无 .bottomList 或无法解析课程标识）。
export function parseChaoxingTaskListDom(
  doc: Document,
  url: string,
  nowMs = Date.now(),
): { courseId: string; courseName: string; items: RawChaoxingTaskItem[] } | null {
  const courseNameEl = doc.querySelector(chaoxingCfg.fields.taskCourseName ?? '#classObjName');
  const courseName = (courseNameEl?.textContent || '').replace(/\s+/g, ' ').trim();
  let courseid = '';
  let clazzid = '';
  try {
    const params = new URL(url).searchParams;
    courseid = params.get('courseid') || '';
    clazzid = params.get('clazzid') || '';
  } catch {
    /* URL 异常则退化为仅用课程名分组 */
  }
  const courseId = courseid && clazzid ? `${courseid}-${clazzid}` : courseName ? slugifyCourse(courseName) : '';
  if (!courseId) return null;

  const bottom = doc.querySelector('.bottomList');
  if (!bottom) return null;

  const items: RawChaoxingTaskItem[] = [];
  let section: '进行中' | '已结束' = '进行中';

  const readItem = (li: Element): void => {
    const title = (
      li.querySelector(chaoxingCfg.fields.taskTitle ?? '.right-content p, .right-content')?.textContent ||
      ''
    )
      .replace(/\s+/g, ' ')
      .trim();
    if (!title) return;
    const iconClasses = (
      Array.from(li.querySelectorAll(chaoxingCfg.fields.taskTypeIcon ?? '.tag[class*="icon-"]')) as Element[]
    )
      .map((e) => (typeof e.className === 'string' ? e.className : ''))
      .join(' ');
    const type = mapChaoxingTaskTypeIcon(iconClasses);
    const deadlineText = (li.querySelector(chaoxingCfg.fields.taskTime ?? '.time')?.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
    const dueAt = normalizeChaoxingTaskDeadline(deadlineText, { nowMs, isEnded: section === '已结束' });
    items.push({ title, type, deadlineText, dueAt, section });
  };

  // 按**文档顺序**递归遍历，不对层级做任何假设。
  // 原实现只认 `.bottomList` 的直接子 ul：平台一旦多包一层（`.bottomList > div > ul`），
  // 就一行都收不到却仍返回 success —— 表现为任务页永久「成功 · 0 条」。
  // 2026-10-29 复测 6 门课任务页全 0 条，而诊断侧用 `.bottomList li`（后代选择器）
  // 明明拿到 12 行，就是这个层级假设造成的。
  // 同时把分组判定也改成“顺序上最近的那个 .status”：只放宽容器、不动分组的话，
  // 分组头一旦不在直接子层，全部条目都会被归进第一个分组（15 条已结束变成 15 条待办），更糟。
  const walk = (el: Element): void => {
    for (const child of Array.from(el.children)) {
      const tag = child.tagName;
      if (tag === 'LI') {
        readItem(child);
        // 不再下钻：li 内部的 .status 是条目自己的状态，不是分组头。
        continue;
      }
      const cls = typeof child.className === 'string' ? child.className : '';
      if (cls.includes('status')) {
        const name = (child.textContent || '')
          .replace(/\s+/g, ' ')
          .replace(/（\d+）|\(\d+\)/g, '')
          .trim();
        section = name.includes('已结束') ? '已结束' : '进行中';
      }
      walk(child);
    }
  };
  walk(bottom);
  return { courseId, courseName, items };
}

// 任务项稳定键（用于构成 Assignment.id，避免同名活动不同截止时间被误合并）。
// 刻意**不含 section（进行中/已结束）**：同一条活动会随截止时间推进从「进行中」滑到「已结束」，
// 那只是状态变化、不是另一条活动。若把分组算进哈希，状态一变 ID 就变，
// 看板会出现「同一活动既在进行中又已完成」的两条记录。状态由 status 字段表达。
function hashTaskItem(it: RawChaoxingTaskItem): string {
  const s = `${it.type}|${it.title}|${it.deadlineText}`;
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

// 纯函数：把原始任务项映射为 Assignment[]。
// - 进行中 → status='in_progress'（看板“进行中”）。
// - 已结束（无提交状态）→ status='ended'（看板“已完成”，默认隐藏，符合判定表）。
// 标题带截止时间以区分同名活动；id 含稳定哈希。
export function mapChaoxingTaskAssignments(
  items: RawChaoxingTaskItem[],
  ctx: { courseId: string; courseName: string; syncedAt: string; nowMs: number; url: string },
): Assignment[] {
  return items.map((it) => {
    const isEnded = it.section === '已结束';
    const status: Assignment['status'] = isEnded ? 'ended' : 'in_progress';
    const shortDeadline = (it.deadlineText || '').replace(/^结束时间[:：]\s*/, '').trim() || '无截止';
    return {
      id: `chaoxing:${ctx.courseId}:task:${hashTaskItem(it)}`,
      platformId: 'chaoxing',
      courseId: slugifyCourse(ctx.courseName || '学习通任务'),
      courseName: ctx.courseName || '学习通任务',
      title: `${it.type}·${it.title}（${shortDeadline}）`,
      dueAt: it.dueAt,
      url: ctx.url,
      status,
      syncedAt: ctx.syncedAt,
      source: 'course',
    };
  });
}

// 任务/活动列表的解析编排（含渲染等待与结果封装）。
async function extractChaoxingTaskListResult(
  doc: Document,
  url: string,
  options: ChaoxingExtractOptions,
): Promise<PlatformExtractionResult> {
  const ready = (): boolean => !!doc.querySelector('.bottomList li') || !!doc.querySelector('.null-data');
  if (!ready()) {
    // 被动上报（逐课抓取 / 用户打开页面）也要等够：该列表是 XHR 异步渲染，
    // 3s 在慢网络下不够，会把一次本可成功的抓取判成“未渲染”。
    // waitFor 是轮询式的——一旦就绪立即返回，所以调大只在“真的慢”时才多等。
    await waitFor(ready, options.allowAutoOpen ? 8000 : 6000, 250);
  }
  const parsed = parseChaoxingTaskListDom(doc, url, Date.now());
  if (!parsed) {
    throw new SelectorError('chaoxing', '.bottomList, #classObjName', '任务列表未渲染或缺少课程标识');
  }
  // 有行、却一条都认不出来：层级或文案可能又变了，必须硬失败。
  // 若返回 success + 空列表，后台会把它当成“教师把活动全删了”，按课程作用域清空任务项；
  // 而 2026-10-29 的真实事故是反过来的——解析器只认直接子 ul，多包一层就静默给出 0 条。
  const rowCount = doc.querySelectorAll('.bottomList li').length;
  if (rowCount > 0 && parsed.items.length === 0) {
    throw new SelectorError(
      'chaoxing',
      '.bottomList li, .right-content',
      `任务列表有 ${rowCount} 行，但一条都识别不出来（可能已改版）`,
    );
  }
  const syncedAt = new Date().toISOString();
  const nowMs = Date.now();
  const assignments = mapChaoxingTaskAssignments(parsed.items, {
    courseId: parsed.courseId,
    courseName: parsed.courseName,
    syncedAt,
    nowMs,
    url,
  });
  // 单课程范围合并：不 replaceAll，避免清掉其它课程 / 收件箱的数据。
  // 注意两个 ID 的分工（当前阶段 A“课程注册表”尚未落地，先保证不丢数据）：
  //   - assignment.courseId 用“课程名 slug”，与收件箱路径一致 —— 同一门课在看板里只出现一个分组；
  //   - 合并作用域 courseIds 用稳定的 `courseid-clazzid`，不会误清收件箱里同课程的作业通知；
  //   - 作业项 id 用 `chaoxing:<courseid-clazzid>:task:<hash>`，跨会话稳定、可安全去重。
  // 遗留：教师删除活动后旧项不会自动消失（作用域不覆盖课程名分组），待阶段 A 统一 ID 后修复。
  if (assignments.length === 0) {
    return {
      status: 'success',
      assignments: [],
      message: `学习通任务列表「${parsed.courseName}」：无任务项。`,
      courseIds: [parsed.courseId],
    };
  }
  const inProgress = assignments.filter((a) => a.status === 'in_progress').length;
  const ended = assignments.length - inProgress;
  return {
    status: 'success',
    assignments,
    message: `学习通任务列表「${parsed.courseName}」：${assignments.length} 项（${inProgress} 项进行中，${ended} 项已结束默认隐藏）。`,
    courseIds: [parsed.courseId],
  };
}

// ============ 课程注册表（「我的课程」页，阶段 A） ============
// 证据（2026-10-25 用户贴回的诊断 JSON，mooc2-ans.chaoxing.com/visit/interaction）：
//   div#courseList.course-list > div#stuNormalCourseListDiv
//     └─ div.course.clearfix.learnCourse.stu_<clazzId>  且 id="c_<courseId>"
//   实测 6 门课；「线性代数」= id="c_259363438" + class 含 stu_139380153，
//   与其课程页 / 任务列表 URL 的 courseid=259363438&clazzid=139380153 **完全一致**（已交叉验证）。
//   .course-info：h3 → 课程名；p.line2.color3 → 教师；p.margint10.line2.color2 → 班级/学期别名（可缺）。
//   .btm-cover（在 .course-cover 内，故文本上出现在课程名之前）：「任务点进度: 62/62 100%」。
//   ⚠️ 任务点进度 = 章节视频学习进度，**不是**作业/考试提交状态，只作参考展示，不参与判定。

// 纯函数：id="c_259363438" → "259363438"。
export function parseChaoxingCourseId(rawId: string): string {
  const m = (rawId || '').match(/^c_(\d+)$/);
  return m ? m[1]! : '';
}

// 纯函数：class 中的 stu_139380153 → "139380153"。
export function parseChaoxingClazzId(className: string): string {
  const m = (className || '').split(/\s+/).find((c) => /^stu_\d+$/.test(c));
  return m ? m.replace(/^stu_/, '') : '';
}

// 纯函数：「任务点进度: 62/62 100%」→ { done: 62, total: 62 }。无法识别返回 null。
export function parseChaoxingProgress(text: string): { done: number; total: number } | null {
  const m = (text || '').replace(/\s+/g, ' ').match(/(\d+)\s*\/\s*(\d+)/);
  if (!m) return null;
  return { done: Number(m[1]), total: Number(m[2]) };
}

function cleanText(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

// 从「我的课程」页抽取课程注册表。返回空数组表示没有解析到课程卡片（调用方据此报错）。
export function parseChaoxingCourseListDom(doc: Document, syncedAt: string): ChaoxingCourse[] {
  const primary = chaoxingCfg.fields.courseList ?? '#courseList div[id^="c_"]';
  let cards = Array.from(doc.querySelectorAll(primary));
  if (cards.length === 0) {
    const fallback = chaoxingCfg.fields.courseListFallback ?? 'div.course[id^="c_"]';
    cards = Array.from(doc.querySelectorAll(fallback));
  }

  const courses: ChaoxingCourse[] = [];
  const seen = new Set<string>();
  for (const card of cards) {
    const courseId = parseChaoxingCourseId(card.id || '');
    const clazzId = parseChaoxingClazzId(typeof card.className === 'string' ? card.className : '');
    // 两个 ID 缺一不可：只有 courseId 无法定位教学班，只有 clazzId 无法跨入口归并。
    if (!courseId || !clazzId) continue;
    const key = `${courseId}-${clazzId}`;
    if (seen.has(key)) continue;

    // 课程名：优先 .course-info h3。实测课程名可能嵌在 h3 的子元素（如 <a>）里，
    // textContent 已能取到；再回退到 h3 内链接 / .course-info 内链接，避免整张卡片被跳过。
    const nameEl = card.querySelector(chaoxingCfg.fields.courseName ?? '.course-info h3');
    const name =
      cleanText(nameEl?.textContent) ||
      cleanText(nameEl?.querySelector('a')?.textContent) ||
      cleanText(card.querySelector('.course-info a')?.textContent);
    // 课程名取不到时不臆造：该卡片直接跳过（宁可漏，也不要出现“未知课程”占位项）。
    if (!name) continue;
    seen.add(key);

    // 教师优先取 color3 样式的 p（实测稳定），取不到时退回最后一个非空 p。
    const paragraphs = Array.from(card.querySelectorAll('.course-info p'));
    const teacherEl =
      paragraphs.find((p) => (typeof p.className === 'string' ? p.className : '').includes('color3')) ??
      [...paragraphs].reverse().find((p) => cleanText(p.textContent));
    const teacher = cleanText(teacherEl?.textContent);
    const aliasEl = paragraphs.find(
      (p) => p !== teacherEl && !/任务点进度/.test(cleanText(p.textContent)) && cleanText(p.textContent),
    );
    const alias = cleanText(aliasEl?.textContent) || undefined;

    const progressText =
      cleanText(card.querySelector(chaoxingCfg.fields.courseProgress ?? '.btm-cover')?.textContent) ||
      undefined;
    const progress = progressText ? parseChaoxingProgress(progressText) : null;

    courses.push({
      courseId,
      clazzId,
      name,
      teacher,
      alias,
      progressText,
      progressDone: progress?.done,
      progressTotal: progress?.total,
      syncedAt,
    });
  }
  return courses;
}

// 课程注册表解析编排（含渲染等待与结果封装）。
// 注意：本页**不产出作业**（作业状态必须进课程页列表读），故 assignments 恒为空、
// 也不给 courseIds —— 后台合并时作用域为空会原样保留现有作业，不会误清。
async function extractChaoxingCourseRegistryResult(
  doc: Document,
  options: ChaoxingExtractOptions,
): Promise<PlatformExtractionResult> {
  const ready = (): boolean =>
    doc.querySelectorAll('#courseList div[id^="c_"]').length > 0 ||
    !!doc.querySelector('#courseList .null-data');
  if (!ready()) {
    await waitFor(ready, options.allowAutoOpen ? 6000 : 3000, 250);
  }
  const courses = parseChaoxingCourseListDom(doc, new Date().toISOString());
  if (courses.length === 0) {
    throw new SelectorError('chaoxing', '#courseList div[id^="c_"]', '「我的课程」页未渲染出课程卡片');
  }
  return {
    status: 'success',
    assignments: [],
    message: `学习通课程注册表：已收录 ${courses.length} 门课（courseId+clazzId）。作业/考试/任务的提交状态仍需进入各课程页读取。`,
    courses,
  };
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
  const path = parsedUrl.pathname;

  // 仅处理学习通域；非学习通直接跳过（platforms.ts 已按 host 过滤，此处双保险）。
  if (hostname && !/(^|\.)chaoxing\.com$/.test(hostname)) {
    return null;
  }

  // 顶层 i.chaoxing.com 读不到跨域 iframe 内容，交给 iframe（notice.chaoxing.com）解析；
  // 顶层返回 null，避免用空结果覆盖 iframe 已写入的缓存。
  if (hostname === 'i.chaoxing.com') {
    return null;
  }

  // 「我的课程」页（阶段 A 课程注册表）：mooc2-ans/visit/interaction 或 mooc1/visit/stucoursemiddle。
  // 该页只枚举课程（courseId + clazzId + 课程名 + 教师），不产出作业状态。
  if (path.includes('/visit/interaction') || path.includes('stucoursemiddle')) {
    return extractChaoxingCourseRegistryResult(doc, options);
  }

  // 顶层 mooc2-ans 课程页外壳：真实任务/作业/考试列表在跨域 iframe（mobilelearn/mooc1），
  // 本页无作业 DOM，返回 null，由内容 iframe 自行解析。
  if (hostname === 'mooc2-ans.chaoxing.com') {
    return null;
  }

  // 任务/活动列表（mobilelearn.chaoxing.com/page/active/stuActiveList，2026-10-25 取证）。
  if (hostname === 'mobilelearn.chaoxing.com' && path.includes('stuActiveList')) {
    return extractChaoxingTaskListResult(doc, url, options);
  }

  // 作业列表 / 考试列表（mooc1.chaoxing.com/mooc2/work/list、exam-ans/mooc2/exam/exam-list）。
  // 尚未取证诊断，暂以 needs-verification 显式提示（不静默清空、不误报成功）；
  // 待用户分别诊断「作业」「考试」标签取证后落地（见 学习通任务完成判定规则.md）。
  // 作业 / 考试列表（exam-ans/mooc2/exam/exam-list，2026-10-29 已取证并落地解析）。
  // 该页是「作业 + 测验 + 课堂活动」混合列表，是作业进看板的唯一来源。
  if (path.includes('exam-list')) {
    return extractChaoxingExamListResult(doc, url, options);
  }

  // mooc2/work/list：实测（2026-10-29）打开只有「提示」弹窗、正文 0 字、0 行，取不到任何列表；
  // 而作业在 exam-list 里已全部覆盖，故本条路径不再抓取，但仍保留显式说明，避免被误当成解析失败。
  if (path.includes('work/list')) {
    return {
      status: 'needs-verification',
      assignments: [],
      message:
        '学习通 mooc2/work/list 打开后无可读列表（实测只有弹窗）。作业已由「考试列表」页覆盖，本页可忽略。',
    };
  }

  // notice.chaoxing.com 下仅收件箱列表页（/pc/notice/myNotice）具备解析权；
  // 其它页面（如单条通知详情）没有列表 DOM，若按“0 条”处理会整组清空缓存，必须返回 null。
  if (!path.includes('myNotice')) {
    return null;
  }

  // 以下在 notice.chaoxing.com 收件箱 iframe 上下文执行。
  // 等列表渲染（document_idle 通常已就绪，仍做有界等待以防偏早）。
  const ready = (): boolean =>
    doc.querySelectorAll(chaoxingCfg.item ?? 'li.dataBody_item').length > 0;
  if (!ready()) {
    await waitFor(ready, options.allowAutoOpen ? 4000 : 2500, 200);
  }
  // 有界等待后仍无列表容器：明确报错（needs-verification），绝不静默清空缓存（反馈 2.3）。
  if (!ready()) {
    throw new SelectorError(
      'chaoxing',
      chaoxingCfg.item ?? 'li.dataBody_item',
      '收件箱列表未渲染（可能网络慢或平台已改版）',
    );
  }

  const raw = readRawItems(doc);
  // 容器在、但读不到任何条目：字段选择器可能已失效，同样显式报错，不静默清空。
  if (raw.length === 0) {
    throw new SelectorError(
      'chaoxing',
      `${chaoxingCfg.fields.title}, ${chaoxingCfg.fields.detailUrl}[${chaoxingCfg.fields.detailUrlAttr}]`,
      '列表已渲染但读不到消息条目（字段选择器可能已失效）',
    );
  }

  // 翻页：收件箱可能有多页，逐页累加（反馈：学习通此前只读第一页）。
  const allRaw = await collectAllPages(doc, raw);

  const homeworkItems = allRaw.filter((it) => classifyChaoxingTitle(it.title) === 'homework');
  const examItems = allRaw.filter((it) => classifyChaoxingTitle(it.title) === 'exam');

  const syncedAt = new Date().toISOString();
  const nowMs = Date.now();
  // 跨年消歧：用列表发送时间（倒序 + notice_time）给每条通知锚定真实年份，
  // 作为该通知详情页无年份“考试时间：MM-DD”的补齐基准。
  const years = resolveChaoxingNoticeYears(allRaw, nowMs);
  const detailYear = new Date(nowMs).getFullYear();

  // 考试通知：逐条读取详情页“已渲染 DOM”解析“课程/考试名/开始/结束时间”（“注意时间”判定）。
  // 列表页与详情页同域 notice.chaoxing.com，自建隐藏 iframe 等价于手动点开“通知”
  // （主页面不跳转、绝不误点“考试”按钮）。有界并发（默认 5）抓取，单条失败降级（不臆测）。
  // 每条按其发送时间锚定年份、并以“通知月日”做精确跨年判定（noticeMonthDay）。
  const noticeMonthDay = (s: string | undefined): number | undefined => {
    const m = (s ?? '').match(/(\d{1,2})-(\d{1,2})/);
    return m ? Number(m[1]) * 100 + Number(m[2]) : undefined;
  };
  const examDetails: (ChaoxingExamDetail | null)[] = await mapWithConcurrency(
    examItems,
    5,
    async (item) =>
      readNoticeDetailText(doc, item.detailUrl).then((text) =>
        text
          ? parseChaoxingExamDetailText(text, {
              year: years.get(item.id) ?? detailYear,
              nowMs,
              noticeMonthDay: noticeMonthDay(item.noticeTime),
            })
          : null,
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

// ============================================================================
// 作业 / 考试列表（mooc1.chaoxing.com/exam-ans/mooc2/exam/exam-list）
//
// 2026-10-29 诊断取证（真实 DOM + 真实 URL），两个反直觉结论：
//   1) 该页标题虽叫「考试列表」，实际是**作业 + 测验 + 课堂活动**的混合列表——
//      「线代作业1..4 / 线代测验1..4 / 课堂学习活动（第三章）」全在里面，图标统一为
//      `icon-exam-g`（无法靠图标区分类型，只能从标题推断）。
//      因此**不需要** mooc2/work/list：实测打开它只有「提示」弹窗、正文 0 字、0 行。
//   2) 该页**不显示截止时间**（任务页有「结束时间：MM-DD HH:MM」，这里没有）。
//      所以 dueAt 一律 null，标题也不拼时间；排序由调用方按 syncedAt/status 处理。
//
// 实测每行结构（与任务页不同，照抄任务页解析器会踩两个坑）：
//   li > div > div.right-content
//          > p.overHidden2.fl   "线代作业4"    ← 标题
//          > p.status.fl        "已完成"       ← 状态（**每行各一个**）
// 坑①：没有「进行中/已结束」分组，状态不在 .bottomList 的直接子 div 上，而在每个 li 内部；
//      任务页那套「遍历 .bottomList 子元素、遇 .status 就切 section」在这里会读到 0 条。
// 坑②：`p.status` 有两个 p 兄弟（标题 p 与状态 p），取 .right-content p 的第一个会把状态当标题。
// ============================================================================

// 纯函数：把作业/考试列表的原始状态文案映射到统一状态枚举。
// 认不出的返回 null —— 由调用方计入“未识别行”，绝不猜成已完成（猜错会把待办隐藏掉）。
export function mapChaoxingExamStatus(raw: string): Assignment['status'] | null {
  const s = (raw || '').replace(/\s+/g, '').trim();
  if (!s) return null;
  // 顺序有讲究：先判「退回」「过期」这类复合语义，再判「已完成」。
  if (/已退回|需重交|重交|打回|不通过/.test(s)) return 'returned';
  if (/已过期|已截止|已结束|已关闭|已失效/.test(s)) return 'expired';
  if (/待批阅|批阅中|待评|待评分|评阅中/.test(s)) return 'submitted';
  if (/可重考|重考|可重做/.test(s)) return 'retake';
  if (/未完成|未提交|未交|待完成|未参与|去完成|未开始/.test(s)) return 'unsubmitted';
  if (/已完成|已提交|已交|已通过|已批阅/.test(s)) return 'completed';
  if (/进行中|进行|已开始/.test(s)) return 'in_progress';
  return null;
}

// 纯函数：该列表的图标全一样，类型只能从标题推断（用于看板标签与 id 哈希）。
export function inferChaoxingExamType(title: string): string {
  const t = (title || '').trim();
  if (!t) return '其它';
  if (/考试|期末|期中|补考|重修考试/.test(t)) return '考试';
  if (/测验|测试|小测|自测/.test(t)) return '测验';
  if (/作业/.test(t)) return '作业';
  if (/课堂学习活动|课堂活动/.test(t)) return '课堂活动';
  if (/实验/.test(t)) return '实验';
  if (/讨论/.test(t)) return '讨论';
  return '其它';
}

export interface RawChaoxingExamItem {
  title: string;
  type: string; // 作业/测验/考试/课堂活动/实验/讨论/其它
  statusText: string; // 原始状态文案（已完成 / 已过期 …）
  status: Assignment['status'];
}

// 纯函数：从作业/考试列表 DOM 抽取结构化原始项（无副作用，便于单测）。
// 返回 null 表示页面不是该列表（无 .bottomList / 无法解析课程标识）。
export function parseChaoxingExamListDom(
  doc: Document,
  url: string,
): {
  courseId: string;
  courseName: string;
  items: RawChaoxingExamItem[];
  // 有列表行但状态/标题取不到的行数：>0 且 items 为空说明选择器可能已改版，调用方必须硬失败。
  unparsedRows: number;
} | null {
  // 课程名：任务页是 #classObjName；本页只有 .top-back > h2（无 id），故按序兜底。
  const courseNameEl = doc.querySelector('#classObjName, .top-back h2, .top-back');
  const courseName = (courseNameEl?.textContent || '').replace(/\s+/g, ' ').trim();

  let courseid = '';
  let clazzid = '';
  try {
    const params = new URL(url).searchParams;
    // 该页实测参数是小写 courseid/clazzid；大小写两种都兼容（不同入口会互相不一致）。
    courseid = (params.get('courseid') || params.get('courseId') || '').trim();
    clazzid = (params.get('clazzid') || params.get('classId') || '').trim();
  } catch {
    /* URL 异常则退化为仅用课程名分组 */
  }
  const courseId =
    courseid && clazzid ? `${courseid}-${clazzid}` : courseName ? slugifyCourse(courseName) : '';
  if (!courseId) return null;

  const bottom = doc.querySelector('.bottomList');
  if (!bottom) {
    // 空态页：平台在「本课程没有作业/考试」时只渲染 .null-data，不渲染 .bottomList。
    // 这是**有效结论（0 条）**，不是解析失败——否则一门本来就没布置作业的课会永远报
    // “列表未渲染”，用户只会以为扩展坏了（2026-10-29 实测就有一门课卡在这里）。
    // 但仍要求有课程标识：空态下凭空返回 0 条，会按错误作用域把别的课缓存清掉。
    if (doc.querySelector('.null-data')) {
      return { courseId, courseName, items: [], unparsedRows: 0 };
    }
    return null;
  }

  const items: RawChaoxingExamItem[] = [];
  let unparsedRows = 0;
  for (const li of Array.from(bottom.querySelectorAll('li'))) {
    // 标题固定是 .overHidden2（超长两行截断的那个 p）；状态是它兄弟 .status。
    const titleEl = li.querySelector('.right-content .overHidden2, .overHidden2');
    const statusEl = li.querySelector('.right-content .status, .status');
    const title = (titleEl?.textContent || '').replace(/\s+/g, ' ').trim();
    const statusText = (statusEl?.textContent || '').replace(/\s+/g, ' ').trim();
    if (!title || !statusText) {
      unparsedRows += 1;
      continue;
    }
    const status = mapChaoxingExamStatus(statusText);
    if (!status) {
      unparsedRows += 1;
      continue;
    }
    items.push({ title, type: inferChaoxingExamType(title), statusText, status });
  }
  return { courseId, courseName, items, unparsedRows };
}

// 作业/考试项稳定键（构成 Assignment.id）。
// 刻意**不含 status**：状态会从「未完成」→「已完成」/「已过期」迁移，那只是状态变化，
// 不是另一条作业。含状态会让同一条作业在看板上裂成两条（与任务页 hashTaskItem 同一教训）。
// 本页无截止时间，只能靠 type|title 做身份；跨学期同门课 courseId 不同，不会撞。
function hashExamItem(it: RawChaoxingExamItem): string {
  const s = `${it.type}|${it.title}`;
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

// 纯函数：把原始项映射为 Assignment[]。
// - assignment.courseId 用课程名 slug：与收件箱通知、任务页同源，保证一门课在看板只有一个分组；
// - 合并作用域用稳定的 `courseid-clazzid`（由调用方传 courseIds），两者分工见 extract 里的注释；
// - dueAt 为 null：该页不显示截止时间（真实限制，不臆造）。
export function mapChaoxingExamAssignments(
  items: RawChaoxingExamItem[],
  ctx: { courseId: string; courseName: string; syncedAt: string; url: string },
): Assignment[] {
  const groupName = ctx.courseName || '学习通作业';
  return items.map((it) => ({
    id: `chaoxing:${ctx.courseId}:exam:${hashExamItem(it)}`,
    platformId: 'chaoxing',
    courseId: slugifyCourse(groupName),
    courseName: groupName,
    title: `${it.type}·${it.title}`,
    dueAt: null,
    url: ctx.url,
    status: it.status,
    syncedAt: ctx.syncedAt,
    source: 'course',
  }));
}

// 作业/考试列表的解析编排（渲染等待 + 结果封装）。
async function extractChaoxingExamListResult(
  doc: Document,
  url: string,
  options: ChaoxingExtractOptions,
): Promise<PlatformExtractionResult> {
  const ready = (): boolean => !!doc.querySelector('.bottomList li') || !!doc.querySelector('.null-data');
  if (!ready()) {
    // 与任务页同理：XHR 异步渲染，waitFor 是轮询式（就绪即返回），调大只在真慢时多等。
    await waitFor(ready, options.allowAutoOpen ? 8000 : 6000, 250);
  }
  const rowCount = doc.querySelectorAll('.bottomList li').length;
  const parsed = parseChaoxingExamListDom(doc, url);
  if (!parsed) {
    throw new SelectorError(
      'chaoxing',
      '.bottomList, .top-back h2',
      '作业/考试列表未渲染或缺少课程标识',
    );
  }
  // 行在、却一条都认不出来：选择器/文案可能已改版。这里必须硬失败——
  // 若返回 success + 空列表，后台会把它当成“教师把作业全删了”，
  // 按课程作用域清空该课所有作业项（真实数据丢失）。
  if (rowCount > 0 && parsed.items.length === 0) {
    throw new SelectorError(
      'chaoxing',
      '.right-content .overHidden2, .right-content .status',
      `作业/考试列表有 ${rowCount} 行，但标题或状态文案无法识别（可能已改版）`,
    );
  }

  const syncedAt = new Date().toISOString();
  const assignments = mapChaoxingExamAssignments(parsed.items, {
    courseId: parsed.courseId,
    courseName: parsed.courseName,
    syncedAt,
    url,
  });

  if (assignments.length === 0) {
    // 列表确实为空（.null-data 或 0 行）：这是有效结论，用空数组把该课旧项清掉。
    return {
      status: 'success',
      assignments: [],
      message: `学习通作业/考试列表「${parsed.courseName}」：无作业或考试。`,
      courseIds: [parsed.courseId],
    };
  }

  // 按状态汇总成一句人话（看板与运行日志同一口径）。
  const counts = new Map<Assignment['status'], number>();
  for (const a of assignments) {
    counts.set(a.status, (counts.get(a.status) ?? 0) + 1);
  }
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([st, n]) => `${assignmentStatusLabel(st)} ${n}`)
    .join(' / ');
  const skipNote = parsed.unparsedRows > 0 ? `，另有 ${parsed.unparsedRows} 行状态未识别已跳过` : '';
  return {
    status: 'success',
    assignments,
    message: `学习通作业/考试列表「${parsed.courseName}」：${assignments.length} 项（${parts}）${skipNote}。`,
    courseIds: [parsed.courseId],
  };
}

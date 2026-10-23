// 批改网（pigai.org）作业解析器（真实实现，基于已核实的页面诊断样本，2026-10-23）。
//
// 依据：用户在已登录的批改网学生端“我的作文”页（www.pigai.org/index.php，默认落在
// “未完成”标签）运行去敏诊断（diagnose.ts）后贴回的真实结构：
//
//   状态标签（ul.tbMenu2010 / li.showST）：
//     “已完成”（class "showST"） / “未完成”（class "select showST"＝当前激活）
//     —— 平台已自带“未提交”分类，本扩展只认“未完成”视图。
//   作业列表容器：#essayList（class ydTable）
//   表头（ul.reItemM）：作业号 | 作业标题 | 类型 | 出题人 | 指定班级 | 截止时间 | 操作
//   每行（ul.reItemS）：
//     作业号（如 3443402）｜标题（li.stu_title > a，自带真实 href 深链）｜类型（作文）｜
//     出题人（如 王宁）｜指定班级（逗号分隔的多班列表）｜截止时间（YYYY-MM-DD HH:MM）｜
//     操作（查看，li.stu_index > a）
//   样本 3 条：B2U6（截止 2026-11-16）、B2U5（截止 2026-10-19）、B1U2（截止 2025-11-10）。
//
// “未提交”语义：激活标签为“未完成”时，列表里所有行＝平台明确标记为未提交 → 纳入看板。
//   —— 平台把“未完成”与“已完成”严格分桶，故无需再猜状态文案；只要落在“未完成”视图即可。
//   —— 个别条目可能已过截止时间（如样本第 3 条 2025-11-10）但仍被平台留在“未完成”，
//      按需求文档“是否未提交以平台状态为准、不得仅因截止时间推断”，默认仍纳入，
//      截止时间仅用于排序/提示；如需“自动隐藏已过期项”可后续加开关。
//
// 实现约束（同东软/iTEST，不猜测）：
//   - 仅基于已核实的可见文本与稳定结构解析；深链用 DOM 取真实 href（text 解析拿不到）。
//   - 仅“未完成”视图产出数据；“已完成”视图或无关页静默跳过（不覆盖缓存）。
//   - 列表为空（未完成 0 条）时 replaceAll 整组清空该平台，避免旧条目残留。

import type { Assignment, PlatformExtractionResult } from './models';
import { slugifyCourse } from './neusoft.ts';
import { PLATFORM_SELECTOR_CONFIG } from './selectors.ts';

// 选择器集中配置（反馈 2.3：抽成配置，避免学校改版时逐个翻解析器）。
const pigaiCfg = PLATFORM_SELECTOR_CONFIG.pigai;

interface PigaiExtractOptions {
  // 语义同 neusoft.ts / itest.ts：
  // - 页面自动上报（document_idle）：false；
  // - 用户在看板点“刷新当前平台”（SYNC_ACTIVE_PAGE）：true（放宽渲染等待时长）。
  allowAutoOpen: boolean;
}

export type PigaiItemStatus = 'unsubmitted' | 'submitted' | 'expired' | 'unknown';

export interface ParsedPigaiItem {
  assignmentNumber: string | null; // 作业号
  index: number | null; // 行序（展示用）
  title: string;
  dueAt: string | null; // 本地时间 ISO（无则为 null）
  status: PigaiItemStatus;
}

// 每行作业（作业号 → 标题 → “作文” → 出题人 → 指定班级 → 截止时间 → “查看”）。
// 以 6+ 位数字（作业号）为行起点，避免命中页头/页脚的“作文”“ICP 号”等干扰文本。
const ROW_RE =
  /(\d{6,})\s+([\s\S]*?)\s+作文\s+(\S+)\s+([\s\S]*?)\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s+查看/g;

// 截止时间文本 → 本地时间 ISO（YYYY-MM-DDTHH:MM:SS）。无则为 null。
export function toPigaiIso(dueRaw: string): string | null {
  const m = dueRaw.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(?::(\d{2}))?$/);
  if (!m) {
    return null;
  }
  const sec = m[3] ?? '00';
  return `${m[1]}T${m[2]}:${sec}`;
}

// 纯文本解析（无 DOM 依赖，便于单测）：从整页可见文本提取“未完成”作业行。
export function parsePigaiEssayText(text: string): ParsedPigaiItem[] {
  const items: ParsedPigaiItem[] = [];
  let index = 0;
  for (const m of text.matchAll(ROW_RE)) {
    const assignmentNumber = (m[1] ?? '').trim();
    const title = (m[2] ?? '').trim();
    const dueRaw = (m[5] ?? '').trim();
    if (!title || !assignmentNumber) {
      continue;
    }
    items.push({
      assignmentNumber,
      index: index + 1,
      title,
      dueAt: toPigaiIso(dueRaw),
      status: 'unsubmitted',
    });
    index += 1;
  }
  return items;
}

// 把解析结果映射为 Assignment（纯函数，便于单测）。source='home'：未完成标签是聚合视图，
// 配合 replaceAll 在确实无待办时清空该平台旧条目。深链优先用逐项真实 href，缺则回退列表页。
export function mapPigaiAssignments(
  items: ParsedPigaiItem[],
  ctx: { url: string; syncedAt: string; urls: Map<string, string> },
): Assignment[] {
  return items.map((it) => ({
    id: `pigai:${it.assignmentNumber ?? slugifyCourse(it.title)}`,
    platformId: 'pigai',
    courseId: 'pigai',
    courseName: '批改网',
    title: it.title,
    dueAt: it.dueAt,
    url: ctx.urls.get(it.assignmentNumber ?? '') ?? ctx.url,
    status: 'unsubmitted',
    syncedAt: ctx.syncedAt,
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

// 判断当前激活的状态标签：'unsubmitted'=未完成（取数） / 'submitted'=已完成（跳过） / null=未识别。
function findActiveStatusTab(doc: Document): 'unsubmitted' | 'submitted' | null {
  const tabs = Array.from(doc.querySelectorAll(pigaiCfg.fields.statusTab!));
  if (tabs.length === 0) {
    return null;
  }
  const active =
    tabs.find((li) => li.classList.contains('select')) ??
    tabs.find((li) => /未完成/.test(li.textContent ?? ''));
  const t = (active?.textContent ?? '').replace(/\s+/g, '');
  if (/已完成/.test(t) && !/未完成/.test(t)) {
    return 'submitted';
  }
  if (/未完成/.test(t)) {
    return 'unsubmitted';
  }
  return null;
}

// 从 DOM 取每条作业的真实深链（text 解析拿不到 href），以作业号为键关联。
function collectPigaiDetailUrls(doc: Document): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of Array.from(doc.querySelectorAll(pigaiCfg.fields.row!))) {
    const num = (row.querySelector('li')?.textContent ?? '').trim();
    const link = row.querySelector(pigaiCfg.fields.titleLink!) as HTMLAnchorElement | null;
    if (num && link?.href) {
      map.set(num, link.href);
    }
  }
  return map;
}

function readPageText(doc: Document): string {
  return (doc.body?.innerText ?? '').replace(/\s+/g, ' ').trim();
}

export async function extractPigaiAssignments(
  doc: Document,
  url: string,
  options: PigaiExtractOptions,
): Promise<PlatformExtractionResult | null> {
  let hostname = '';
  try {
    hostname = new URL(url).hostname;
  } catch {
    hostname = '';
  }

  // 仅处理 pigai.org 域；非 pigai 直接跳过（platforms.ts 已按 host 过滤，此处双保险）。
  if (hostname && !hostname.endsWith('pigai.org')) {
    return null;
  }

  // 等待作业列表渲染（传统 PHP 服务端渲染，通常即时；仍做有界等待以防 document_idle 偏早）。
  const listReady = (): boolean =>
    !!doc.querySelector(pigaiCfg.fields.listHeader!) ||
    /作业号\s*作业标题\s*类型\s*出题人\s*指定班级\s*截止时间/.test(readPageText(doc));
  if (!listReady()) {
    await waitFor(listReady, options.allowAutoOpen ? 4000 : 2500, 200);
  }

  const text = readPageText(doc);
  const hasList = !!doc.querySelector(pigaiCfg.fields.listHeader!) || /作业号\s*作业标题/.test(text);

  if (!hasList) {
    // 不在作业列表页：已登录（如首页，页头有用户链接）则静默跳过保留缓存；
    // 未登录（无用户链接）则提示登录，避免把登录页误判为“0 条作业”。
    const loggedIn = !!doc.querySelector(pigaiCfg.fields.nickname!) || /退出/.test(text);
    if (loggedIn) {
      return null;
    }
    return {
      status: 'login-required',
      assignments: [],
      message: '批改网需要登录，未更新作业数据。',
    };
  }

  // 仅处理“未完成”视图；当前是“已完成”（已提交）视图则静默跳过，不更新未提交缓存。
  const activeTab = findActiveStatusTab(doc);
  if (activeTab === 'submitted') {
    return null;
  }

  const items = parsePigaiEssayText(text);
  const urls = collectPigaiDetailUrls(doc);
  const syncedAt = new Date().toISOString();
  const assignments = mapPigaiAssignments(items, { url, syncedAt, urls });

  // 未完成 0 条：整组清空该平台缓存，避免旧条目永久残留。
  if (assignments.length === 0) {
    return {
      status: 'success',
      assignments: [],
      message: '批改网：暂无未完成作业。',
      replaceAll: true,
    };
  }

  return {
    status: 'success',
    assignments,
    message: `批改网：未完成 ${assignments.length} 项。`,
    replaceAll: true,
  };
}

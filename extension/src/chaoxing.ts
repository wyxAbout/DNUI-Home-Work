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
// 3) 标题规律（来自真实 mainText）：
//    - “作业：《课程》描述” —— 作业下发通知，视为“还需要做的任务”；
//    - “作业结束提醒”      —— 作业已结束的提示，非待办，排除；
//    - “考试通知”/其它     —— 非可提交任务，排除。
//    规则：标题以“作业”开头且不含“结束提醒” → 计入；其余排除。
// 4) 收件箱只下发通知、不提供“是否已提交”状态，故统一标 status='unsubmitted'（看板显示“未提交”），
//    不臆测提交状态；无截止时间（dueAt=null），看板按“未提供截止时间”展示，不触发“自动隐藏已过期项”。

import type { Assignment, PlatformExtractionResult } from './models';
import { slugifyCourse } from './neusoft.ts';

interface ChaoxingExtractOptions {
  // 语义同 neusoft.ts / itest.ts / pigai.ts：
  // - 页面自动上报（document_idle）：false；
  // - 用户在看板点“刷新当前平台”（SYNC_ACTIVE_PAGE）：true（放宽渲染等待时长）。
  allowAutoOpen: boolean;
}

// 消息类别：homework=作业下发（计入待办）/ homework_closed=作业结束提醒（排除）/ other=考试通知等（排除）。
export type ChaoxingTitleKind = 'homework' | 'homework_closed' | 'other';

// 纯函数：根据标题判定类别（不依赖 DOM，便于单测，使用真实样本）。
export function classifyChaoxingTitle(title: string): ChaoxingTitleKind {
  const t = (title ?? '').trim();
  if (!t) return 'other';
  if (/^作业/.test(t)) {
    return /结束提醒/.test(t) ? 'homework_closed' : 'homework';
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

export async function extractChaoxingAssignments(
  doc: Document,
  url: string,
  options: ChaoxingExtractOptions,
): Promise<PlatformExtractionResult | null> {
  let hostname = '';
  try {
    hostname = new URL(url).hostname;
  } catch {
    hostname = '';
  }

  // 仅处理学习通域；非学习通直接跳过（platforms.ts 已按 host 过滤，此处双保险）。
  if (hostname && !/(^|\.)chaoxing\.com$/.test(hostname)) {
    return null;
  }

  // 顶层 i.chaoxing.com 读不到跨域 iframe 内容，交给 iframe（notice.chaoxing.com）解析；
  // 顶层返回 null，避免用空结果覆盖 iframe 已写入的缓存。
  if (hostname === 'i.chaoxing.com') {
    return null;
  }

  // 以下在 notice.chaoxing.com 收件箱 iframe 上下文执行。
  // 等列表渲染（document_idle 通常已就绪，仍做有界等待以防偏早）。
  const ready = (): boolean => doc.querySelectorAll('li.dataBody_item').length > 0;
  if (!ready()) {
    await waitFor(ready, options.allowAutoOpen ? 4000 : 2500, 200);
  }

  const raw = readRawItems(doc);
  // 仅保留作业下发通知（排除“作业结束提醒”与“考试通知”等）。
  const tasks = raw.filter((it) => classifyChaoxingTitle(it.title) === 'homework');

  const syncedAt = new Date().toISOString();

  // 收件箱为空或无可计入的作业通知：replaceAll 整组清空该平台旧条目，避免残留。
  if (tasks.length === 0) {
    return {
      status: 'success',
      assignments: [],
      message: '学习通邮箱：收件箱暂无未处理作业通知。',
      replaceAll: true,
    };
  }

  const assignments = mapChaoxingAssignments(tasks, { syncedAt });
  return {
    status: 'success',
    assignments,
    message: `学习通邮箱：收件箱 ${assignments.length} 项作业通知待处理。`,
    replaceAll: true,
  };
}

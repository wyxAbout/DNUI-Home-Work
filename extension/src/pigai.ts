// 批改网（pigai.org）作业解析器。
//
// ⚠️ 当前状态：占位实现（待取证落地）。返回 needs-verification，后台不会覆盖上次成功同步的缓存。
//
// ===== 入口（需求文档已确认）=====
//   首页：https://www.pigai.org/
//   真实作业页面路径、登录域、状态文案均需用户登录后“页面诊断”取证，不得猜测。
//
// ===== 约束（与东软/iTEST 一致，硬规则）=====
//   - 不猜 API 路径、字段名、“未提交”状态文案。
//   - 仅在拿到已登录作业页的真实结构（去敏 mainText / 接口 pathname / 标签与可见文本）后落地解析。
//   - 解析出的“未提交”条数须与页面汇总（若有）一致，或确实为空，才返回 success；
//     否则返回 needs-verification，后台保留旧缓存，绝不清空/误更新。
//
// ===== 已规划的结构（取证后实现，对齐 itest.ts）=====
//   parsePigaiPageText(text)       —— 纯函数：从可见文本解析作业项与汇总。
//   classifyPigaiStatus(text)      —— 纯函数：判定“未提交 / 已提交 / 已截止”等。
//   mapPigaiAssignments(items,ctx) —— 纯函数：映射为 Assignment（source:'home' 聚合视图）。
//   extractPigaiAssignments(...)   —— DOM 胶水：等待 SPA 渲染、登录态判定、调用纯函数。

import type { Assignment, PlatformExtractionResult } from './models';

interface PigaiExtractOptions {
  // 语义同 neusoft.ts / itest.ts：
  // - 页面自动上报（document_idle）：false；
  // - 用户在看板点“刷新当前平台”（SYNC_ACTIVE_PAGE）：true。
  // 当前占位实现为只读扫描，不点击任何元素；该参数仅预留给未来 SPA 渲染等待时长调整。
  allowAutoOpen: boolean;
}

// 批改网状态分类（待取证后实现，对应平台真实文案）。
//   unsubmitted = 未提交 / 待批改 / 进行中（纳入看板“未完成”）；
//   submitted   = 已提交 / 已批改（排除）；
//   expired     = 已截止 / 错过（据证据决定是否计入，参考 iTEST 的 absent 处理）；
//   unknown     = 无法判定（保守不计，触发 needs-verification）。
export type PigaiItemStatus = 'unsubmitted' | 'submitted' | 'expired' | 'unknown';

export interface ParsedPigaiItem {
  index: number | null;
  title: string;
  courseName: string | null;
  dueAt: string | null;
  status: PigaiItemStatus;
}

// TODO（待取证）：纯文本解析纯函数。
//   parsePigaiPageText(text): { unsubmittedCount: number | null; items: ParsedPigaiItem[] }
//   classifyPigaiStatus(text): PigaiItemStatus
//   mapPigaiAssignments(items, ctx): Assignment[]
// 设计原则（同 itest.ts）：以用户稳定可见的文案为锚，不以 CSS 类名为锚，避免前端发版后失效。

export async function extractPigaiAssignments(
  _doc: Document,
  url: string,
  _options: PigaiExtractOptions,
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

  // TODO（待取证）：登录态判定。
  //   批改网未登录时会跳登录页或显示登录入口，应据真实证据返回 login-required，
  //   避免把登录页误判为“0 条作业”而清空缓存。

  // TODO（待取证）：真实解析落地。据诊断回传证据确认：
  //   ① 作业列表容器与每条作业边界锚点；
  //   ② “未提交 / 待批改 / 进行中 / 已提交 / 已截止”等状态文案的真实措辞；
  //   ③ 截止时间字段位置与格式（写作任务常带截止日期）；
  //   ④ 作业详情深链是否可取（<a href> 还是 JS 按钮）。

  return {
    status: 'needs-verification',
    assignments: [],
    message:
      '批改网页面解析器待验证：尚未取得已登录作业页的真实结构，未更新作业数据。请在批改网作业页运行“页面诊断”并回传摘要。',
  };
}

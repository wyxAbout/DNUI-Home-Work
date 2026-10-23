// 学习通邮箱（i.chaoxing.com 消息中心收件箱）任务解析器 —— 占位实现（取证前）。
//
// 接入背景：用户确认入口为 i.chaoxing.com，目标界面是“消息中心收件箱”。
// 需求是：仿手动点击进入收件箱后，查看是否还有“需要做的任务”，并把这类任务纳入看板。
//
// 当前为占位实现，与东软/iTEST/批改网早期占位行为一致：
//   - 仅处理 i.chaoxing.com 域（非该域直接跳过，platforms.ts 已按 host 过滤，此处双保险）；
//   - 登录态判定与真实解析均留 TODO；
//   - 返回 needs-verification 且不覆盖上次成功缓存（后台不会清空已有作业）。
//
// 落地约束（同其它平台，不猜测）：
//   - 不得猜 API 路径、字段名或“待办/未提交”状态文案；
//   - 等待用户在已登录的 i.chaoxing.com 消息中心收件箱运行去敏诊断（diagnose.ts），
//     把 hostname / mainText / requests / tree / tabs 贴回后，再据此实现真实解析，
//     并补 chaoxing.test.ts（复用项目既有纯函数与 slugifyCourse）。
//
// 规划中的真实解析纯函数签名（取证后再实现，当前不调用）：
//   parseChaoxingInboxText(text): 从收件箱可见文本提取待办/任务型消息；
//   classifyChaoxingTask(text):   判定某条消息是否“还需要做”（未读/待办/含作业或任务通知等）；
//   mapChaoxingAssignments(items, ctx): 映射为 Assignment（source='home'，按消息类别分组）。

import type { PlatformExtractionResult } from './models';

interface ChaoxingExtractOptions {
  // 语义同 neusoft.ts / itest.ts / pigai.ts：
  // - 页面自动上报（document_idle）：false；
  // - 用户在看板点“刷新当前平台”（SYNC_ACTIVE_PAGE）：true（放宽渲染等待时长，落地后可主动点击进入收件箱）。
  allowAutoOpen: boolean;
}

export async function extractChaoxingAssignments(
  _doc: Document,
  url: string,
  _options: ChaoxingExtractOptions,
): Promise<PlatformExtractionResult | null> {
  let hostname = '';
  try {
    hostname = new URL(url).hostname;
  } catch {
    hostname = '';
  }

  // 仅处理 i.chaoxing.com 域；非该域直接跳过（双保险）。
  if (hostname && !hostname.endsWith('i.chaoxing.com')) {
    return null;
  }

  // 占位阶段：尚未取证消息中心收件箱真实结构，返回 needs-verification 且不更新缓存，
  // 避免把未知页面误判为“无任务”或“有任务”。
  return {
    status: 'needs-verification',
    assignments: [],
    message: '学习通邮箱解析器待验证：尚未取证消息中心收件箱结构，未更新作业数据。',
  };
}

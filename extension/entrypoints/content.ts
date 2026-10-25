import { getPlatformAdapter } from '@/src/platforms';
import { BUILD_ID } from '@/src/build';
import { getAllAssignments, isAssignmentExpired, type PlatformExtractionResult } from '@/src/models';
import { SelectorError, SELECTORS_VERSION } from '@/src/selectors';
import { loadHideExpired, loadHomeworkStore } from '@/src/storage';

// 防重复注入：popup 在检测到旧版脚本后会补注入本文件，
// 同一页面里重复执行 main() 会导致重复上报/重复监听，这里只允许初始化一次。
const INJECT_FLAG = '__hwContentReady__';

// 页面内右下角浮层：作为 Windows 通知在「正在使用的应用」前不弹横幅时的兜底。
// 直接注入到页面 DOM，100% 可见，不受 Windows 通知规则限制；
// 数量口径与看板「未完成 N 项」完全一致（跟随「自动隐藏已过期项」开关）。
// 仅在顶层框架注入，避免学习通收件箱等 iframe 里重复浮层。
const BADGE_ID = 'hw-dashboard-badge';
const BADGE_STYLE_ID = 'hw-dashboard-badge-style';

function ensureBadgeStyle(): void {
  if (document.getElementById(BADGE_STYLE_ID)) {
    return;
  }
  const style = document.createElement('style');
  style.id = BADGE_STYLE_ID;
  style.textContent = `
#${BADGE_ID} {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
  max-width: 320px; padding: 12px 16px; border-radius: 10px;
  background: rgba(17, 24, 39, 0.92); color: #fff; cursor: pointer;
  font: 13px/1.5 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
  animation: hw-badge-pop 0.25s ease-out;
}
#${BADGE_ID} .hw-title { opacity: 0.7; font-size: 12px; }
#${BADGE_ID} .hw-count { font-size: 16px; font-weight: 700; margin: 2px 0; }
#${BADGE_ID} .hw-sub { opacity: 0.8; font-size: 12px; }
#${BADGE_ID} .hw-close {
  position: absolute; top: 4px; right: 8px; cursor: pointer;
  opacity: 0.6; font-size: 15px; line-height: 1;
}
#${BADGE_ID} .hw-close:hover { opacity: 1; }
@keyframes hw-badge-pop {
  from { transform: translateY(8px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
`;
  document.documentElement.appendChild(style);
}

// 点击浮层打开看板弹窗（需用户手势，点击事件天然满足）。
// 不支持 openPopup 的环境（如 Firefox/旧内核）静默忽略，不影响浮层本身。
function openDashboardFromBadge(): void {
  try {
    void browser.action.openPopup();
  } catch {
    // 当前环境不支持 action.openPopup，忽略。
  }
}

async function renderHomeworkBadge(): Promise<void> {
  if (window.top !== window) {
    // 子框架（iframe）不注入，避免与顶层框架的浮层重复。
    return;
  }
  ensureBadgeStyle();

  const store = await loadHomeworkStore();
  const hideExpired = await loadHideExpired();
  const assignments = getAllAssignments(store);
  const total = assignments.length;
  const visible = hideExpired
    ? assignments.filter((a) => !isAssignmentExpired(a.dueAt)).length
    : total;

  const existing = document.getElementById(BADGE_ID);
  if (visible === 0) {
    // 没有可见的未完成任务：移除浮层，避免空浮层。
    existing?.remove();
    return;
  }

  const hidden = total - visible;
  const sub = hidden > 0 ? `另有 ${hidden} 项已过期被隐藏` : '';
  const html =
    `<div class="hw-title">作业整合看板</div>` +
    `<div class="hw-count">未完成 ${visible} 项</div>` +
    (sub ? `<div class="hw-sub">${sub}</div>` : '') +
    `<span class="hw-close" id="${BADGE_ID}-close" title="关闭">×</span>`;

  let badge = existing as HTMLDivElement | null;
  const isNew = !badge;
  if (!badge) {
    badge = document.createElement('div');
    badge.id = BADGE_ID;
    document.documentElement.appendChild(badge);
  }
  badge.innerHTML = html;
  // 仅在新创建时绑定一次容器点击：点击浮层（除关闭按钮外）直接打开看板弹窗。
  if (isNew) {
    badge.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      // 关闭按钮有自己的处理逻辑，不触发打开看板。
      if (target.classList.contains('hw-close')) {
        return;
      }
      openDashboardFromBadge();
    });
  }
  document
    .getElementById(`${BADGE_ID}-close`)
    ?.addEventListener('click', () => document.getElementById(BADGE_ID)?.remove());
}

// 应答 popup 的版本探测：正在运行的是哪一次构建的脚本。
interface PingResponse {
  ok: true;
  buildId: string;
  platformId: string | null;
}

export default defineContentScript({
  matches: [
    'https://study.neusoft.edu.cn/*',
    'https://*.pigai.org/*',
    'https://sso.unipus.cn/*',
    'https://itestcloud.unipus.cn/*',
    'https://*.unipus.cn/*',
    'https://i.chaoxing.com/*',
    'https://notice.chaoxing.com/*',
  ],
  // 关键：学习通收件箱渲染在 i.chaoxing.com 页面内嵌的 notice.chaoxing.com iframe 中，
  // 顶层主框架读不到跨域 iframe 的内容（chaoxing.ts 对 i.chaoxing.com 顶层直接 return null）。
  // 必须让 content script 也注入子框架，才能在 notice.chaoxing.com/myNotice 上下文里解析列表。
  // 其它平台的非列表 iframe 经 getPlatformAdapter 按 host 过滤后会 return null，不受影响。
  allFrames: true,
  runAt: 'document_idle',
  main() {
    const state = globalThis as unknown as Record<string, unknown>;
    if (state[INJECT_FLAG]) {
      return;
    }
    state[INJECT_FLAG] = BUILD_ID;

    const adapter = getPlatformAdapter(window.location.href);

    if (!adapter) {
      return;
    }

    // allowAutoOpen：页面自动上报时不允许主动点标签（避免打断用户）；
    // 用户在看板点“刷新当前平台”时允许（可自动打开“作业”标签取数）。
    const reportPage = async (allowAutoOpen: boolean) => {
      let result: PlatformExtractionResult | null;
      try {
        result = await adapter.extract(document, window.location.href, { allowAutoOpen });
      } catch (err) {
        // 解析器抛出 SelectorError（关键选择器缺失）或意外错误：转为显式状态，
        // 让看板与日志可见，而不是静默跳过（反馈 2.3：失效时明确报错别静默跳过）。
        const message =
          err instanceof SelectorError
            ? `${err.message}（selectorsVersion=${SELECTORS_VERSION}）`
            : `解析异常：${err instanceof Error ? err.message : String(err)}`;
        result = {
          status: err instanceof SelectorError ? 'needs-verification' : 'error',
          assignments: [],
          message,
        };
      }

      // null = 当前页面与作业无关，静默跳过，不更新缓存。
      if (!result) {
        return;
      }

      void browser.runtime.sendMessage({
        type: 'PLATFORM_PAGE_READY',
        platformId: adapter.id,
        url: window.location.href,
        status: result.status,
        assignments: result.assignments,
        courseId: result.courseId,
        courseName: result.courseName,
        courseIds: result.courseIds,
        replaceAll: result.replaceAll,
        message: result.message,
        buildId: BUILD_ID,
      });
    };

    void reportPage(false);

    // 页面内右下角浮层：打开页面即显示未完成数量（不受 Windows 通知规则限制，100% 可见）。
    // 仅在顶层框架渲染（renderHomeworkBadge 内部已做 window.top 守卫）。
    void renderHomeworkBadge();

    // 作业数据或「自动隐藏已过期项」开关变化时实时刷新浮层，
    // 跟随看板开关与同步结果，无需重新加载页面。
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') {
        return;
      }
      if (changes['homework-store'] || changes['hide-expired']) {
        void renderHomeworkBadge();
      }
    });

    // 触发一次同步，并把请求转发到所有子框架。
    // 原因：background 的 tabs.sendMessage 默认只送达顶层 frame，
    // 而学习通收件箱解析发生在 notice.chaoxing.com 这个跨域 iframe 里，
    // 必须把同步请求转发过去才能覆盖它（无需新增 webNavigation 权限）。
    const triggerSync = () => {
      void reportPage(true);
      for (const frame of Array.from(window.frames)) {
        try {
          frame.postMessage({ __hwRelay: 'SYNC_ACTIVE_PAGE' }, '*');
        } catch {
          // 跨域 frame 无法 postMessage 时忽略（其 content script 会在自身加载时自动上报）。
        }
      }
    };

    // 接收来自顶层 frame 转发的同步请求（iframe 自身不会被 tabs.sendMessage 命中）。
    window.addEventListener('message', (e: MessageEvent) => {
      if (e.data && (e.data as { __hwRelay?: string }).__hwRelay === 'SYNC_ACTIVE_PAGE') {
        void reportPage(true);
      }
    });

    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      // 版本探测：popup 用它确认本页脚本是否为最新构建。
      if (message?.type === 'HW_PING') {
        const response: PingResponse = { ok: true, buildId: BUILD_ID, platformId: adapter.id };
        sendResponse(response);
        return;
      }

      if (message?.type === 'SYNC_ACTIVE_PAGE') {
        sendResponse({ ok: true, buildId: BUILD_ID });
        triggerSync();
      }
    });
  },
});

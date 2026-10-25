import {
  getAllAssignments,
  isAssignmentExpired,
  mergeAssignmentsByCourse,
  PLATFORM_HOSTS,
  PLATFORM_LABELS,
  type HomeworkStore,
  type PlatformId,
  type PlatformSnapshot,
} from '@/src/models';
import { loadHideExpired, loadHomeworkStore, loadStartupNotifyEnabled, updatePlatformSnapshot } from '@/src/storage';
import { appendLog } from '@/src/log';

interface PlatformPageReadyMessage {
  type: 'PLATFORM_PAGE_READY';
  platformId: PlatformId;
  url: string;
  status: 'success' | 'login-required' | 'needs-verification' | 'error';
  assignments?: HomeworkStore['platforms'][PlatformId]['assignments'];
  courseId?: string;
  courseName?: string;
  courseIds?: string[];
  replaceAll?: boolean;
  message: string;
  // 发送方 content script 的构建标识（用于排查“旧脚本仍在应答”类问题）。
  buildId?: string;
}

const NOTIFICATION_ID = 'homework-summary';
// 「重开浏览器强制播报」用的 ID 前缀：每次带时间戳，保证 Windows 当成全新通知、必弹横幅。
// 平时同步刷新仍用固定 NOTIFICATION_ID（原地更新、不弹新横幅）。
const FORCE_NOTIFICATION_PREFIX = 'homework-summary-force-';
// 上一条强制通知的 ID 缓存：真实值持久化在 storage.local（见 load/saveLastForceNotificationId）。
// 必须持久化——MV3 后台 service worker 闲置会被回收，内存值丢失后无法清掉上一条强制横幅，会堆积在通知中心。
let lastForceNotificationId: string | null = null;
const LAST_NOTIFIED_AT_KEY = 'last-notified-at';
const LAST_FORCE_NOTIFICATION_ID_KEY = 'last-force-notification-id';

// 「打开浏览器」兜底播报的最小间隔（毫秒）。
// 只用于防抖：开机时 onStartup 与第一个窗口的 onCreated 几乎同时到达，
// 避免同一时刻触发两次；正常的「关掉再开」间隔远大于此值，每次都会弹。
// 注意：这条防抖并不可靠——onCreated 路径只需 3 步异步就读到时间戳，而 onStartup
// 路径要 6 步之后才写入，读的永远先于写完成，所以防抖挡不住这两条并发触发。
// 真正去重靠下面的 openNotifyLatch 内存闩锁（两路径共用 maybeNotifyOnBrowserOpen）。
const WINDOW_NOTIFY_DEBOUNCE_MS = 10_000;

// 「本次打开浏览器已播报」内存闩锁：onStartup 与 windows.onCreated 在开机时几乎同时触发，
// 两者都会进入 maybeNotifyOnBrowserOpen；不闩住就会各自弹一条（双轨唯一 ID 后不再被同 ID
// 替换掩盖，于是显现为「双横幅」）。JS 单线程下同步置位，先到者执行、后到者直接跳过。
// 复位时机：所有普通窗口关闭时（见 onRemoved 监听），保证下一轮「关掉再开」仍会播报。
// SW 被回收时闩锁随之消失（等价于复位），fail-open，不会永久静音。
let openNotifyLatch = false;

async function loadLastNotifiedAt(): Promise<number | null> {
  try {
    const result = await browser.storage.local.get(LAST_NOTIFIED_AT_KEY);
    const value = result[LAST_NOTIFIED_AT_KEY];
    return typeof value === 'number' ? value : null;
  } catch {
    return null;
  }
}

async function saveLastNotifiedAt(value: number): Promise<void> {
  try {
    await browser.storage.local.set({ [LAST_NOTIFIED_AT_KEY]: value });
  } catch {
    // 存不上只影响防抖精度，不影响功能。
    // 注意：平时同步刷新创建通知时也会刷新此时间戳；但 maybeNotifyOnBrowserOpen 里有
    // normalCount===1 的判定，防抖实际只对「重开浏览器」生效，不会被平时刷新误触发。
  }
}

// 判断某 host 是否属于任一已接入平台（含子域）。
function hostMatchesPlatform(host: string): boolean {
  return (Object.values(PLATFORM_HOSTS) as string[][]).some((hosts) =>
    hosts.some((h) => host === h || host.endsWith(`.${h}`)),
  );
}

// 浏览器启动时，对后台已打开的平台标签页主动触发一次同步。
// 受限于扩展读不到未打开页面的 DOM，此机制只覆盖「已打开」的标签；
// 从未打开过的平台仍需用户访问一次（见 README「已知限制」）。
async function resyncOpenPlatformTabs(): Promise<void> {
  // 本地结构化类型：仅取本函数用到的字段，避免依赖浏览器全局 Tab 类型
  // （该工程内 browser.tabs.query 的返回类型未被正确推断为 Tab[]）。
  type TabsQueryResult = Array<{ id?: number; url?: string; pendingUrl?: string }>;
  let tabs: TabsQueryResult = [];
  try {
    tabs = (await browser.tabs.query({})) as unknown as TabsQueryResult;
  } catch {
    return;
  }
  let triggered = 0;
  for (const tab of tabs) {
    const url = tab.url ?? tab.pendingUrl;
    if (!url) {
      continue;
    }
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      continue;
    }
    if (!hostMatchesPlatform(host) || tab.id == null) {
      continue;
    }
    try {
      await browser.tabs.sendMessage(tab.id, { type: 'SYNC_ACTIVE_PAGE' });
      triggered += 1;
    } catch {
      // 该标签尚未注入 content script（如刚恢复、尚未加载完成），跳过。
    }
  }
  if (triggered > 0) {
    void appendLog('info', 'sync', `浏览器启动：已对 ${triggered} 个已打开平台标签页触发同步`);
  }
}

// 与看板「未完成 N 项」完全同口径的计数：
// 1) 只统计缓存中的未提交作业（getAllAssignments）；
// 2) 若用户开启了「自动隐藏已过期项」，剔除 dueAt 已过期的条目（与弹窗 visibleCount 一致）。
// 返回可见数与被隐藏数，供通知文案区分「真没有」和「被隐藏了」。
async function summarizeVisibleAssignments(): Promise<{
  visible: number;
  hidden: number;
  hasData: boolean;
}> {
  const store = await loadHomeworkStore();
  const assignments = getAllAssignments(store);

  if (assignments.length === 0) {
    return { visible: 0, hidden: 0, hasData: false };
  }

  const hideExpired = await loadHideExpired();
  const visible = hideExpired
    ? assignments.filter((a) => !isAssignmentExpired(a.dueAt)).length
    : assignments.length;

  return { visible, hidden: assignments.length - visible, hasData: true };
}

const NOTIFIED_VISIBLE_KEY = 'notified-visible-count';

// 上一次通知展示的未完成数：用于在同步后判断数量是否真的变了。
// 数量没变就不重复弹/刷新通知，避免用户每访问一次平台页就被打扰一次。
// 存 storage 而非内存变量：MV3 后台脚本闲置会被回收，内存值会丢，
// 回收后若用内存值判断，一次同步就会对未变化的数量重复弹通知。
async function loadNotifiedVisible(): Promise<number | null> {
  try {
    const result = await browser.storage.local.get(NOTIFIED_VISIBLE_KEY);
    const value = result[NOTIFIED_VISIBLE_KEY];
    return typeof value === 'number' ? value : null;
  } catch {
    return null;
  }
}

async function saveNotifiedVisible(value: number | null): Promise<void> {
  try {
    if (value === null) {
      await browser.storage.local.remove(NOTIFIED_VISIBLE_KEY);
    } else {
      await browser.storage.local.set({ [NOTIFIED_VISIBLE_KEY]: value });
    }
  } catch {
    // 存不上只影响「少弹几次」的节流，不影响功能正确性。
  }
}

// 上一条强制通知的 ID：持久化在 storage.local，跨后台 service worker 回收不丢失，
// 使下次强制播报时能清掉上一条，避免通知中心堆积多条历史横幅。
async function loadLastForceNotificationId(): Promise<string | null> {
  try {
    const result = await browser.storage.local.get(LAST_FORCE_NOTIFICATION_ID_KEY);
    const value = result[LAST_FORCE_NOTIFICATION_ID_KEY];
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

async function saveLastForceNotificationId(value: string | null): Promise<void> {
  try {
    if (value === null) {
      await browser.storage.local.remove(LAST_FORCE_NOTIFICATION_ID_KEY);
    } else {
      await browser.storage.local.set({ [LAST_FORCE_NOTIFICATION_ID_KEY]: value });
    }
  } catch {
    // 存不上只影响「清掉上一条强制横幅」，最坏多留一条旧横幅，不影响功能。
  }
}

// 弹出/刷新右下角汇总通知。visible=0 时不再打扰，并清掉可能残留的旧通知（含上一条强制横幅）。
// 双轨 ID 策略（解决 Windows 通知合并导致「只弹一次横幅」的问题）：
//   - force=false（平时同步刷新 / 开关切换）：用固定 NOTIFICATION_ID，create 会替换旧通知，
//     即「原地更新」而非叠加，不会重新弹横幅（满足「平时不弹」）。
//   - force=true（重开 / 开机强制播报）：用带时间戳的唯一 ID，让 Windows 当成全新通知，
//     每次都重新弹横幅。Windows 对「同发送者+同 Tag」会合并成更新、不弹横幅，这是根因。
// force=true 还用于绕过节流：Chrome 通知不跨重启残留，但 storage 里记着上次数字，
// 若仍按节流判断，数量不变时就永远不弹了。所以开机务必强制播报一次。
async function refreshSummaryNotification(force = false): Promise<void> {
  let summary: Awaited<ReturnType<typeof summarizeVisibleAssignments>>;
  try {
    summary = await summarizeVisibleAssignments();
  } catch {
    // 读缓存失败（如 storage 不可用）：通知属于辅助功能，静默跳过即可。
    return;
  }

  if (!summary.hasData || summary.visible === 0) {
    await saveNotifiedVisible(summary.hasData ? 0 : null);
    try {
      await browser.notifications.clear(NOTIFICATION_ID);
    } catch {
      // 通知本来就不存在或权限被收回，忽略。
    }
    // 也要清掉上一条强制横幅（带时间戳的唯一 ID）：否则 visible 归零后，旧的
    // 「你有 N 项未完成」横幅仍残留在通知中心。
    const forceId = await loadLastForceNotificationId();
    if (forceId) {
      await browser.notifications.clear(forceId).catch(() => {});
      await saveLastForceNotificationId(null);
      lastForceNotificationId = null;
    }
    return;
  }

  const notified = await loadNotifiedVisible();
  // 非强制且数量未变：视为同一状态，跳过，避免会话内重复打扰。
  if (!force && notified === summary.visible) {
    return;
  }
  await saveNotifiedVisible(summary.visible);

  // 与看板一致：隐藏项不计入主数字，但明确提示「还有 N 项被隐藏」，
  // 避免用户以为全部完成，实际是过期项被开关隐藏了。
  const hiddenNote =
    summary.hidden > 0 ? `另有 ${summary.hidden} 项已过截止时间被自动隐藏。` : '';

  try {
    // 统一先清掉固定通知（平时原地更新 / 重开清残留），避免两条 ID 的通知同时存在于通知中心。
    await browser.notifications.clear(NOTIFICATION_ID).catch(() => {});

    // 选择本次通知 ID：
    //   - 平时（force=false）：固定 NOTIFICATION_ID，原地更新、不弹新横幅。
    //   - 重开/开机（force=true）：每次用带时间戳的唯一 ID，逼 Windows 当成全新通知必弹横幅；
    //     同时清掉上一条强制横幅（ID 持久化在 storage，跨后台回收不丢失），避免通知中心堆积。
    let idToUse: string;
    if (force) {
      idToUse = `${FORCE_NOTIFICATION_PREFIX}${Date.now()}`;
      const prevForceId = lastForceNotificationId ?? (await loadLastForceNotificationId());
      if (prevForceId) {
        await browser.notifications.clear(prevForceId).catch(() => {});
      }
      lastForceNotificationId = idToUse;
      await saveLastForceNotificationId(idToUse);
    } else {
      idToUse = NOTIFICATION_ID;
    }

    await browser.notifications.create(idToUse, {
      type: 'basic',
      iconUrl: browser.runtime.getURL('/icon/128.png'),
      title: '作业整合看板',
      message: `当前有 ${summary.visible} 项未完成作业。${hiddenNote}数据来自最近一次平台访问。`,
      // 常驻显示：默认横幅约 5 秒自动消失，容易被忽略；
      // requireInteraction 让通知留在屏幕上，直到用户点击或手动关闭。
      requireInteraction: true,
    });
    await saveLastNotifiedAt(Date.now());
    void appendLog('info', 'sync', `已生成汇总通知：未完成 ${summary.visible} 项${hiddenNote ? '（含被隐藏项）' : ''}`);
  } catch {
    // 用户在系统/浏览器层面关闭了通知权限：不该让启动流程因此报错。
    void appendLog('warn', 'sync', '汇总通知创建失败：可能被系统或浏览器通知权限拦截');
  }
}

// 工具栏图标数字角标：常驻 Edge 工具栏，在新建标签页（edge://newtab）、
// 任意网页都可见——这是 content script 无法注入 edge:// 页面时的兜底"浮层"。
// 点图标即打开看板弹窗（浏览器原生行为），天然满足"打开 Edge 就能看到数量、点了出看板"。
// 数量口径与看板、通知完全一致（跟随「自动隐藏已过期项」开关）。
async function refreshActionBadge(): Promise<void> {
  let summary: Awaited<ReturnType<typeof summarizeVisibleAssignments>>;
  try {
    summary = await summarizeVisibleAssignments();
  } catch {
    // 读缓存失败：角标是辅助展示，静默跳过。
    return;
  }
  try {
    if (!summary.hasData || summary.visible === 0) {
      await browser.action.setBadgeText({ text: '' });
    } else {
      // 红底白字，与"未完成任务"语义一致（中国股市习惯：红=警示/未完成）。
      await browser.action.setBadgeBackgroundColor({ color: '#e11d48' });
      await browser.action.setBadgeText({ text: String(summary.visible) });
    }
  } catch {
    // 个别环境无 action API，静默忽略。
  }
}

// 「打开浏览器」兜底：Edge 的「启动增强」会让浏览器关窗后驻留后台，
// 重开窗口不算冷启动，runtime.onStartup 永远不触发。
// 因此监听第一个普通窗口的创建：当此刻仅存在这一个普通窗口
// （说明此前所有窗口都已关闭，用户是"重新打开浏览器"），就强制播报一次。
async function maybeNotifyOnBrowserOpen(): Promise<void> {
  try {
    // 闩锁去重：onStartup 与首个窗口的 onCreated 几乎同时到达，只允许先到者播报一次。
    if (openNotifyLatch) {
      return;
    }
    openNotifyLatch = true;
    // 用户关闭了「重新打开浏览器时强制播报」：直接跳过，不弹开机通知。
    if (!(await loadStartupNotifyEnabled())) {
      return;
    }
    const all = await browser.windows.getAll({});
    const normalCount = all.filter((w) => w.type === 'normal').length;
    // 还有别的普通窗口开着 => 浏览器本来就在用，不是"打开浏览器"。
    if (normalCount > 1) {
      return;
    }
    const last = await loadLastNotifiedAt();
    if (last !== null && Date.now() - last < WINDOW_NOTIFY_DEBOUNCE_MS) {
      return;
    }
    await refreshSummaryNotification(true);
    await refreshActionBadge();
  } catch {
    // 窗口枚举失败（罕见）：静默跳过，不影响主流程。
  }
}

export default defineBackground(() => {
  browser.runtime.onStartup.addListener(() => {
    // 先对已打开的平台标签页触发一次同步。
    void resyncOpenPlatformTabs();
    // 开机播报与 windows.onCreated 兜底共用 maybeNotifyOnBrowserOpen（内部有闩锁去重），
    // 避免两条路径各自弹一条、出现双横幅。
    void maybeNotifyOnBrowserOpen();
    // 角标无论是否播报都要刷新（开关/闩锁跳过播报时，角标仍需保持准确）。
    void refreshActionBadge();
  });

  // 「启动增强」兜底：见 maybeNotifyOnBrowserOpen 注释。
  // 只要关掉全部窗口后重新打开（无论 Edge 进程是否驻留后台），都会播报一次。
  browser.windows.onCreated.addListener((win) => {
    // 只关心普通浏览器窗口；popup / devtools 等不触发。
    if (win.type !== 'normal') {
      return;
    }
    void maybeNotifyOnBrowserOpen();
  });

  // 闩锁复位：所有普通窗口都关闭后，下一次打开浏览器视为新一轮，允许再次播报。
  browser.windows.onRemoved.addListener(async () => {
    try {
      const all = await browser.windows.getAll({});
      if (!all.some((w) => w.type === 'normal')) {
        openNotifyLatch = false;
      }
    } catch {
      // 枚举失败忽略：闩锁保持，最坏是下一轮不弹；SW 回收后闩锁仍会复位。
    }
  });

  // 实时跟随看板偏好：用户在弹窗里切换「自动隐藏已过期项」时，
  // 立即按新口径重算并刷新右下角通知，不必等下一次平台同步。
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') {
      return;
    }
    // 「自动隐藏已过期项」开关，或作业数据本身变化（如弹窗里手动操作）：
    // 同步刷新右下角通知与工具栏角标，使其立即跟随看板口径。
    if ('hide-expired' in changes || 'homework-store' in changes) {
      void refreshSummaryNotification();
      void refreshActionBadge();
    }
  });

  // 点击右下角通知直接打开看板弹窗，方便确认通知确实弹出了、也能快速查看待办。
  // 用前缀匹配：同时覆盖固定 ID（平时）与带时间戳的强制 ID（重开），二者都以 homework-summary 开头。
  browser.notifications.onClicked.addListener((notificationId) => {
    if (!notificationId.startsWith('homework-summary')) {
      return;
    }
    try {
      void browser.action.openPopup();
      void appendLog('info', 'sync', '用户点击了汇总通知，已打开看板弹窗');
    } catch {
      // 个别环境（如 Firefox 或旧内核）不支持 openPopup，静默忽略，不影响通知本身。
      void appendLog('warn', 'sync', '点击通知打开弹窗失败：当前浏览器不支持 action.openPopup');
    }
  });

  // 通知生命周期日志：用于在无视 Windows 显示行为的前提下，确认通知是否被系统创建/关闭。
  // 即使 Windows 把通知收进了操作中心（用户没注意到），这里也能证明它「确实生成过」。
  browser.notifications.onClosed.addListener((notificationId, byUser) => {
    if (!notificationId.startsWith('homework-summary')) {
      return;
    }
    void appendLog('info', 'sync', `汇总通知已关闭（${byUser ? '用户手动关闭' : '系统自动收起'}）`);
  });

  browser.runtime.onMessage.addListener(async (message: PlatformPageReadyMessage) => {
    if (message?.type !== 'PLATFORM_PAGE_READY') {
      return;
    }

    // 计算本次更新：成功同步按课程合并缓存，支持同一平台下多门课程作业汇总（而非整平台覆盖）。
    let update: Partial<PlatformSnapshot>;
    if (message.status === 'success') {
      const current = await loadHomeworkStore();
      const existing = current.platforms[message.platformId].assignments;
      // 合并范围：优先用显式 courseIds（首页跨多门 / 课程页单门，即使本次为空也能清空旧作业）；
      // 否则退回按 incoming 自身课程集合。
      const scope =
        message.courseIds && message.courseIds.length > 0
          ? message.courseIds
          : message.courseId
            ? [message.courseId]
            : [];
      // replaceAll：本次结果对该平台整体有效（如首页空态），整组替换；否则按课程合并。
      const merged = message.replaceAll
        ? (message.assignments ?? [])
        : mergeAssignmentsByCourse(existing, message.assignments ?? [], scope);
      update = {
        status: message.status,
        lastVisitedUrl: message.url,
        message: message.message,
        assignments: merged,
        lastSyncedAt: new Date().toISOString(),
      };
    } else {
      update = {
        status: message.status,
        lastVisitedUrl: message.url,
        message: message.message,
      };
    }

    const label = PLATFORM_LABELS[message.platformId];
    if (message.status === 'success') {
      void appendLog(
        'info',
        'sync',
        `${label} 同步成功：${message.assignments?.length ?? 0} 项未提交作业`,
      );
    } else if (message.status === 'needs-verification') {
      // 带上解析器的具体原因（例如“解析 1 项，与待完成 2 不一致”），
      // 否则日志里只有“待验证”，无法判断是结构变了还是没渲染完。
      void appendLog(
        'warn',
        'sync',
        `${label} 待验证：${message.message || '解析结果与页面汇总不一致'}`,
      );
    } else if (message.status === 'login-required') {
      void appendLog('warn', 'sync', `${label} 需要登录，未更新作业数据`);
    } else if (message.status === 'error') {
      void appendLog('error', 'sync', `${label} 同步失败：${message.message ?? '未知错误'}`);
    }

    void updatePlatformSnapshot(message.platformId, update);

    // 同步落库后让右下角通知与工具栏角标跟随看板数量刷新（数量没变则内部不会重复弹）。
    void refreshSummaryNotification();
    void refreshActionBadge();
  });
});

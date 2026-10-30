import {
  getAllAssignments,
  isAssignmentVisible,
  mergeAssignmentsByCourse,
  PLATFORM_HOSTS,
  PLATFORM_LABELS,
  type ChaoxingCourse,
  type HomeworkStore,
  type PlatformId,
  type PlatformSnapshot,
} from '@/src/models';
import {
  loadChaoxingCourses,
  loadHideExpired,
  loadHomeworkStore,
  loadStartupNotifyEnabled,
  loadChaoxingTaskUrls,
  saveChaoxingCourses,
  saveChaoxingCrawlState,
  saveChaoxingTaskUrls,
  updatePlatformSnapshot,
} from '@/src/storage';
import {
  chaoxingCrawlPageKindOf,
  chaoxingCrawlPageLabel,
  crawlCourseKeysOfReport,
  crawlUrlMemoryKey,
  createFinishedCrawlState,
  createRunningCrawlState,
  orderCrawlCandidateUrls,
  planChaoxingCrawl,
  rememberCourseTaskUrl,
  summarizeChaoxingCrawl,
  withChaoxingPageAdvice,
  CHAOXING_CRAWL_TIMEOUT_MS,
  type ChaoxingCrawlOutcome,
  type ChaoxingCrawlPage,
  type ChaoxingCrawlPageKind,
  type ChaoxingCrawlPageResult,
  type ChaoxingCrawlReport,
  type ChaoxingCrawlTarget,
} from '@/src/chaoxing-crawl';
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
  // 课程注册表（目前仅学习通「我的课程」页产出，阶段 A）。
  courses?: ChaoxingCourse[];
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
// 2) 用 isAssignmentVisible 过滤：排除默认隐藏的 completed/ended，并（开启开关时）排除已过期条目
//    —— dueAt 已过 或 平台已明确标记 status='expired' 的都算已过期（与弹窗 visibleCount 一致）。
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
  const visible = assignments.filter((a) => isAssignmentVisible(a, { hideExpired })).length;

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
  // 隐藏项可能是“已完成/已结束”（默认隐藏）或“已过期”（开关隐藏），故用中性措辞。
  const hiddenNote =
    summary.hidden > 0 ? `另有 ${summary.hidden} 项已完成或已过期。` : '';

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

  // 页面上报的处理主体（由下面的同步分发器调用）。
  // 历史坑：这里原本直接写成 `onMessage.addListener(async (message) => {…})`。
  // 在 Chrome 里，async 监听器返回的 Promise 会被当成“本条消息的应答”（值为 undefined），
  // 且一条消息只能有一个应答者 —— 于是同一扩展里的逐课同步请求永远拿不到响应通道，
  // 弹窗只能显示“逐课同步未返回结果”。现在改成：单条同步分发器 + 只有该处理的类型才处理。
  async function handlePlatformPageReady(message: PlatformPageReadyMessage): Promise<void> {

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
      // 学习通一门课分两页上报（任务列表 / 作业·考试列表），两者课程作用域相同、
      // 覆盖的条目不同。必须把页面种类传进合并逻辑，否则先到的任务页会把
      // 后到的作业页刚写入的条目整批清掉（表现为“同步成功但没有作业”）。
      const pageKind = message.platformId === 'chaoxing' ? chaoxingCrawlPageKindOf(message.url) : null;
      const merged = message.replaceAll
        ? (message.assignments ?? [])
        : mergeAssignmentsByCourse(
            existing,
            message.assignments ?? [],
            scope,
            pageKind ? { kind: pageKind } : undefined,
          );
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

    // 课程注册表（阶段 A）：整体覆盖写入，与作业缓存解耦——注册表页不产出作业，
    // 作业列表仍按课程页逐课同步；注册表用于回答“一共有几门课 / 哪些课还没同步过”。
    if (message.courses && message.courses.length > 0) {
      await saveChaoxingCourses(message.courses);
      void appendLog(
        'info',
        'sync',
        `${PLATFORM_LABELS[message.platformId]} 课程注册表已更新：${message.courses.length} 门课`,
      );
    }

    void updatePlatformSnapshot(message.platformId, update);

    // 记住这门课「真的成功解析出列表」的那个地址（来自页面自身的 location.href，
    // 因此含 stuenc/enc/t 等会话参数）。下次逐课抓取优先用它，成功率比自拼地址高。
    // 键必须是「页面种类 + 课程」：任务页与作业/考试页是两套会话参数，
    // 共用一个键会互相覆盖，导致每次总有一页退回自拼地址。
    if (
      message.status === 'success' &&
      message.platformId === 'chaoxing' &&
      message.courseIds?.length === 1
    ) {
      const kind = chaoxingCrawlPageKindOf(message.url);
      if (kind) {
        const courseKey = message.courseIds[0]!;
        try {
          const memory = await loadChaoxingTaskUrls();
          await saveChaoxingTaskUrls(
            rememberCourseTaskUrl(memory, crawlUrlMemoryKey(kind, courseKey), message.url),
          );
        } catch {
          /* 记忆地址失败不影响同步本身 */
        }
      }
    }

    // 逐课抓取（阶段 B）在等这门课的上报：落库后唤醒等待者，
    // 抓取流程据此关闭临时后台标签、继续下一门课。
    settleCrawlWaiter(message);

    // 同步落库后让右下角通知与工具栏角标跟随看板数量刷新（数量没变则内部不会重复弹）。
    void refreshSummaryNotification();
    void refreshActionBadge();
  }

  // 统一分发器（必须是同步函数，且对“不归它管”的消息返回 undefined）：
  // 返回 Promise 就等于抢答，会把其它类型的消息应答通道占掉。
  browser.runtime.onMessage.addListener((message: { type?: string } | undefined) => {
    if (message?.type === 'CRAWL_CHAOXING_COURSES') {
      // 逐课同步整批要跑几十秒：结果写进 storage 状态存档，弹窗读存档展示，
      // 不依赖消息应答（弹窗中途关掉也不会丢结果）。
      void crawlChaoxingCourses();
      return undefined;
    }
    if (message?.type === 'CHAOXING_URL_HINT') {
      // 页面把「带会话参数的列表页真实地址」送过来，只记不用应答。
      const urls = (message as { urls?: unknown }).urls;
      if (Array.isArray(urls)) {
        void rememberChaoxingUrlHints(urls.filter((u): u is string => typeof u === 'string'));
      }
      return undefined;
    }
    if (message?.type !== 'PLATFORM_PAGE_READY') {
      return undefined;
    }
    void handlePlatformPageReady(message as PlatformPageReadyMessage);
    return undefined;
  });

  // ==================== 阶段 B：基于课程注册表逐课抓取 ====================
  // 为什么由后台做：抓取要连开若干临时标签、跨几十秒，弹窗一关就会中断，
  // 而后台 service worker 不随弹窗关闭而结束（并有下面 keepAlive 兜住回收）。
  // 为什么不 fetch HTML：任务列表是 SPA，原始 HTML 只有骨架；
  // 必须让页面自己渲染，再由该标签里的 content script 上报——这与诊断工具走的是同一条
  // 确定性路径（2026-10-25 已验证可行）。

  // 等待表：key = `页面种类:课程键`（如 `exam:259363438-139380153`）→ 该页的兑现回调。
  // 为什么要带种类：一门课现在要抓两页（任务页 + 作业/考试页），两页上报的
  // courseIds 完全相同（都是 `courseid-clazzid`）。若只按课程键索引，
  // 任务页的上报会把作业页的等待提前兑现 —— 表现为“作业页永远超时/串结果”。
  const crawlWaiters = new Map<
    string,
    (outcome: { ok: boolean; message: string; count?: number }) => void
  >();

  // content script 上报到达后兑现对应页。同一页可能有多条上报（顶层 + iframe），
  // 取第一条即可：后续上报照常合并进缓存。
  function settleCrawlWaiter(message: PlatformPageReadyMessage): void {
    const kind = chaoxingCrawlPageKindOf(message.url);
    // 课程键从 message 与 url 双路取：解析失败的上报只有 url（见 crawlCourseKeysOfReport 注释）。
    const courseKeys = crawlCourseKeysOfReport({
      url: message.url,
      courseId: message.courseId,
      courseIds: message.courseIds,
    });
    const waitKeys = new Set<string>();
    for (const key of courseKeys) {
      if (kind) {
        waitKeys.add(crawlUrlMemoryKey(kind, key));
      }
      // 兼容不带种类的裸键（暂无写入方，留作兜底，避免以后新增入口时莫名超时）。
      waitKeys.add(key);
    }
    for (const key of waitKeys) {
      const settle = crawlWaiters.get(key);
      if (!settle) {
        continue;
      }
      crawlWaiters.delete(key);
      settle({
        ok: message.status === 'success',
        message: message.message,
        count: (message.assignments ?? []).length,
      });
    }
  }

  // 记住页面上采集到的学习通列表**真实地址**（含服务端下发的 enc/cpi 等会话参数）。
  // 为什么必须这么做：作业/考试列表用自拼的 `courseid + clazzid` 打开时，多数登录态下
  // 只会得到一张「提示」弹窗页（正文 0 字、没有列表 DOM），逐课同步的作业页因此永远失败。
  // enc 由服务端下发、前端无法生成，唯一可靠来源就是页面上真实存在的链接
  // —— 用户只要打开过一次该课程的「作业」页，我们就能记住并复用。
  async function rememberChaoxingUrlHints(urls: string[]): Promise<void> {
    const usable: { key: string; url: string }[] = [];
    for (const raw of urls) {
      if (typeof raw !== 'string' || !raw) {
        continue;
      }
      const kind = chaoxingCrawlPageKindOf(raw);
      if (!kind) {
        continue;
      }
      let courseKey = '';
      try {
        const params = new URL(raw).searchParams;
        const cid = (params.get('courseid') || params.get('courseId') || '').trim();
        const lid = (params.get('clazzid') || params.get('classId') || '').trim();
        if (cid && lid) {
          courseKey = `${cid}-${lid}`;
        }
      } catch {
        continue;
      }
      if (!courseKey) {
        continue;
      }
      usable.push({ key: crawlUrlMemoryKey(kind, courseKey), url: raw });
    }
    if (usable.length === 0) {
      return;
    }
    try {
      let memory = await loadChaoxingTaskUrls();
      let changed = false;
      for (const { key, url } of usable) {
        if (memory[key] === url) {
          continue;
        }
        memory = rememberCourseTaskUrl(memory, key, url);
        changed = true;
      }
      if (changed) {
        await saveChaoxingTaskUrls(memory);
        void appendLog(
          'info',
          'sync',
          `学习通：已记住 ${usable.length} 个列表页真实地址（含会话参数），下次逐课同步优先使用`,
        );
      }
    } catch {
      /* 记地址失败不影响同步本身 */
    }
  }

  // 超时后回读一次临时标签：把「这个标签到底打开了什么」写进失败原因。
  // 没有这一步，所有失败都长成同一句话（“超时，可能未登录”）：
  // 用户既不知道该去登录、该重试，还是该手动点一次作业页让扩展记住 enc。
  async function probeCrawlTab(tabId: number): Promise<string> {
    try {
      const [res] = await browser.scripting.executeScript({
        target: { tabId },
        func: () => {
          const text = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
          return {
            title: document.title || '',
            readyState: document.readyState || '',
            hasList: !!document.querySelector('.bottomList'),
            textLength: text.length,
            sample: text.slice(0, 80),
          };
        },
      });
      const info = res?.result as
        | {
            title: string;
            readyState: string;
            hasList: boolean;
            textLength: number;
            sample: string;
          }
        | undefined;
      if (!info) {
        return '';
      }
      if (info.hasList) {
        return `页面已渲染出列表但未上报（标题「${info.title}」）`;
      }
      if (info.textLength === 0 && info.readyState !== 'complete') {
        return `页面仍在加载（${info.readyState}）`;
      }
      if (info.textLength === 0) {
        return `标签页正文为空（标题「${info.title}」），大概率是缺少 enc 的弹窗壳页`;
      }
      return `标签页未渲染出列表（标题「${info.title}」，正文 ${info.textLength} 字：${info.sample}）`;
    } catch {
      // 不可注入（跨域/已跳转/已关闭）：不追加噪音，保留原来的超时说明。
      return '';
    }
  }

  // 抓一门课的**一页**：开后台标签 → 等该页上报（或超时）→ 关标签。
  // 成功与否都要关：临时标签绝不能残留在用户标签栏里。
  async function crawlSinglePage(
    target: ChaoxingCrawlTarget,
    page: ChaoxingCrawlPage,
    url = page.url,
  ): Promise<ChaoxingCrawlPageResult> {
    const waitKey = crawlUrlMemoryKey(page.kind, target.courseKey);
    const tag = `学习通逐课同步「${target.name}」${chaoxingCrawlPageLabel(page.kind)}`;
    let tabId: number | undefined;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    const settled = new Promise<{ ok: boolean; message: string; count?: number }>((resolve) => {
      crawlWaiters.set(waitKey, resolve);
    });
    const TIMEOUT = Symbol('crawl-timeout');
    // 单页结果只描述这一页的成败；课程级汇总（含 pages 明细）在 runChaoxingCrawl 里组装。
    const done = (ok: boolean, message: string, count?: number): ChaoxingCrawlPageResult => ({
      kind: page.kind,
      ok,
      message,
      count,
    });
    try {
      const tab = await browser.tabs.create({ url, active: false });
      tabId = tab.id;
      const outcome = await Promise.race([
        settled,
        new Promise<typeof TIMEOUT>((resolve) => {
          timeoutTimer = setTimeout(() => resolve(TIMEOUT), CHAOXING_CRAWL_TIMEOUT_MS);
        }),
      ]);
      if (outcome === TIMEOUT) {
        const probe = typeof tabId === 'number' ? await probeCrawlTab(tabId) : '';
        const seconds = Math.round(CHAOXING_CRAWL_TIMEOUT_MS / 1000);
        const message = probe
          ? `等待页面上报超时（${seconds}s）：${probe}`
          : `等待页面上报超时（${seconds}s，可能未登录或页面加载过慢）`;
        void appendLog('warn', 'sync', `${tag}：${message}`);
        return done(false, message);
      }
      void appendLog(outcome.ok ? 'info' : 'warn', 'sync', `${tag}：${outcome.message}`);
      // count 只在成功时有意义：失败上报的 assignments 一定是空的，带上会让明细显示“失败 · 0 项”。
      return done(outcome.ok, outcome.message, outcome.ok ? outcome.count : undefined);
    } catch (err) {
      const message = `打开标签页失败：${err instanceof Error ? err.message : String(err)}`;
      void appendLog('error', 'sync', `${tag}：${message}`);
      return done(false, message);
    } finally {
      // 上报先到时超时定时器还在跑：及时清掉，避免它多挂 25s。
      if (typeof timeoutTimer !== 'undefined') {
        clearTimeout(timeoutTimer);
      }
      crawlWaiters.delete(waitKey);
      if (typeof tabId === 'number') {
        await browser.tabs.remove(tabId).catch(() => undefined);
      }
    }
  }

  // 并发保护：两个弹窗/连点会同时开两批标签，且等待表按课程键覆盖，结果会互相串。
  // 直接拒绝后来者，比让它把前一整批的等待表踩乱安全。
  let crawlInFlight = false;

  // 对外入口：只负责“运行态存档”的开销与收尾，具体抓取在 runChaoxingCrawl 里。
  // 结果写进 storage（chaoxing-crawl-state），弹窗读存档展示——不依赖 sendMessage 应答。
  async function crawlChaoxingCourses(): Promise<void> {
    if (crawlInFlight) {
      void appendLog('warn', 'sync', '逐课同步已在进行中，本次请求已忽略');
      return;
    }
    crawlInFlight = true;
    const startedAt = new Date().toISOString();
    await saveChaoxingCrawlState(createRunningCrawlState(startedAt));
    try {
      const report = await runChaoxingCrawl((done, total, succeeded) => {
        // 进度也写进存档：弹窗关掉再打开能看到“3/6 门已完成”，而不是一片空白。
        void saveChaoxingCrawlState({
          ...createRunningCrawlState(startedAt),
          total,
          succeeded,
          failed: done - succeeded,
        });
      });
      await saveChaoxingCrawlState(
        createFinishedCrawlState(report, startedAt, new Date().toISOString()),
      );
    } catch (err) {
      const message = `逐课同步异常：${err instanceof Error ? err.message : String(err)}`;
      void appendLog('error', 'sync', message);
      await saveChaoxingCrawlState({
        running: false,
        startedAt,
        finishedAt: new Date().toISOString(),
        total: 0,
        succeeded: 0,
        failed: 0,
        message,
        items: [],
      });
    } finally {
      crawlInFlight = false;
    }
  }

  async function runChaoxingCrawl(
    onProgress?: (done: number, total: number, succeeded: number) => void,
  ): Promise<ChaoxingCrawlReport> {
    let plan: ChaoxingCrawlTarget[];
    try {
      plan = planChaoxingCrawl(await loadChaoxingCourses());
    } catch (err) {
      const message = `读取课程注册表失败：${err instanceof Error ? err.message : String(err)}`;
      void appendLog('error', 'sync', message);
      return { ok: false, total: 0, succeeded: 0, failed: 0, items: [], message };
    }

    if (plan.length === 0) {
      const message =
        '课程注册表为空：请先打开「我的课程」页停留几秒，让扩展记录每门课的 courseId / clazzId';
      void appendLog('warn', 'sync', `学习通逐课同步跳过：${message}`);
      return { ok: false, total: 0, succeeded: 0, failed: 0, items: [], message };
    }

    void appendLog(
      'info',
      'sync',
      `学习通逐课同步开始：${plan.length} 门课，每门开临时标签读取「任务列表 + 作业/考试列表」`,
    );

    // MV3 后台闲置约 30s 会被回收，而逐课抓取可能持续数分钟：
    // 定时调一次轻量 API 重置闲置计时，避免中途被回收导致后面的课整批漏抓。
    const keepAlive = setInterval(() => {
      void browser.runtime.getPlatformInfo().catch(() => undefined);
    }, 15_000);

    // 每门课优先用「上次真的成功过」的地址（含会话参数），自拼地址作后备。
    const urlMemory = await loadChaoxingTaskUrls().catch(() => ({}) as Record<string, string>);

    const items: ChaoxingCrawlOutcome[] = [];
    try {
      for (const target of plan) {
        // 一门课要抓两页：任务/活动列表 + 作业/考试列表。
        // 只抓任务页是历史缺陷 —— 作业、测验、课堂活动全在 exam-list 里，
        // 少了它看板永远看不到作业（2026-10-29 由诊断取证发现）。
        const pageResults: ChaoxingCrawlPageResult[] = [];
        for (const page of target.pages) {
          const remembered = urlMemory[crawlUrlMemoryKey(page.kind, target.courseKey)];
          const candidates = orderCrawlCandidateUrls(page.url, remembered);
          let ok = false;
          let message = '';
          let count: number | undefined;
          for (let i = 0; i < candidates.length; i += 1) {
            const res = await crawlSinglePage(target, page, candidates[i]);
            ok = res.ok;
            message = res.message;
            count = res.count;
            if (ok) {
              break;
            }
            // 只在“页面开了但没渲染出列表”时换下一个地址：
            // 超时/未登录说明不是地址的问题，再开标签只是白等。
            if (!message.includes('未渲染')) {
              break;
            }
            if (i + 1 < candidates.length) {
              void appendLog(
                'info',
                'sync',
                `学习通逐课同步「${target.name}」${chaoxingCrawlPageLabel(
                  page.kind,
                )}：当前地址未渲染出列表，换下一个地址重试`,
              );
            }
          }
          pageResults.push({
            kind: page.kind,
            ok,
            message: withChaoxingPageAdvice(page.kind, ok, message),
            count,
          });
        }

        // 课程成功口径：**至少一页成功**即算成功。
        // 作业页失败不应连带否定任务页已入库的真实数据（反之亦然）；
        // 具体哪一页失败由 message 与运行日志说清楚，不在这里夸大失败。
        const okPages = pageResults.filter((p) => p.ok);
        const detail = pageResults
          .map((p) => `${chaoxingCrawlPageLabel(p.kind)}${p.ok ? '成功' : '失败'}`)
          .join('，');
        items.push({
          courseKey: target.courseKey,
          name: target.name,
          ok: okPages.length > 0,
          // 两页只成功一页时标 partial：不允许被汇总成“全部成功”而掩盖某页没抓到。
          partial: okPages.length > 0 && okPages.length < pageResults.length,
          // 逐页明细进存档：弹窗要能回答「作业页成没成、失败原因是什么」。
          pages: pageResults,
          message: `共 ${pageResults.length} 页：${detail}`,
        });
        onProgress?.(items.length, plan.length, items.filter((it) => it.ok).length);
      }
    } finally {
      clearInterval(keepAlive);
      crawlWaiters.clear();
    }

    const succeeded = items.filter((it) => it.ok).length;
    const message = summarizeChaoxingCrawl(items);
    void appendLog(succeeded === items.length ? 'info' : 'warn', 'sync', message);
    // 抓取过程中每次上报都会刷新角标，这里再收一次尾，确保数字与最终缓存一致。
    void refreshActionBadge();
    return {
      ok: succeeded === items.length,
      total: items.length,
      succeeded,
      failed: items.length - succeeded,
      items,
      message,
    };
  }
});

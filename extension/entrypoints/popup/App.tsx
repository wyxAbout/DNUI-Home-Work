import { useEffect, useMemo, useState } from 'react';
import './App.css';
import {
  assignmentStatusLabel,
  countCoveredCourses,
  getAllAssignments,
  isAssignmentVisible,
  PLATFORM_HOME,
  PLATFORM_IDS,
  PLATFORM_LABELS,
  type Assignment,
  type ChaoxingCourse,
  type HomeworkStore,
  type PlatformId,
} from '@/src/models';
import { loadHomeworkStore, loadHideExpired, saveHideExpired, loadStartupNotifyEnabled, saveStartupNotifyEnabled, loadShowPageBadge, saveShowPageBadge, loadChaoxingCourses, loadChaoxingCrawlState } from '@/src/storage';
import {
  collectPageDiagnostic,
  type DiagnosticCandidateProbe,
  type DiagnosticReport,
} from '@/src/diagnose';
import { loadLog, clearLog, appendLog, type LogEntry } from '@/src/log';
import { BUILD_ID } from '@/src/build';
import {
  redactDiagnosticUrl,
  type ChaoxingCrawlState,
} from '@/src/chaoxing-crawl';

type Filter = 'all' | PlatformId;

function formatDate(value: string | null): string {
  if (!value) {
    return '未提供截止时间';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

// 构建标识是构建时刻的 ISO 时间戳（wxt.config.ts 注入），这里只显示“月-日 时:分”，
// 便于用户和开发者核对“弹窗里跑的到底是不是刚打包的那一版”。
function formatBuildId(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatUpdatedAt(value: string | null): string {
  if (!value) {
    return '尚未同步';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '时间未知';
  }

  return `最近更新于 ${new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)}`;
}

function formatLogTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

function statusLabel(status: HomeworkStore['platforms'][PlatformId]['status']): string {
  const labels = {
    never: '未访问',
    success: '已同步',
    'login-required': '需要登录',
    'needs-verification': '待验证',
    error: '同步失败',
  };

  return labels[status];
}

function compareAssignments(a: Assignment, b: Assignment): number {
  if (!a.dueAt && !b.dueAt) {
    return a.title.localeCompare(b.title, 'zh-CN');
  }
  if (!a.dueAt) {
    return 1;
  }
  if (!b.dueAt) {
    return -1;
  }
  return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
}

function sortAssignments(assignments: Assignment[]): Assignment[] {
  return [...assignments].sort(compareAssignments);
}

// 筛选按钮/卡片上的短平台名：完整名在 380px 弹窗里会挤占计数徽标。
const PLATFORM_SHORT_LABELS: Record<PlatformId, string> = {
  neusoft: '东软',
  pigai: '批改网',
  itest: 'iTEST',
  chaoxing: '学习通',
};

const pad2 = (n: number) => String(n).padStart(2, '0');

// 截止徽章：只区分「今天 / 明天 / 之后 / 已过期」，颜色只表达紧急度。
type DueTone = 'today' | 'soon' | 'later' | 'overdue' | 'none';

function dueMeta(assignment: Assignment): { label: string; tone: DueTone; title: string } {
  if (!assignment.dueAt) {
    return { label: '无截止', tone: 'none', title: '平台未提供截止时间' };
  }

  const date = new Date(assignment.dueAt);
  if (Number.isNaN(date.getTime())) {
    return { label: assignment.dueAt, tone: 'later', title: assignment.dueAt };
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDiff = Math.round((dueDay.getTime() - today.getTime()) / 86400000);
  const clock = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  const full = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);

  if (assignment.status === 'expired' || dayDiff < 0) {
    return { label: '已过期', tone: 'overdue', title: `截止 ${full}` };
  }
  if (dayDiff === 0) {
    return { label: `今天 ${clock}`, tone: 'today', title: `今天 ${clock} 截止` };
  }
  if (dayDiff === 1) {
    return { label: `明天 ${clock}`, tone: 'soon', title: `明天 ${clock} 截止` };
  }
  return {
    label: `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${clock}`,
    tone: 'later',
    title: `${full} 截止`,
  };
}

function isDueToday(assignment: Assignment): boolean {
  return dueMeta(assignment).tone === 'today';
}

// 平台卡片头右侧的「HH:mm 已同步」，避免在 380px 宽度里塞完整日期。
function formatSyncClock(value: string | null): string {
  if (!value) {
    return '未同步';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '未同步';
  }
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatUpdatedClock(value: string | null): string {
  if (!value) {
    return '尚未同步';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '时间未知';
  }
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatClockOnly(value: string | null): string {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

// 跨课程分组：按平台聚合（设计稿 04 的口径），组内按截止时间/标题排序；
// 课程名下沉到卡片副标题，避免同一平台被拆成多个重复的分组标题。
interface AssignmentGroup {
  key: string;
  platformId: PlatformId;
  assignments: Assignment[];
}

function groupAssignments(items: Assignment[]): AssignmentGroup[] {
  const map = new Map<PlatformId, AssignmentGroup>();
  for (const assignment of items) {
    let group = map.get(assignment.platformId);
    if (!group) {
      group = {
        key: assignment.platformId,
        platformId: assignment.platformId,
        assignments: [],
      };
      map.set(assignment.platformId, group);
    }
    group.assignments.push(assignment);
  }
  const groups = [...map.values()];
  groups.sort((x, y) => PLATFORM_IDS.indexOf(x.platformId) - PLATFORM_IDS.indexOf(y.platformId));
  for (const group of groups) {
    group.assignments.sort(compareAssignments);
  }
  return groups;
}

function App() {
  const [store, setStore] = useState<HomeworkStore | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  // 弹窗视图：作业看板 / 工具（快捷跳转 + 设置）。默认进「作业看板」。
  // 用状态切换而非新增入口，纯前端 Tab，不影响角标/通知/页面浮层。
  const [view, setView] = useState<'dashboard' | 'tools'>('dashboard');
  const [isRefreshing, setIsRefreshing] = useState(false);
  // 显示偏好：开启后隐藏“截止时间已过期”的未提交作业（不动缓存）。默认关闭。
  const [hideExpired, setHideExpired] = useState(false);
  // 开关：重新打开浏览器时是否在右下角强制弹出作业提醒。默认开启（保持原有行为）。
  const [startupNotify, setStartupNotify] = useState(false);
  // 开关：是否在访问作业站点时于页面右下角显示浮层。默认开启（保持原有行为）。
  const [showPageBadge, setShowPageBadge] = useState(true);
  const [diagnostic, setDiagnostic] = useState<string | null>(null);
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [diagnosticError, setDiagnosticError] = useState<string | null>(null);
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  // 诊断区默认收起，避免长期占用看板空间；点击“诊断当前页面”会自动展开。
  const [isDiagnosticOpen, setIsDiagnosticOpen] = useState(false);
  // 记录本次诊断实际捕获到的框架 hostname（含跨域 iframe），便于排查内容帧是否被注入。
  const [framesSeen, setFramesSeen] = useState<string[]>([]);
  // 本次诊断成功取到的每个内容页（任务 / 作业 / 考试）：可在面板里切换查看、分别复制 JSON。
  // 只保留“正文非空”的候选，避免把登录页/空白页也列成一份“结果”。
  const [probedReports, setProbedReports] = useState<DiagnosticReport[]>([]);
  const [activeProbeIndex, setActiveProbeIndex] = useState(0);
  const [log, setLog] = useState<LogEntry[]>([]);
  // 学习通课程注册表（阶段 A）：只有访问过「我的课程」页才会有数据。
  const [chaoxingCourses, setChaoxingCourses] = useState<ChaoxingCourse[]>([]);
  // 注册表默认折叠，避免抢占看板主区；展开后只做只读展示（ID 用于稳定主键）。
  const [isCourseRegistryOpen, setIsCourseRegistryOpen] = useState(false);
  // 阶段 B 逐课抓取：后台按注册表逐门开临时标签取任务列表。
  // 状态由后台写进 storage 存档、弹窗读存档展示（不依赖消息应答，弹窗关掉再开也能看到结果）。
  const [crawlState, setCrawlState] = useState<ChaoxingCrawlState | null>(null);
  // 刚点下按钮、后台还没写存档的那一两百毫秒，用本地标记先把按钮锁住，避免连点。
  const [crawlPending, setCrawlPending] = useState(false);

  const refreshStore = async () => {
    setIsRefreshing(true);
    setStore(await loadHomeworkStore());
    setChaoxingCourses(await loadChaoxingCourses());
    setIsRefreshing(false);
  };

  const refreshLog = async () => {
    setLog(await loadLog());
  };

  useEffect(() => {
    void refreshStore();
    void refreshLog();
    void loadHideExpired().then(setHideExpired);
    void loadStartupNotifyEnabled().then(setStartupNotify);
    void loadShowPageBadge().then(setShowPageBadge);
    void loadChaoxingCrawlState().then(setCrawlState);

    const listener = (changes: Record<string, unknown>) => {
      if (changes['homework-store']) void refreshStore();
      if (changes['homework-activity-log']) void refreshLog();
      // 逐课同步的进度/结果由后台写存档，弹窗跟着存档刷新（含抓完后的看板重读）。
      if (changes['chaoxing-crawl-state']) {
        void loadChaoxingCrawlState().then((next) => {
          setCrawlState(next);
          if (!next.running) {
            setCrawlPending(false);
            void refreshStore();
          }
        });
      }
    };

    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, []);

  // 渲染用作业列表：先按平台筛选，再按“隐藏已过期”偏好过滤；排序与分组均基于可见集合。
  const assignments = useMemo(() => {
    if (!store) {
      return [];
    }

    const scoped =
      filter === 'all'
        ? getAllAssignments(store)
        : store.platforms[filter].assignments;

    // 可见性：默认隐藏“已完成/已结束且无提交状态”（completed/ended）；
    // “已过期”项受独立开关“自动隐藏已过期项”控制（默认仍显示）。
    // 与后台角标/通知共用 isAssignmentVisible，保证三处数字口径一致
    // （2026-10-29 修改意见·问题 1：此前后台只按 dueAt 过滤、漏掉 completed/ended）。
    const visible = scoped.filter((a) => isAssignmentVisible(a, { hideExpired }));

    return sortAssignments(visible);
  }, [filter, store, hideExpired]);

  const groups = useMemo(() => groupAssignments(assignments), [assignments]);

  // 缓存中的未提交总数（含过期项）；可见数 = 实际展示数；隐藏数 = 因过期被隐藏的数。
  const totalCount = store ? getAllAssignments(store).length : 0;
  const visibleCount = assignments.length;
  const hiddenCount = totalCount - visibleCount;

  // 各平台“可见数”，用于平台筛选按钮的计数徽标，保证徽标与下方列表一致。
  const visibleByPlatform = useMemo(() => {
    const map = {} as Record<PlatformId, number>;
    for (const id of PLATFORM_IDS) {
      const scoped = store?.platforms[id].assignments ?? [];
      map[id] = scoped.filter((a) => isAssignmentVisible(a, { hideExpired })).length;
    }
    return map;
  }, [store, hideExpired]);

  const courseCount = store ? countCoveredCourses(store) : 0;

  // 顶部汇总卡使用「全局口径」：不随平台筛选变化，避免切换筛选时数字跳动。
  const globalVisibleAssignments = useMemo(() => {
    if (!store) {
      return [];
    }
    return sortAssignments(
      getAllAssignments(store).filter((a) => isAssignmentVisible(a, { hideExpired })),
    );
  }, [store, hideExpired]);
  const globalVisibleCount = globalVisibleAssignments.length;
  const globalHiddenCount = totalCount - globalVisibleCount;
  const dueTodayCount = useMemo(
    () => globalVisibleAssignments.filter(isDueToday).length,
    [globalVisibleAssignments],
  );
  const syncedPlatformCount = store
    ? PLATFORM_IDS.filter((id) => store.platforms[id].status === 'success').length
    : 0;

  // 逐课同步的展示口径：运行中显示“已完成 x/y 门”，结束后显示后台给的结论。
  const isCrawling = crawlPending || crawlState?.running === true;
  const crawlHint = crawlState?.running
    ? crawlState.total > 0
      ? `正在逐课抓取…已完成 ${crawlState.succeeded}/${crawlState.total} 门`
      : '正在逐课抓取…（正在读课程注册表）'
    : (crawlState?.message ?? null);

  // 等待后台把新数据写回（解析含 SPA 渲染等待，不能发完消息就立刻读缓存）。
  const waitForStoreUpdate = async (before: string | null, timeoutMs: number) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const next = await loadHomeworkStore();
      if (next.updatedAt !== before) {
        return next;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
    return loadHomeworkStore();
  };

  // 探测页面内运行的是哪一次构建的 content script（null = 没有脚本应答）。
  const pingContentScript = async (tabId: number): Promise<string | null> => {
    try {
      const pong = (await browser.tabs.sendMessage(tabId, { type: 'HW_PING' })) as
        | { buildId?: string }
        | undefined;
      return pong?.buildId ?? null;
    } catch {
      return null;
    }
  };

  const injectContentScript = async (tabId: number): Promise<boolean> => {
    try {
      await browser.scripting.executeScript({
        target: { tabId },
        files: ['/content-scripts/content.js'],
      });
      return true;
    } catch {
      return false;
    }
  };

  // 一键重载扩展：让磁盘上最新的构建（新解析器/新弹窗资源）立刻生效。
  // 说明：浏览器不会自动把新打包的脚本换进已加载的扩展，这是“日志里明明是新时间、
  // 行为却还是旧逻辑”的唯一原因。重载会关闭本弹窗，重开后“构建”时间戳应更新。
  const reloadExtension = () => {
    void appendLog('info', 'sync', '正在重载扩展以应用最新构建…');
    // 给日志落盘留一点时间，再重载（重载会中断当前页面上下文）。
    window.setTimeout(() => {
      browser.runtime.reload();
    }, 200);
  };

  const requestCurrentPageSync = async () => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      return;
    }

    setIsRefreshing(true);
    const before = (await loadHomeworkStore()).updatedAt;
    try {
      const buildId = await pingContentScript(tab.id);

      if (buildId === BUILD_ID) {
        await browser.tabs
          .sendMessage(tab.id, { type: 'SYNC_ACTIVE_PAGE' })
          .catch(() => undefined);
      } else {
        // 两种需要补救的情况：
        // ① 扩展更新后，旧标签页里的脚本失联（消息无人接收）；
        // ② 脚本还在，但属于上一次打包的旧版本 —— 它只会返回旧逻辑的结果，
        //    表现为“代码已更新、看板却一直显示待验证/空”。
        // 统一处理：补注入本次构建的产物，由它的首次上报完成同步。
        const injected = await injectContentScript(tab.id);
        // 注射后再 ping 一次：确认最新脚本真的接管了页面。
        // 否则会出现“日志说已注入、看板却不动”的假成功（例如页面 CSP 拒绝注入）。
        const after = injected ? await pingContentScript(tab.id) : null;
        if (!injected) {
          void appendLog(
            'error',
            'sync',
            '当前页无法注入脚本：请确认它是东软/批改网/iTEST/学习通邮箱 页面，并重载扩展授予 scripting 权限',
          );
        } else if (after === BUILD_ID) {
          void appendLog(
            'info',
            'sync',
            buildId
              ? '页面内是旧版脚本，已注入最新版并重新解析'
              : '当前页未运行脚本，已注入最新版并开始解析',
          );
        } else {
          void appendLog(
            'error',
            'sync',
            '已注入脚本但未被页面接管：请在扩展管理页重载扩展后刷新该页面',
          );
        }
      }

      setStore(await waitForStoreUpdate(before, 6000));
    } finally {
      setIsRefreshing(false);
    }
  };

  // 阶段 B：逐课同步。只发一条“开始”消息，不等它的返回值 ——
  // 结果一律以后台写进 storage 的进度存档为准（后台是唯一事实来源）。
  const crawlChaoxing = async () => {
    if (crawlPending || crawlState?.running) {
      return;
    }
    setCrawlPending(true);
    // 记下点击前的轮次标识，3 秒后用它判断“后台到底有没有开始跑”。
    const beforeStartedAt = crawlState?.startedAt ?? null;
    void appendLog('info', 'sync', `触发逐课同步：${chaoxingCourses.length} 门课`);
    try {
      await browser.runtime.sendMessage({ type: 'CRAWL_CHAOXING_COURSES' });
    } catch {
      // 后台可能刚好被回收/尚未唤醒：消息本身不重要，等存档变化即可。
    }
    // 兜底：3 秒内存档没换轮次，说明后台没接住（或判定“已在进行中”而忽略），
    // 必须解锁按钮并说明，否则界面会永久停在“逐课同步中…”。
    window.setTimeout(async () => {
      const latest = await loadChaoxingCrawlState();
      setCrawlState(latest);
      if (latest.startedAt === beforeStartedAt && !latest.running) {
        setCrawlPending(false);
        void appendLog('warn', 'sync', '逐课同步未启动：后台没有写入进度，请再点一次');
      }
    }, 3000);
  };

  const runDiagnostic = async () => {
    setDiagnosticError(null);
    setIsDiagnosticOpen(true);
    setIsDiagnosing(true);
    // 清掉上一轮的候选页，避免这次没取到却还显示上次的“作业/考试”页。
    setProbedReports([]);
    setActiveProbeIndex(0);
    void appendLog('info', 'diagnostic', '开始诊断当前页面');
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        setDiagnosticError('未找到当前标签页。');
        setReport(null);
        void appendLog('warn', 'diagnostic', '诊断：未找到当前标签页');
        return;
      }
      const tabId = tab.id; // 闭包内控制流收窄会失效，先固化成 const
      // 直接把自包含扫描函数注入当前标签页执行，不依赖页面是否已注入过 content script。
      // allFrames: true —— 学习通收件箱渲染在 notice.chaoxing.com 的跨域 iframe 中，
      // 顶层文档看不到内容，必须注入到 iframe 框架本身才能抓到真实消息列表。
      // 两轮注入：首轮捕获当前已渲染的框架（含默认激活标签的内容 iframe）；间隔后再注入一轮，
      // 捕获“点击标签后才加载”的内容 iframe。课程页作业/考试/任务列表渲染在
      // mobilelearn.chaoxing.com / mooc1.chaoxing.com 的跨域 iframe 内，点标签才加载，
      // 一次性注入会漏掉内容帧（只抓到 mooc2-ans 外壳主文档）。
      const injectAll = () =>
        browser.scripting.executeScript({
          target: { tabId: tabId, allFrames: true },
          func: collectPageDiagnostic,
        });
      const first = await injectAll();
      await new Promise((r) => setTimeout(r, 1800));
      const second = await injectAll();
      const results: (Awaited<ReturnType<typeof injectAll>>[number] | undefined)[] = [
        ...(first ?? []),
        ...(second ?? []),
      ];
      // 显式命中跨域内容 iframe（mobilelearn/mooc1），不依赖 allFrames 的时机：
      // 这两类帧的列表由前端 XHR 异步渲染，且可能晚于外壳注入才创建，allFrames 一轮未必覆盖。
      // 用 webNavigation.getAllFrames 枚举实际帧，按 frameId 定向注入，再等其 XHR 渲染后由
      // collectPageDiagnostic 内部轮询读取（见 diagnose.ts 的 isContentFrame 分支）。
      try {
        const frames = await browser.webNavigation.getAllFrames({ tabId });
        const contentFrameIds = (frames ?? [])
          .filter((f) => /mobilelearn\.chaoxing\.com|mooc1\.chaoxing\.com/.test(f.url ?? ''))
          .map((f) => f.frameId);
        if (contentFrameIds.length > 0) {
          await new Promise((r) => setTimeout(r, 2200));
          const extra = await browser.scripting.executeScript({
            target: { tabId, frameIds: contentFrameIds },
            func: collectPageDiagnostic,
          });
          results.push(...(extra ?? []));
        }
      } catch {
        /* 枚举/定向注入失败不影响主流程（仍可用 allFrames 的两轮结果） */
      }
      const rawReports = (results ?? [])
        .map((r) => r?.result as DiagnosticReport | undefined)
        .filter((r): r is DiagnosticReport => Boolean(r));
      // 去重：同一 hostname 可能来自两轮 allFrames + 定向注入，保留 mainText 最长（内容最全）的那份。
      const reports: DiagnosticReport[] = [];
      for (const r of rawReports) {
        const existing = reports.find((x) => x.hostname === r.hostname);
        if (!existing) reports.push(r);
        else if ((r.mainText?.length ?? 0) > (existing.mainText?.length ?? 0)) {
          Object.assign(existing, r);
        }
      }
      if (reports.length === 0) {
        setDiagnosticError('未能读取页面结构：请确认当前标签页是东软/批改网/iTEST/学习通（邮箱收件箱或 mooc1·mooc2-ans 课程页）的页面。');
        setReport(null);
        void appendLog('warn', 'diagnostic', '诊断：页面未返回结构，可能不是平台页面');
        return;
      }
      // 框架选择优先级（关键：课程内容在跨域 iframe，必须优先于课程页“外壳”主文档）：
      // 1) 带考试详情探测的框架（收件箱）；2) 任务/活动列表 iframe（mobilelearn.chaoxing.com，权威内容）；
      // 3) 作业/考试列表 iframe（mooc1.chaoxing.com）；4) 收件箱 iframe（notice.chaoxing.com）；
      // 5) 课程页主文档且 mainText 含作业/考试/任务状态文案；6) 其它含 mainText 的框架；7) 首个。
      let report =
        reports.find((r) => r.examProbe) ??
        reports.find((r) => r.hostname.includes('mobilelearn.chaoxing.com') && r.mainText) ??
        reports.find((r) => r.hostname.includes('mooc1.chaoxing.com') && r.mainText) ??
        reports.find((r) => r.hostname.includes('notice.chaoxing.com')) ??
        reports.find(
          (r) =>
            /chaoxing/.test(r.hostname) &&
            !r.hostname.includes('notice.chaoxing.com') &&
            /(未完成|未交|待批阅|已完成|已退回|重考|进行中|已结束|作业|考试)/.test(r.mainText),
        ) ??
        reports.find(
          (r) =>
            /chaoxing/.test(r.hostname) &&
            !r.hostname.includes('notice.chaoxing.com') &&
            r.mainText,
        ) ??
        reports.find((r) => r.mainText) ??
        reports[0]!;

      // 跨域内容 iframe 未被直接捕获（allFrames / frameIds 注入在部分环境会静默失败）时，
      // 退而用“外壳主文档里记录的 iframe 完整 URL”开一个临时后台标签，作为顶层文档诊断——
      // 顶层文档注入不涉跨域帧时机/权限问题，最稳妥；诊断完即关闭该临时标签。
      const looksLikeShell = !/mobilelearn\.chaoxing\.com|mooc1\.chaoxing\.com/.test(
        report.hostname,
      );
      if (looksLikeShell) {
        // 候选可能有多个（任务 / 作业 / 考试）：逐个开临时标签取证，
        // 取“内容最全”的那份（优先解析出的作业项数，其次正文长度）——
        // 这样即便某个候选重定向到登录页或列表为空，也不会拖垮整次诊断。
        // 候选可能不止一个（任务 / 作业 / 考试），且作业/考试页常见“外壳 + 内容 iframe”。
        // 用有界 BFS 逐层取证（最多 2 层、合计最多 6 个标签），并把每个候选的结论都记下来：
        // “作业/考试诊断不出来”到底是地址拼错、被重定向到登录页，还是列表在更深一层，一看便知。
        const initial = [
          ...new Set(
            rawReports
              .flatMap((r) => r.contentFrameUrls ?? [])
              .filter((u) => /mobilelearn\.chaoxing\.com|mooc1\.chaoxing\.com/.test(u)),
          ),
        ];
        const queue: { url: string; depth: number }[] = initial.map((url) => ({ url, depth: 0 }));
        const seenUrls = new Set(queue.map((q) => q.url));
        const probes: DiagnosticCandidateProbe[] = [];
        const probed: DiagnosticReport[] = [];

        while (queue.length > 0 && probes.length < 6) {
          const { url: frameUrl, depth } = queue.shift()!;
          let probeTabId: number | undefined;
          try {
            const newTab = await browser.tabs.create({ url: frameUrl, active: false });
            probeTabId = newTab.id;
            const probeTab = newTab.id!;
            await new Promise((r) => setTimeout(r, 3500)); // 等列表页加载并 XHR 渲染
            const res = await browser.scripting.executeScript({
              target: { tabId: probeTab },
              func: collectPageDiagnostic,
            });
            const fr = res?.[0]?.result as DiagnosticReport | undefined;
            if (!fr) {
              probes.push({
                url: redactDiagnosticUrl(frameUrl),
                depth,
                hostname: '',
                title: '',
                mainTextLength: 0,
                rowCount: 0,
                adopted: false,
                reason: '注入未返回结果（页面可能拒绝脚本或标签已被关闭）',
              });
              continue;
            }
            // 只要确实抓到内容页（正文非空）就采纳——即便提取器尚未匹配其措辞，
            // 真实 mainText + tree + listRows 就是回填解析器的证据。
            const adopted = fr.mainText.length > 40;
            probes.push({
              url: redactDiagnosticUrl(frameUrl),
              depth,
              hostname: fr.hostname,
              title: fr.title,
              mainTextLength: fr.mainText.length,
              rowCount: fr.listRows?.length ?? 0,
              adopted,
              reason: adopted ? undefined : '正文过短：可能是登录页、错误页，或列表仍未渲染',
              textSample: fr.mainText.slice(0, 200),
            });
            if (adopted) {
              probed.push(fr);
            }
            // 再往下探一层：候选页自己还内嵌内容 iframe 时（作业/考试常见），继续取证。
            if (depth < 1) {
              for (const nested of fr.contentFrameUrls ?? []) {
                if (
                  seenUrls.has(nested) ||
                  !/mobilelearn\.chaoxing\.com|mooc1\.chaoxing\.com/.test(nested)
                ) {
                  continue;
                }
                seenUrls.add(nested);
                queue.push({ url: nested, depth: depth + 1 });
              }
            }
          } catch (e) {
            probes.push({
              url: redactDiagnosticUrl(frameUrl),
              depth,
              hostname: '',
              title: '',
              mainTextLength: 0,
              rowCount: 0,
              adopted: false,
              reason: `取证异常：${String(e)}`,
            });
          } finally {
            if (probeTabId != null) {
              await browser.tabs.remove(probeTabId).catch(() => undefined);
            }
          }
        }

        if (probed.length > 0) {
          const best = probed.reduce((a, b) =>
            b.assignments.length > a.assignments.length ||
            (b.assignments.length === a.assignments.length &&
              b.mainText.length > a.mainText.length)
              ? b
              : a,
          );
          report = best;
          setActiveProbeIndex(Math.max(0, probed.indexOf(best)));
        }
        if (probes.length > 0) {
          // 每个成功取到的页面都挂上同一份候选结论，切换查看时口径一致。
          report = { ...report, candidateProbes: probes };
          const adoptedCount = probes.filter((p) => p.adopted).length;
          void appendLog(
            adoptedCount > 0 ? 'info' : 'warn',
            'diagnostic',
            `候选内容页取证：共 ${probes.length} 个候选，采纳 ${adoptedCount} 个`,
          );
        }
        setProbedReports(probed.map((r) => ({ ...r, candidateProbes: probes })));
      }

      setFramesSeen(
        [...new Set([...rawReports.map((r) => r.hostname), report.hostname])].sort(),
      );
      void appendLog(
        'info',
        'diagnostic',
        `诊断：捕获 ${reports.length} 个框架${
          rawReports.some((r) => /mobilelearn|mooc1/.test(r.hostname))
            ? '（含内容帧）'
            : '（未含内容帧，已尝试独立标签取证）'
        }`,
      );
      setReport(report);
      setDiagnostic(JSON.stringify(report, null, 2));
      void appendLog(
        'info',
        'diagnostic',
        `诊断完成：捕获 ${report.classNames.length} 个类名、${report.anchors.length} 个链接${report.truncated ? '（已截断）' : ''}`,
      );
    } catch {
      setDiagnosticError(
        '诊断失败：请确认当前标签页属于已支持的平台（东软/批改网/iTEST/学习通邮箱收件箱/mooc1·mooc2-ans 课程页），并已在扩展管理页重新加载本扩展以授予“scripting”权限。',
      );
      setReport(null);
      void appendLog('error', 'diagnostic', '诊断失败：注入执行异常');
    } finally {
      setIsDiagnosing(false);
    }
  };

  const copyDiagnostic = async () => {
    if (diagnostic) {
      await navigator.clipboard?.writeText(diagnostic).catch(() => undefined);
    }
  };

  if (!store) {
    return <main className="app-shell loading-state">正在读取本机作业数据...</main>;
  }

  return (
    <main className={view === 'dashboard' ? 'app-shell is-dashboard' : 'app-shell'}>
      <header className="topbar">
        <div className="topbar-main">
          <h1>{view === 'dashboard' ? '作业看板' : '工具与同步'}</h1>
          <p className="subtitle">
            {view === 'dashboard'
              ? `${syncedPlatformCount} 个平台已同步 · ${formatUpdatedClock(store.updatedAt)}`
              : '数据只保存在本机，不上传'}
          </p>
        </div>
        <div className="topbar-actions">
          {view === 'tools' && (
            <button
              className="icon-button"
              type="button"
              onClick={() => setView('dashboard')}
              title="返回作业看板"
              aria-label="返回作业看板"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14 6l-6 6 6 6" />
              </svg>
            </button>
          )}
          <button
            className={isRefreshing ? 'icon-button spinning' : 'icon-button'}
            type="button"
            onClick={() => void requestCurrentPageSync()}
            title="刷新当前平台"
            aria-label="刷新当前平台"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M20 12a8 8 0 1 1-2.3-5.6" />
              <path d="M20 4v5h-5" />
            </svg>
          </button>
          {view === 'dashboard' && (
            <button
              className="icon-button"
              type="button"
              onClick={() => setView('tools')}
              title="工具与设置"
              aria-label="工具与设置"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
                <circle cx="15" cy="7" r="2" />
                <circle cx="7" cy="17" r="2" />
              </svg>
            </button>
          )}
        </div>
      </header>

      {view === 'dashboard' && (
        <>
      <section className="summary-card" aria-label="作业摘要">
        <div className="summary-main">
          <span className="summary-cap">待完成</span>
          <div className="summary-num">
            {globalVisibleCount}
            <span>项</span>
          </div>
          <div className="summary-sub">
            {dueTodayCount > 0 ? `${dueTodayCount} 项今天截止` : '今天没有截止项'} · 覆盖 {courseCount} 门课程
          </div>
          {globalHiddenCount > 0 && (
            // 关键提示：作业抓到了、只是按当前口径不显示。
            // 少了这一行，用户看到「未完成 0 项」会以为同步失败（2026-10-29 的真实反馈）。
            <span className="summary-hidden" title="这些项已同步到本机，但按当前显示口径不列出">
              另有 {globalHiddenCount} 项已完成或已过期
            </span>
          )}
        </div>
        <div className="summary-platforms">
          {PLATFORM_IDS.map((platformId) => (
            <div className="summary-platform" key={platformId}>
              <i className={`plat-dot plat-${platformId}`} />
              <span>{PLATFORM_SHORT_LABELS[platformId]}</span>
              <b>{visibleByPlatform[platformId]}</b>
            </div>
          ))}
        </div>
      </section>
        </>
      )}

      {view === 'tools' && (
        <>
      <section className="sync-card" aria-label="同步概览">
        <div className="sync-top">
          <span>本机缓存</span>
          <b>
            {globalVisibleCount} 项 · {courseCount} 门课程
          </b>
        </div>
        <p className="sync-meta">{formatUpdatedAt(store.updatedAt)} · 按访问平台更新</p>
        <div className="sync-actions">
          <button
            className="btn-primary"
            type="button"
            onClick={() => void requestCurrentPageSync()}
            disabled={isRefreshing || isCrawling}
          >
            {isRefreshing ? '同步中…' : '同步当前页面'}
          </button>
          {chaoxingCourses.length > 0 && (
            <button
              className="btn-ghost"
              type="button"
              onClick={() => void crawlChaoxing()}
              disabled={isCrawling}
            >
              {isCrawling ? '逐课同步中…' : `逐课同步 ${chaoxingCourses.length} 门`}
            </button>
          )}
        </div>
      </section>

      <section className="platform-status" aria-label="平台同步状态">
        <div className="section-head">
          <b>平台状态</b>
          <span>按访问更新</span>
        </div>
        {PLATFORM_IDS.map((platformId) => {
          const platform = store.platforms[platformId];
          return (
            <div
              className="platform-status-item"
              key={platformId}
              title={platform.message ?? undefined}
            >
              <i className={`plat-dot plat-${platformId}`} />
              <span className="platform-name">{PLATFORM_LABELS[platformId]}</span>
              <span className="status-label">{statusLabel(platform.status)}</span>
              <span className="platform-time">
                {formatSyncClock(platform.lastSyncedAt)}
              </span>
            </div>
          );
        })}
      </section>

      <section className="quick-jump" aria-label="快捷跳转">
        <div className="section-head">
          <b>快捷跳转</b>
          <span>无任务也能直达站点</span>
        </div>
        <div className="quick-jump-row">
          {PLATFORM_IDS.map((platformId) => (
            <button
              key={platformId}
              type="button"
              className="jump-button"
              title={`打开${PLATFORM_LABELS[platformId]}官网`}
              onClick={() =>
                void browser.tabs.create({ url: PLATFORM_HOME[platformId], active: true })
              }
            >
              {PLATFORM_SHORT_LABELS[platformId]}
            </button>
          ))}
        </div>
      </section>

      {chaoxingCourses.length > 0 && (
        <section className="course-registry" aria-label="学习通课程注册表">
          <button
            type="button"
            className="registry-toggle"
            aria-expanded={isCourseRegistryOpen}
            onClick={() => setIsCourseRegistryOpen(!isCourseRegistryOpen)}
            title="来自「我的课程」页的课程 ID / 教学班 ID，用作作业稳定主键"
          >
            <span
              className={
                isCourseRegistryOpen ? 'registry-caret open' : 'registry-caret'
              }
              aria-hidden="true"
            >
              ▾
            </span>
            <span className="registry-title">学习通课程注册表</span>
            <span className="registry-badge">{chaoxingCourses.length} 门</span>
          </button>
          <div className="registry-actions">
            <button
              type="button"
              className="crawl-button"
              onClick={() => void crawlChaoxing()}
              disabled={isCrawling}
              title="按注册表逐门打开课程任务列表取数（后台临时标签，抓完自动关闭），无需手动进每门课"
            >
              {isCrawling ? '逐课同步中…' : `逐课同步 ${chaoxingCourses.length} 门课`}
            </button>
            {crawlHint && <span className="crawl-hint">{crawlHint}</span>}
            {crawlState && !crawlState.running && (crawlState.items ?? []).length > 0 && (
              <details className="crawl-detail">
                <summary>
                  抓取明细（
                  {(crawlState.items ?? []).filter((it) => it.ok && !it.partial).length}
                  {' 门两页都成功，'}
                  {(crawlState.items ?? []).filter((it) => it.partial).length}
                  {' 门部分失败）'}
                </summary>
                <ul>
                  {(crawlState.items ?? []).map((item) => (
                    <li key={item.courseKey}>
                      <span className="crawl-detail-course">{item.name}</span>
                      <ul>
                        {(item.pages ?? []).map((page) => (
                          <li
                            key={`${item.courseKey}-${page.kind}`}
                            className={page.ok ? 'crawl-page-ok' : 'crawl-page-fail'}
                          >
                            <span className="crawl-page-kind">
                              {page.kind === 'task' ? '任务' : '作业/考试'}
                            </span>
                            {/* 成功也要给条数：「成功 0 条」和「成功 8 条」对用户是两个世界，
                                只写“成功”会重演 2026-10-29「全部成功却没有作业」。 */}
                            {page.ok
                              ? typeof page.count === 'number'
                                ? `成功 · ${page.count} 条`
                                : '成功'
                              : page.message}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
          {isCourseRegistryOpen && (
            <ul className="registry-list">
              {chaoxingCourses.map((course) => (
                <li
                  key={`${course.courseId}-${course.clazzId}`}
                  className="registry-item"
                >
                  <span className="registry-name">{course.name}</span>
                  {course.alias && (
                    <span className="registry-alias">{course.alias}</span>
                  )}
                  {course.teacher && (
                    <span className="registry-teacher">{course.teacher}</span>
                  )}
                  <span className="registry-ids">
                    {course.courseId} · {course.clazzId}
                  </span>
                  {course.progressText && (
                    <span
                      className="registry-progress"
                      title="章节任务点进度（视频/章节学习），不代表作业提交状态"
                    >
                      {course.progressText}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
        </>
      )}

      {view === 'dashboard' && (
        <>
      <nav className="filter-row" aria-label="平台筛选">
        <button
          className={filter === 'all' ? 'filter-button active' : 'filter-button'}
          type="button"
          onClick={() => setFilter('all')}
        >
          全部
          <span>{globalVisibleCount}</span>
        </button>
        {PLATFORM_IDS.map((platformId) => (
          <button
            className={filter === platformId ? 'filter-button active' : 'filter-button'}
            type="button"
            onClick={() => setFilter(platformId)}
            key={platformId}
          >
            {PLATFORM_SHORT_LABELS[platformId]}
            <span>{visibleByPlatform[platformId]}</span>
          </button>
        ))}
      </nav>
        </>
      )}

      {view === 'tools' && (
        <>
      <section className="display-options" aria-label="显示选项">
        <div className="section-head">
          <b>显示选项</b>
          <span>偏好设置</span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={hideExpired}
          className={`toggle-row ${hideExpired ? 'on' : ''}`}
          onClick={async () => {
            const next = !hideExpired;
            setHideExpired(next);
            await saveHideExpired(next);
            void appendLog(
              'info',
              'display',
              next ? '已开启：自动隐藏已过期项' : '已关闭：显示全部未提交项',
            );
          }}
          title="开启后，截止时间已过的作业将从看板隐藏（仍保留在缓存中，关闭即恢复显示）"
        >
          <span className="toggle-text">
            自动隐藏已过期项
            <span>过期后仍保留在本机缓存</span>
          </span>
          <span className="toggle-switch" aria-hidden="true">
            <span className="toggle-knob" />
          </span>
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={startupNotify}
          className={`toggle-row ${startupNotify ? 'on' : ''}`}
          onClick={async () => {
            const next = !startupNotify;
            setStartupNotify(next);
            await saveStartupNotifyEnabled(next);
            void appendLog(
              'info',
              'display',
              next ? '已开启：重新打开浏览器时强制播报' : '已关闭：重开浏览器不再强制播报',
            );
          }}
          title="关闭后，重新打开浏览器不再在右下角强制弹出作业提醒；但作业数量变化时仍会正常通知。"
        >
          <span className="toggle-text">
            重开浏览器时弹出提醒
            <span>开启后重新打开浏览器会汇总播报</span>
          </span>
          <span className="toggle-switch" aria-hidden="true">
            <span className="toggle-knob" />
          </span>
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={showPageBadge}
          className={`toggle-row ${showPageBadge ? 'on' : ''}`}
          onClick={async () => {
            const next = !showPageBadge;
            setShowPageBadge(next);
            await saveShowPageBadge(next);
            void appendLog(
              'info',
              'display',
              next ? '已开启：在页面内显示浮层' : '已关闭：不再在页面内显示浮层',
            );
          }}
          title="关闭后，访问作业站点时不再在页面右下角显示浮层；扩展图标角标与弹窗不受影响。"
        >
          <span className="toggle-text">
            在页面内显示浮层
            <span>访问平台时右下角显示待办角标</span>
          </span>
          <span className="toggle-switch" aria-hidden="true">
            <span className="toggle-knob" />
          </span>
        </button>
        {hideExpired && hiddenCount > 0 && (
          <span className="hidden-hint">已隐藏 {hiddenCount} 项过期作业</span>
        )}
      </section>
        </>
      )}

      {view === 'tools' && (
        <>
      <section className="diagnostic" aria-label="页面诊断">
        <div className="diagnostic-head">
          <button
            className="diagnostic-toggle"
            type="button"
            onClick={() => setIsDiagnosticOpen((open) => !open)}
            aria-expanded={isDiagnosticOpen}
            aria-controls="diagnostic-panel"
            title={isDiagnosticOpen ? '收起诊断' : '展开诊断'}
          >
            <span
              className={isDiagnosticOpen ? 'diagnostic-caret open' : 'diagnostic-caret'}
              aria-hidden="true"
            >
              ▶
            </span>
            <span className="diagnostic-title">页面诊断（只读去敏）</span>
            {report && (
              <span className="diagnostic-badge">{report.assignments.length} 项</span>
            )}
          </button>
          <button
            className="text-button diagnostic-action"
            type="button"
            onClick={() => void runDiagnostic()}
            disabled={isDiagnosing}
          >
            {isDiagnosing ? '诊断中…' : '诊断当前页面'}
          </button>
        </div>

        {isDiagnosticOpen && (
          <div className="diagnostic-panel" id="diagnostic-panel">
        {diagnosticError && <p className="diagnostic-error">{diagnosticError}</p>}
        {report && (
          <div className="diagnostic-findings">
            <div className="finding-row">
              <span className="finding-key">当前域名</span>
              <span className="finding-val">{report.hostname}</span>
            </div>
            {probedReports.length === 0 &&
              /mobilelearn\.chaoxing\.com|mooc1\.chaoxing\.com/.test(report.hostname) && (
                <p className="finding-empty">
                  本次是在「内容帧页面」上诊断的（{report.hostname}），它只能看到当前这一张列表
                  —— 所以只会出现任务、拿不到作业/考试。想一次取到三份，请回到课程页
                  （地址含 mooc2-ans 的课程空间）再点「诊断当前页面」，诊断会自动开临时标签把
                  任务 / 作业 / 考试 逐个取回来。
                </p>
              )}
            {probedReports.length > 0 && (
              <div className="probe-tabs" role="tablist" aria-label="已取证的内容页">
                {probedReports.map((r, i) => (
                  <button
                    key={`${r.hostname}-${i}`}
                    type="button"
                    role="tab"
                    aria-selected={i === activeProbeIndex}
                    className={i === activeProbeIndex ? 'probe-tab active' : 'probe-tab'}
                    onClick={() => {
                      setActiveProbeIndex(i);
                      setReport(r);
                      setDiagnostic(JSON.stringify(r, null, 2));
                    }}
                    title={`${r.hostname} · 正文 ${r.mainText.length} 字 · 列表行 ${r.listRows?.length ?? 0}`}
                  >
                    {r.title || r.hostname}
                  </button>
                ))}
              </div>
            )}
            <div className="finding-row">
              <span className="finding-key">捕获到的框架</span>
              <span className="finding-val">
                {framesSeen.length === 0 ? '（无）' : framesSeen.join(' · ')}
                {!framesSeen.includes('mobilelearn.chaoxing.com') &&
                  !framesSeen.includes('mooc1.chaoxing.com') &&
                  framesSeen.length > 0 &&
                  ' — 内容 iframe 未捕获，请在诊断前先点开对应标签并等待列表加载'}
              </span>
            </div>
            <div className="finding-row">
              <span className="finding-key">作业标签点击</span>
              <span className="finding-val">
                {report.clickedAssignmentTab ? '已自动点击“作业”标签并等待渲染' : '未找到明确的“作业”标签，已静默等待渲染'}
              </span>
            </div>

            <div className="finding-block">
              <span className="finding-key">内容区标签（激活项已标 ★）</span>
              {report.tabs.length === 0 ? (
                <p className="finding-empty">未检测到 .el-tabs__item / [role=tab] 标签</p>
              ) : (
                <ul className="finding-list">
                  {report.tabs.map((t, i) => (
                    <li key={i}>
                      {t.active ? '★ ' : '　'}{t.text}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {report.menuItems.length > 0 && (
              <div className="finding-block">
                <span className="finding-key">顶部菜单项</span>
                <p className="finding-inline">{report.menuItems.join(' / ')}</p>
              </div>
            )}

            <div className="finding-block">
              <span className="finding-key">作业区可见文本（去敏）</span>
              {report.mainText ? (
                <textarea className="diagnostic-maintext" readOnly value={report.mainText} />
              ) : (
                <p className="finding-empty">作业区文本为空，可能列表仍未渲染或位于其他页面</p>
              )}
            </div>

            <div className="finding-block">
              <span className="finding-key">疑似接口路径（仅 pathname）</span>
              {report.requests.length === 0 ? (
                <p className="finding-empty">本次未捕获到作业相关接口请求</p>
              ) : (
                <ul className="finding-list">
                  {report.requests.map((r, i) => (
                    <li key={i}>
                      <code>{r.method}</code> {r.path}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {report.examProbe && (
              <div className="finding-block">
                <span className="finding-key">考试详情抓取探测（实时 DOM 取证）</span>
                {report.examProbe.error ? (
                  <p className="finding-empty">探测失败：{report.examProbe.error}</p>
                ) : report.examProbe.parsed ? (
                  <ul className="finding-list">
                    <li key="method">取证手段：{report.examProbe.method}</li>
                    <li key="src"><code>GET</code> {report.examProbe.source} → {report.examProbe.status}</li>
                    <li key="course">课程：{report.examProbe.parsed.courseName || '（空）'}</li>
                    <li key="exam">考试：{report.examProbe.parsed.examTitle || '（空）'}</li>
                    <li key="start">开始：{report.examProbe.parsed.startAt ?? '未解析到'}</li>
                    <li key="end">结束：{report.examProbe.parsed.endAt ?? '未解析到'}</li>
                  </ul>
                ) : (
                  <p className="finding-empty">
                    取证手段：{report.examProbe.method}；fetch 返回 {report.examProbe.status}，
                    但实时 DOM 仍未解析到考试字段（正文样本见诊断 JSON 的 examProbe.textSample）
                  </p>
                )}
              </div>
            )}

            {report.candidateProbes && report.candidateProbes.length > 0 && (
              <div className="finding-block">
                <span className="finding-key">
                  候选内容页取证（作业/考试取不到时，先看这里的原因）
                </span>
                <ul className="finding-list probe-list">
                  {report.candidateProbes.map((p, i) => (
                    <li key={i} className={p.adopted ? 'probe-ok' : 'probe-fail'}>
                      <span className="probe-flag">{p.adopted ? '已采纳' : '未采纳'}</span>
                      <span className="probe-target">
                        {p.depth > 0 ? `↳ 第${p.depth}层 ` : ''}
                        {p.title || p.hostname || '（无标题）'}
                      </span>
                      <code className="probe-url">{p.url}</code>
                      <span className="probe-meta">
                        正文 {p.mainTextLength} 字 · 行 {p.rowCount}
                      </span>
                      {p.reason && <span className="probe-reason">{p.reason}</span>}
                      {!p.adopted && p.textSample && (
                        <span className="probe-sample">{p.textSample}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="finding-block">
              <span className="finding-key">作业项解析（状态 / 剩余次数 / 动作）</span>
              {report.assignments.length === 0 ? (
                <p className="finding-empty">未解析到作业项，可能作业列表仍未渲染或标记文案不同</p>
              ) : (
                <>
                  <p className="finding-inline">
                    {report.assignmentSummary
                      ? `已完成 ${report.assignmentSummary.done}/${report.assignmentSummary.total} · `
                      : ''}
                    待提交 {report.assignments.filter((a) => !a.submitted).length} 项
                    {report.assignments.some((a) => a.courseName) ? '（首页“我的学习任务”）' : ''}
                  </p>
                  <ul className="finding-list assignment-findings">
                    {report.assignments.map((a, i) => (
                      <li key={i} className={a.submitted ? 'af-done' : 'af-pending'}>
                        <span className={`af-status ${a.submitted ? 'af-submitted' : 'af-unsubmitted'}`}>
                          {a.status}
                        </span>
                        <span className="af-index">{a.index}</span>
                        <span className="af-title">{a.title}</span>
                        {a.courseName && <span className="af-course">{a.courseName}</span>}
                        <span className="af-meta">剩余{a.remainingAttempts}次 · {a.action}</span>
                        {a.note && <span className="af-meta">{a.note}</span>}
                        {a.dueAt && <span className="af-progress">截止 {formatDate(a.dueAt)}</span>}
                        {a.progress && <span className="af-progress">{a.progress}</span>}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
        )}
        {diagnostic && (
          <div className="diagnostic-body">
            <button className="text-button" type="button" onClick={() => void copyDiagnostic()}>
              复制完整摘要
            </button>
            <textarea className="diagnostic-output" readOnly value={diagnostic} />
          </div>
        )}
        <p className="diagnostic-note">
          诊断仅读取当前标签页及其内嵌 iframe 的 DOM 结构，已去除表单值、Cookie、token 等敏感信息，不会上传任何数据。用于定位作业页面结构（含学习通课程页 mooc1·mooc2-ans 的作业/考试/任务列表，只读 DOM、不进入答题页）。
        </p>
          </div>
        )}
      </section>
        </>
      )}

      {view === 'dashboard' && (
        <>
      <section className="assignment-list" aria-live="polite">
        {groups.length > 0 ? (
          groups.map((group) => {
            const platform = store.platforms[group.platformId];
            return (
              <div className="assignment-group" key={group.key}>
                <div className="assignment-group-head">
                  <span className="group-head-left">
                    <i className={`plat-dot plat-${group.platformId}`} />
                    <span className="group-label">{PLATFORM_LABELS[group.platformId]}</span>
                    <span className="group-count">{group.assignments.length} 项</span>
                  </span>
                  <span className="group-meta">
                    {platform.lastSyncedAt ? `${formatClockOnly(platform.lastSyncedAt)} 已同步` : '未同步'}
                  </span>
                </div>
                {group.assignments.map((assignment) => {
                  const due = dueMeta(assignment);
                  return (
                    <a
                      className={`task-card plat-${assignment.platformId}`}
                      href={assignment.url}
                      target="_blank"
                      rel="noreferrer"
                      key={assignment.id}
                      title={`${assignment.title} · ${due.title}`}
                    >
                      <span className="task-ic">
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.9"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M6 3.5h9l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20V5a1.5 1.5 0 0 1 1-1.5z" />
                          <path d="M14.5 3.5V8H19M8.5 12h7M8.5 16h4.5" />
                        </svg>
                      </span>
                      <span className="task-body">
                        <strong>{assignment.title}</strong>
                        <span>
                          {assignment.courseName || PLATFORM_LABELS[assignment.platformId]} ·{' '}
                          {assignmentStatusLabel(assignment.status)}
                        </span>
                      </span>
                      <span className={`due-badge due-${due.tone}`}>{due.label}</span>
                    </a>
                  );
                })}
              </div>
            );
          })
        ) : (
          <div className="empty-state">
            <div className="empty-icon">✓</div>
            <h2>当前没有已同步的未提交作业</h2>
            <p>访问并登录东软智慧教育、批改网、iTEST 或学习通邮箱后，插件会更新对应平台。</p>
            {/* 看板为空但确有数据被隐藏时，需明确告知，否则用户会误以为“真的没有待办”。 */}
            {visibleCount === 0 && hiddenCount > 0 && (
              <p className="empty-note">
                当前 {hiddenCount} 项已被隐藏（已过期项受「自动隐藏已过期项」开关控制；
                已完成/已结束项默认隐藏）。关闭上方开关可重新显示已过期项。
              </p>
            )}
            {/* 空看板必须能自解释：区分“真的没有待办”和“同步没成功/待验证”。 */}
            <ul className="empty-platforms">
              {PLATFORM_IDS.map((platformId) => {
                const platform = store.platforms[platformId];
                return (
                  <li key={platformId}>
                    <span className={`status-dot status-${platform.status}`} />
                    <span className="empty-platform-name">{PLATFORM_LABELS[platformId]}</span>
                    <span className="empty-platform-state">{statusLabel(platform.status)}</span>
                    {platform.message && (
                      <span className="empty-platform-msg">{platform.message}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>
        </>
      )}

      {view === 'tools' && (
        <>
      <section className="log-panel" aria-label="运行日志">
        <div className="log-head">
          <span>运行日志</span>
          <button className="text-button" type="button" onClick={() => void clearLog()}>
            清空
          </button>
        </div>
        {log.length === 0 ? (
          <p className="log-empty">暂无日志</p>
        ) : (
          <ul className="log-list">
            {[...log].reverse().slice(0, 30).map((entry, idx) => (
              <li className={`log-item log-${entry.level}`} key={`${entry.ts}-${idx}`}>
                <span className="log-time">{formatLogTime(entry.ts)}</span>
                <span className="log-badge">{entry.source}</span>
                <span className="log-msg">{entry.message}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
        </>
      )}

      <footer className="footer">
        <span className="footer-live">
          <i aria-hidden="true" />
          {formatUpdatedAt(store.updatedAt)}
        </span>
        <span className="footer-actions">
          <button
            className="text-button"
            type="button"
            onClick={reloadExtension}
            title="重新加载扩展，让新构建的解析器立即生效（重载后请重新打开本弹窗）"
          >
            重载扩展
          </button>
          <span className="footer-build" title={`构建标识：${BUILD_ID}`}>
            v{formatBuildId(BUILD_ID)}
          </span>
        </span>
      </footer>
    </main>
  );
}

export default App;

import { useEffect, useMemo, useState } from 'react';
import './App.css';
import {
  countCoveredCourses,
  getAllAssignments,
  isAssignmentExpired,
  PLATFORM_IDS,
  PLATFORM_LABELS,
  type Assignment,
  type HomeworkStore,
  type PlatformId,
} from '@/src/models';
import { loadHomeworkStore, loadHideExpired, saveHideExpired } from '@/src/storage';
import { collectPageDiagnostic, type DiagnosticReport } from '@/src/diagnose';
import { loadLog, clearLog, appendLog, type LogEntry } from '@/src/log';
import { BUILD_ID } from '@/src/build';

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

// 跨课程分组：按“平台 + 课程”聚合，保持平台顺序，组内按截止时间/标题排序。
interface AssignmentGroup {
  key: string;
  label: string;
  platformId: PlatformId;
  assignments: Assignment[];
}

function groupAssignments(items: Assignment[]): AssignmentGroup[] {
  const map = new Map<string, AssignmentGroup>();
  for (const assignment of items) {
    const key = `${assignment.platformId}:${assignment.courseId}`;
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        label: assignment.courseName || assignment.courseId || '未知课程',
        platformId: assignment.platformId,
        assignments: [],
      };
      map.set(key, group);
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
  const [isRefreshing, setIsRefreshing] = useState(false);
  // 显示偏好：开启后隐藏“截止时间已过期”的未提交作业（不动缓存）。默认关闭。
  const [hideExpired, setHideExpired] = useState(false);
  const [diagnostic, setDiagnostic] = useState<string | null>(null);
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [diagnosticError, setDiagnosticError] = useState<string | null>(null);
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  // 诊断区默认收起，避免长期占用看板空间；点击“诊断当前页面”会自动展开。
  const [isDiagnosticOpen, setIsDiagnosticOpen] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);

  const refreshStore = async () => {
    setIsRefreshing(true);
    setStore(await loadHomeworkStore());
    setIsRefreshing(false);
  };

  const refreshLog = async () => {
    setLog(await loadLog());
  };

  useEffect(() => {
    void refreshStore();
    void refreshLog();
    void loadHideExpired().then(setHideExpired);

    const listener = (changes: Record<string, unknown>) => {
      if (changes['homework-store']) void refreshStore();
      if (changes['homework-activity-log']) void refreshLog();
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

    const visible = hideExpired
      ? scoped.filter((a) => !isAssignmentExpired(a.dueAt))
      : scoped;

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
      map[id] = hideExpired
        ? scoped.filter((a) => !isAssignmentExpired(a.dueAt)).length
        : scoped.length;
    }
    return map;
  }, [store, hideExpired]);

  const courseCount = store ? countCoveredCourses(store) : 0;

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

  const runDiagnostic = async () => {
    setDiagnosticError(null);
    setIsDiagnosticOpen(true);
    setIsDiagnosing(true);
    void appendLog('info', 'diagnostic', '开始诊断当前页面');
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        setDiagnosticError('未找到当前标签页。');
        setReport(null);
        void appendLog('warn', 'diagnostic', '诊断：未找到当前标签页');
        return;
      }
      // 直接把自包含扫描函数注入当前标签页执行，不依赖页面是否已注入过 content script。
      // allFrames: true —— 学习通收件箱渲染在 notice.chaoxing.com 的跨域 iframe 中，
      // 顶层文档看不到内容，必须注入到 iframe 框架本身才能抓到真实消息列表。
      const results = await browser.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: collectPageDiagnostic,
      });
      const reports = (results ?? [])
        .map((r) => r.result as DiagnosticReport | undefined)
        .filter((r): r is DiagnosticReport => Boolean(r));
      if (reports.length === 0) {
        setDiagnosticError('未能读取页面结构：请确认当前标签页是东软/批改网/iTEST/学习通邮箱 的页面。');
        setReport(null);
        void appendLog('warn', 'diagnostic', '诊断：页面未返回结构，可能不是平台页面');
        return;
      }
      // 优先采用带“考试详情抓取探测”结果的框架（收件箱列表所在，且探测已端到端执行）；
      // 否则 notice.chaoxing.com 框架；再回退到“有文本/首个”框架。
      const report =
        reports.find((r) => r.examProbe) ??
        reports.find((r) => r.hostname.includes('notice.chaoxing.com')) ??
        reports.find((r) => r.mainText) ??
        reports[0]!;
      void appendLog(
        'info',
        'diagnostic',
        `诊断：捕获 ${reports.length} 个框架${reports.length > 1 ? `，已优先采用 ${report.hostname} 的内容` : ''}`,
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
        '诊断失败：请确认当前标签页属于四个教学平台之一（东软/批改网/iTEST/学习通邮箱），并已在扩展管理页重新加载本扩展以授予“scripting”权限。',
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
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">PERSONAL WORKSPACE</p>
          <h1>作业整合看板</h1>
          <p className="subtitle">只显示平台明确标记为未提交的作业</p>
        </div>
        <button
          className="icon-button"
          type="button"
          onClick={() => void requestCurrentPageSync()}
          title="刷新当前平台"
          aria-label="刷新当前平台"
        >
          {isRefreshing ? '...' : '↻'}
        </button>
      </header>

      <section className="summary-strip" aria-label="作业摘要">
        <div>
          <span className="summary-label">未完成</span>
          <strong>{visibleCount}</strong>
          <span className="summary-suffix">项</span>
        </div>
        <div className="summary-meta">
          <span>覆盖 {courseCount} 门课程</span>
          <span>按访问平台更新</span>
          <span>缓存保存在本机</span>
        </div>
      </section>

      <nav className="filter-row" aria-label="平台筛选">
        <button
          className={filter === 'all' ? 'filter-button active' : 'filter-button'}
          type="button"
          onClick={() => setFilter('all')}
        >
          全部
          <span>{visibleCount}</span>
        </button>
        {PLATFORM_IDS.map((platformId) => (
          <button
            className={filter === platformId ? 'filter-button active' : 'filter-button'}
            type="button"
            onClick={() => setFilter(platformId)}
            key={platformId}
          >
            {PLATFORM_LABELS[platformId]}
            <span>{visibleByPlatform[platformId]}</span>
          </button>
        ))}
      </nav>

      <section className="display-options" aria-label="显示选项">
        <button
          type="button"
          role="switch"
          aria-checked={hideExpired}
          className={`toggle ${hideExpired ? 'on' : ''}`}
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
          <span className="toggle-text">自动隐藏已过期项</span>
          <span className="toggle-switch" aria-hidden="true">
            <span className="toggle-knob" />
          </span>
        </button>
        {hideExpired && hiddenCount > 0 && (
          <span className="hidden-hint">已隐藏 {hiddenCount} 项过期作业</span>
        )}
      </section>

      <section className="platform-status" aria-label="平台同步状态">
        {PLATFORM_IDS.map((platformId) => {
          const platform = store.platforms[platformId];
          return (
            <div
              className="platform-status-item"
              key={platformId}
              title={platform.message ?? undefined}
            >
              <span className={`status-dot status-${platform.status}`} />
              <span>{PLATFORM_LABELS[platformId]}</span>
              <span className="status-label">{statusLabel(platform.status)}</span>
            </div>
          );
        })}
      </section>

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
          诊断仅读取当前标签页及其内嵌 iframe 的 DOM 结构，已去除表单值、Cookie、token 等敏感信息，不会上传任何数据。用于定位作业页面结构。
        </p>
          </div>
        )}
      </section>

      <section className="assignment-list" aria-live="polite">
        {groups.length > 0 ? (
          groups.map((group) => (
            <div className="assignment-group" key={group.key}>
              <div className="assignment-group-head">
                <span className="group-label">{group.label}</span>
                <span className="group-meta">
                  {PLATFORM_LABELS[group.platformId]} · {group.assignments.length} 项
                </span>
              </div>
              {group.assignments.map((assignment) => (
                <a
                  className={`assignment-row${assignment.status === 'expired' ? ' is-expired' : ''}`}
                  href={assignment.url}
                  target="_blank"
                  rel="noreferrer"
                  key={assignment.id}
                >
                  <span className="assignment-mark" />
                  <span className="assignment-content">
                    <strong>{assignment.title}</strong>
                    <span>
                      {PLATFORM_LABELS[assignment.platformId]} ·{' '}
                      {assignment.status === 'expired' ? '已过期' : '未提交'}
                    </span>
                  </span>
                  <span className="assignment-due">{formatDate(assignment.dueAt)}</span>
                </a>
              ))}
            </div>
          ))
        ) : (
            <div className="empty-state">
              <div className="empty-icon">✓</div>
              <h2>当前没有已同步的未提交作业</h2>
              <p>访问并登录东软智慧教育、批改网、iTEST 或学习通邮箱后，插件会更新对应平台。</p>
              {/* 开了“自动隐藏已过期项”且未提交项全部过期时，需明确告知，
                  否则用户会误以为“真的没有待办”，其实是被隐藏了。 */}
              {visibleCount === 0 && hiddenCount > 0 && (
                <p className="empty-note">
                  全部 {hiddenCount} 项未提交作业均已过截止时间，已被「自动隐藏已过期项」隐藏。
                  关闭上方开关即可重新显示。
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

      <footer className="footer">
        <span>{formatUpdatedAt(store.updatedAt)}</span>
        <span className="footer-actions">
          <span title={`构建标识：${BUILD_ID}`}>构建 {formatBuildId(BUILD_ID)}</span>
          <button
            className="text-button"
            type="button"
            onClick={reloadExtension}
            title="重新加载扩展，让新构建的解析器立即生效（重载后请重新打开本弹窗）"
          >
            重载扩展
          </button>
        </span>
      </footer>

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
    </main>
  );
}

export default App;

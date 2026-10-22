import { useEffect, useMemo, useState } from 'react';
import './App.css';
import {
  getAllAssignments,
  PLATFORM_IDS,
  PLATFORM_LABELS,
  type Assignment,
  type HomeworkStore,
  type PlatformId,
} from '@/src/models';
import { loadHomeworkStore } from '@/src/storage';

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

function sortAssignments(assignments: Assignment[]): Assignment[] {
  return [...assignments].sort((a, b) => {
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
  });
}

function App() {
  const [store, setStore] = useState<HomeworkStore | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refreshStore = async () => {
    setIsRefreshing(true);
    setStore(await loadHomeworkStore());
    setIsRefreshing(false);
  };

  useEffect(() => {
    void refreshStore();

    const listener = () => {
      void refreshStore();
    };

    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, []);

  const assignments = useMemo(() => {
    if (!store) {
      return [];
    }

    const filtered =
      filter === 'all'
        ? getAllAssignments(store)
        : store.platforms[filter].assignments;

    return sortAssignments(filtered);
  }, [filter, store]);

  const activeCount = store ? getAllAssignments(store).length : 0;

  const requestCurrentPageSync = async () => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await browser.tabs.sendMessage(tab.id, { type: 'SYNC_ACTIVE_PAGE' }).catch(() => undefined);
      await refreshStore();
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
          <strong>{activeCount}</strong>
          <span className="summary-suffix">项</span>
        </div>
        <div className="summary-meta">
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
          <span>{activeCount}</span>
        </button>
        {PLATFORM_IDS.map((platformId) => (
          <button
            className={filter === platformId ? 'filter-button active' : 'filter-button'}
            type="button"
            onClick={() => setFilter(platformId)}
            key={platformId}
          >
            {PLATFORM_LABELS[platformId]}
            <span>{store.platforms[platformId].assignments.length}</span>
          </button>
        ))}
      </nav>

      <section className="platform-status" aria-label="平台同步状态">
        {PLATFORM_IDS.map((platformId) => {
          const platform = store.platforms[platformId];
          return (
            <div className="platform-status-item" key={platformId}>
              <span className={`status-dot status-${platform.status}`} />
              <span>{PLATFORM_LABELS[platformId]}</span>
              <span className="status-label">{statusLabel(platform.status)}</span>
            </div>
          );
        })}
      </section>

      <section className="assignment-list" aria-live="polite">
        {assignments.length > 0 ? (
          assignments.map((assignment) => (
            <a
              className="assignment-row"
              href={assignment.url}
              target="_blank"
              rel="noreferrer"
              key={assignment.id}
            >
              <span className="assignment-mark" />
              <span className="assignment-content">
                <strong>{assignment.title}</strong>
                <span>{PLATFORM_LABELS[assignment.platformId]} · 未提交</span>
              </span>
              <span className="assignment-due">{formatDate(assignment.dueAt)}</span>
            </a>
          ))
        ) : (
          <div className="empty-state">
            <div className="empty-icon">✓</div>
            <h2>当前没有已同步的未提交作业</h2>
            <p>访问并登录东软智慧教育、批改网或 iTEST 后，插件会更新对应平台。</p>
          </div>
        )}
      </section>

      <footer className="footer">
        <span>{formatUpdatedAt(store.updatedAt)}</span>
        <span>平台访问后自动更新</span>
      </footer>
    </main>
  );
}

export default App;

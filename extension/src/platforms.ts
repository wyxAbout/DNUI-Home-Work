import {
  PLATFORM_HOSTS,
  PLATFORM_LABELS,
  type Assignment,
  type PlatformId,
  type PlatformSyncStatus,
} from './models';

export interface PlatformExtractionResult {
  status: PlatformSyncStatus;
  assignments: Assignment[];
  message: string;
}

export interface PlatformAdapter {
  id: PlatformId;
  label: string;
  matchesUrl(url: string): boolean;
  extract(document: Document, url: string): PlatformExtractionResult;
}

function hostMatches(url: string, hosts: string[]): boolean {
  try {
    const hostname = new URL(url).hostname;
    return hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

function notReadyResult(message: string): PlatformExtractionResult {
  return {
    status: 'needs-verification',
    assignments: [],
    message,
  };
}

const adapters: PlatformAdapter[] = [
  {
    id: 'neusoft',
    label: PLATFORM_LABELS.neusoft,
    matchesUrl: (url) => hostMatches(url, PLATFORM_HOSTS.neusoft),
    extract: () => notReadyResult('东软页面解析器待验证，暂未更新已有作业数据。'),
  },
  {
    id: 'pigai',
    label: PLATFORM_LABELS.pigai,
    matchesUrl: (url) => hostMatches(url, PLATFORM_HOSTS.pigai),
    extract: () => notReadyResult('批改网页面解析器待验证，暂未更新已有作业数据。'),
  },
  {
    id: 'itest',
    label: PLATFORM_LABELS.itest,
    matchesUrl: (url) => hostMatches(url, PLATFORM_HOSTS.itest),
    extract: () => notReadyResult('iTEST 页面解析器待验证，暂未更新已有作业数据。'),
  },
];

export function getPlatformAdapter(url: string): PlatformAdapter | undefined {
  return adapters.find((adapter) => adapter.matchesUrl(url));
}

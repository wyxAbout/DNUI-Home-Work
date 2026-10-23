import {
  PLATFORM_HOSTS,
  PLATFORM_LABELS,
  type PlatformExtractionResult,
  type PlatformId,
} from './models';
import { extractNeusoftAssignments } from './neusoft';
import { extractItestAssignments } from './itest';
import { extractPigaiAssignments } from './pigai';
import { extractChaoxingAssignments } from './chaoxing';

export interface PlatformAdapter {
  id: PlatformId;
  label: string;
  matchesUrl(url: string): boolean;
  // 返回 null 表示“当前页面与作业无关”，调用方应静默跳过（不更新缓存）。
  extract(
    document: Document,
    url: string,
    options: { allowAutoOpen: boolean },
  ): Promise<PlatformExtractionResult | null> | PlatformExtractionResult | null;
}

function hostMatches(url: string, hosts: string[]): boolean {
  try {
    const hostname = new URL(url).hostname;
    return hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

const adapters: PlatformAdapter[] = [
  {
    id: 'neusoft',
    label: PLATFORM_LABELS.neusoft,
    matchesUrl: (url) => hostMatches(url, PLATFORM_HOSTS.neusoft),
    extract: (document, url, options) => extractNeusoftAssignments(document, url, options),
  },
  {
    id: 'pigai',
    label: PLATFORM_LABELS.pigai,
    matchesUrl: (url) => hostMatches(url, PLATFORM_HOSTS.pigai),
    extract: (document, url, options) => extractPigaiAssignments(document, url, options),
  },
  {
    id: 'itest',
    label: PLATFORM_LABELS.itest,
    matchesUrl: (url) => hostMatches(url, PLATFORM_HOSTS.itest),
    extract: (document, url, options) => extractItestAssignments(document, url, options),
  },
  {
    id: 'chaoxing',
    label: PLATFORM_LABELS.chaoxing,
    matchesUrl: (url) => hostMatches(url, PLATFORM_HOSTS.chaoxing),
    extract: (document, url, options) => extractChaoxingAssignments(document, url, options),
  },
];

export function getPlatformAdapter(url: string): PlatformAdapter | undefined {
  return adapters.find((adapter) => adapter.matchesUrl(url));
}

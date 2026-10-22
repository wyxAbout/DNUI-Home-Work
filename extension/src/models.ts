export type PlatformId = 'neusoft' | 'pigai' | 'itest';

export type PlatformSyncStatus =
  | 'never'
  | 'success'
  | 'login-required'
  | 'needs-verification'
  | 'error';

export interface Assignment {
  id: string;
  platformId: PlatformId;
  title: string;
  dueAt: string | null;
  url: string;
  status: 'unsubmitted';
  syncedAt: string;
}

export interface PlatformSnapshot {
  platformId: PlatformId;
  status: PlatformSyncStatus;
  assignments: Assignment[];
  lastSyncedAt: string | null;
  lastVisitedUrl: string | null;
  message: string | null;
}

export interface HomeworkStore {
  platforms: Record<PlatformId, PlatformSnapshot>;
  updatedAt: string | null;
}

export const PLATFORM_IDS: PlatformId[] = ['neusoft', 'pigai', 'itest'];

export const PLATFORM_LABELS: Record<PlatformId, string> = {
  neusoft: '东软智慧教育',
  pigai: '批改网',
  itest: 'iTEST',
};

export const PLATFORM_HOSTS: Record<PlatformId, string[]> = {
  neusoft: ['study.neusoft.edu.cn'],
  pigai: ['pigai.org', 'www.pigai.org'],
  itest: ['sso.unipus.cn', 'itestcloud.unipus.cn'],
};

export function createEmptyStore(): HomeworkStore {
  return {
    platforms: {
      neusoft: createEmptySnapshot('neusoft'),
      pigai: createEmptySnapshot('pigai'),
      itest: createEmptySnapshot('itest'),
    },
    updatedAt: null,
  };
}

export function createEmptySnapshot(platformId: PlatformId): PlatformSnapshot {
  return {
    platformId,
    status: 'never',
    assignments: [],
    lastSyncedAt: null,
    lastVisitedUrl: null,
    message: null,
  };
}

export function getAllAssignments(store: HomeworkStore): Assignment[] {
  return PLATFORM_IDS.flatMap((platformId) => store.platforms[platformId].assignments);
}

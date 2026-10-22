import {
  createEmptyStore,
  type HomeworkStore,
  type PlatformId,
  type PlatformSnapshot,
} from './models';

const STORE_KEY = 'homework-store';

export async function loadHomeworkStore(): Promise<HomeworkStore> {
  const result = await browser.storage.local.get(STORE_KEY);
  const stored = result[STORE_KEY] as Partial<HomeworkStore> | undefined;
  const empty = createEmptyStore();

  if (!stored?.platforms) {
    return empty;
  }

  return {
    platforms: {
      neusoft: stored.platforms.neusoft ?? empty.platforms.neusoft,
      pigai: stored.platforms.pigai ?? empty.platforms.pigai,
      itest: stored.platforms.itest ?? empty.platforms.itest,
    },
    updatedAt: stored.updatedAt ?? null,
  };
}

export async function saveHomeworkStore(store: HomeworkStore): Promise<void> {
  await browser.storage.local.set({ [STORE_KEY]: store });
}

export async function updatePlatformSnapshot(
  platformId: PlatformId,
  update: Partial<PlatformSnapshot>,
): Promise<HomeworkStore> {
  const store = await loadHomeworkStore();
  const current = store.platforms[platformId];

  const next: HomeworkStore = {
    ...store,
    platforms: {
      ...store.platforms,
      [platformId]: {
        ...current,
        ...update,
      },
    },
    updatedAt: new Date().toISOString(),
  };

  await saveHomeworkStore(next);
  return next;
}

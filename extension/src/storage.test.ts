// 存储开关默认值测试：storage.ts 仅在函数体内访问全局 browser，
// 这里注入一个最小化的 memory 实现即可，无需真实扩展环境。
import { test } from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map<string, unknown>();
const fakeStorage = {
  local: {
    get: async (key: string) =>
      mem.has(key) ? { [key]: mem.get(key) } : {},
    set: async (obj: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(obj)) mem.set(k, v);
    },
  },
};
// 在 storage.ts 的函数被调用前把 browser 挂到全局（模块加载时不会触碰 browser）。
(globalThis as unknown as { browser: unknown }).browser = { storage: fakeStorage };

const { loadShowPageBadge, saveShowPageBadge } = await import('./storage.ts');

test('loadShowPageBadge：未设置时默认开启', async () => {
  mem.clear();
  assert.equal(await loadShowPageBadge(), true);
});

test('loadShowPageBadge：仅显式 false 才关闭，true 开启', async () => {
  mem.clear();
  await saveShowPageBadge(false);
  assert.equal(await loadShowPageBadge(), false);
  await saveShowPageBadge(true);
  assert.equal(await loadShowPageBadge(), true);
});

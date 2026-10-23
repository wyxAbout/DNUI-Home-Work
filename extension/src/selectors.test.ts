// 选择器配置与“失效显式报错”契约测试（反馈 2.3）。
// 运行：node --experimental-strip-types --test src/selectors.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLATFORM_SELECTOR_CONFIG,
  SELECTORS_VERSION,
  SelectorError,
  requireSelector,
} from './selectors.ts';

// 轻量假 Document：仅实现 querySelector，按命中集合返回真值/假值。
function fakeDoc(hits: string[]): Document {
  const set = new Set(hits);
  return {
    querySelector: (sel: string) => (set.has(sel) ? ({}) : null),
  } as unknown as Document;
}

test('requireSelector：选择器命中时不抛错', () => {
  assert.doesNotThrow(() =>
    requireSelector(fakeDoc(['li.dataBody_item']), 'li.dataBody_item', 'chaoxing', '测试'),
  );
});

test('requireSelector：选择器缺失时抛 SelectorError（含平台与选择器名）', () => {
  let err: unknown;
  try {
    requireSelector(fakeDoc([]), 'li.dataBody_item', 'chaoxing', '收件箱列表未渲染');
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof SelectorError);
  assert.equal((err as SelectorError).platformId, 'chaoxing');
  assert.equal((err as SelectorError).selector, 'li.dataBody_item');
  assert.match((err as Error).message, /li\.dataBody_item/);
});

test('PLATFORM_SELECTOR_CONFIG：各平台关键选择器与现有解析逻辑保持一致（防回归）', () => {
  // 这些字符串是生产解析器的命脉；一旦改版调整，应在此同步更新并 bump SELECTORS_VERSION。
  assert.equal(PLATFORM_SELECTOR_CONFIG.chaoxing.item, 'li.dataBody_item');
  assert.equal(PLATFORM_SELECTOR_CONFIG.chaoxing.fields.title, '.notice_title');
  assert.equal(PLATFORM_SELECTOR_CONFIG.chaoxing.fields.detailUrlAttr, 'data-url');
  assert.equal(PLATFORM_SELECTOR_CONFIG.neusoft.fields.emptyMarker, '.el-empty, .neu-empty, .no-data-content, .noData, .data-empty');
  assert.equal(PLATFORM_SELECTOR_CONFIG.neusoft.fields.contentWrap, '.v-content-wrap');
  assert.equal(PLATFORM_SELECTOR_CONFIG.pigai.fields.listHeader, '#essayList');
  assert.equal(PLATFORM_SELECTOR_CONFIG.pigai.fields.statusTab, 'li.showST');
  assert.equal(PLATFORM_SELECTOR_CONFIG.itest.fields.classInfo, '[class*="stuClsInfo"]');
  assert.equal(typeof SELECTORS_VERSION, 'number');
});

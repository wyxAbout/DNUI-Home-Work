// 批改网作业解析器单元测试（基于用户贴回的已核实诊断样本，2026-10-23）。
// 运行：node --experimental-strip-types --test src/pigai.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapPigaiAssignments,
  parsePigaiEssayText,
  toPigaiIso,
} from './pigai.ts';

// 真实诊断样本重组：导航/页脚含“我的作文/题库作文/自测作文/作文大赛”等干扰词，
// 表头为固定七列，其下为 3 条真实作业行（B2U6 / B2U5 / B1U2）。
const SAMPLE =
  '王云贤(165分) 消息 皮肤 退出 我的作文 自测 班级 题库 精彩活动 名师闪批 New 全屏版 ' +
  '已完成 未完成 我的题库 我的自测 我的默写 句子训练 听写练习 阅读理解 题库作文 自测作文 ' +
  '作业号 作业标题 类型 出题人 指定班级 截止时间 操作 ' +
  '3443402 25级B层次大英I（三）- B2U6 作文 王宁 25级计科B4班,25级物联网、网络、网安B班,25级微电子、集成B1班 2026-11-16 23:59 查看 ' +
  '3435112 25级B层次大英I（三）- B2U5 作文 王宁 25级计科B4班,25级物联网B班 2026-10-19 23:59 查看 ' +
  '3296854 25级B层次B1U2-写作-The Importance and Methods of Learning a... 作文 王宁 25级物联网B班 2025-11-10 23:59 查看 ' +
  '作文大赛 写作联盟 手机版 体验新版 批改卡充值 精彩活动';

test('解析真实样本：精确命中 3 条未完成作业，不误命中导航/页脚的“作文”', () => {
  const items = parsePigaiEssayText(SAMPLE);
  assert.equal(items.length, 3);

  assert.deepEqual(
    items.map((i) => ({ num: i.assignmentNumber, title: i.title, dueAt: i.dueAt })),
    [
      {
        num: '3443402',
        title: '25级B层次大英I（三）- B2U6',
        dueAt: '2026-11-16T23:59:00',
      },
      {
        num: '3435112',
        title: '25级B层次大英I（三）- B2U5',
        dueAt: '2026-10-19T23:59:00',
      },
      {
        num: '3296854',
        title: '25级B层次B1U2-写作-The Importance and Methods of Learning a...',
        dueAt: '2025-11-10T23:59:00',
      },
    ],
  );

  // 平台“未完成”视图里的每一行都视为未提交（含已过期但仍被平台保留的第 3 条）。
  assert.deepEqual(
    items.map((i) => i.status),
    ['unsubmitted', 'unsubmitted', 'unsubmitted'],
  );
});

test('截止时间文本 → 本地时间 ISO（含/不含秒）', () => {
  assert.equal(toPigaiIso('2026-11-16 23:59'), '2026-11-16T23:59:00');
  assert.equal(toPigaiIso('2025-11-10 23:59:00'), '2025-11-10T23:59:00');
  assert.equal(toPigaiIso('不是时间'), null);
  assert.equal(toPigaiIso(''), null);
});

test('无作业行时返回空数组（仅导航/页脚，无 6+ 位数字+作文+截止时间 结构）', () => {
  assert.deepEqual(parsePigaiEssayText('我的作文 已完成 题库作文 自测作文 作文大赛'), []);
  assert.deepEqual(parsePigaiEssayText('作业号 作业标题 类型 出题人 指定班级 截止时间 操作'), []);
});

test('映射到 Assignment：id/平台/课程/状态/来源正确，深链优先用逐项 href', () => {
  const items = parsePigaiEssayText(SAMPLE);
  const urls = new Map<string, string>([
    ['3443402', 'https://www.pigai.org/index.php?act=stu_work&workid=3443402'],
    ['3435112', 'https://www.pigai.org/index.php?act=stu_work&workid=3435112'],
    ['3296854', 'https://www.pigai.org/index.php?act=stu_work&workid=3296854'],
  ]);
  const assignments = mapPigaiAssignments(items, {
    url: 'https://www.pigai.org/index.php',
    syncedAt: '2026-10-23T00:35:31.000Z',
    urls,
  });

  assert.equal(assignments.length, 3);
  const a0 = assignments.find((a) => a.id === 'pigai:3443402');
  assert.ok(a0);
  assert.equal(a0?.platformId, 'pigai');
  assert.equal(a0?.courseId, 'pigai');
  assert.equal(a0?.courseName, '批改网');
  assert.equal(a0?.title, '25级B层次大英I（三）- B2U6');
  assert.equal(a0?.dueAt, '2026-11-16T23:59:00');
  assert.equal(a0?.status, 'unsubmitted');
  assert.equal(a0?.source, 'home');
  assert.equal(a0?.url, 'https://www.pigai.org/index.php?act=stu_work&workid=3443402');
  assert.equal(a0?.syncedAt, '2026-10-23T00:35:31.000Z');
});

test('逐项深链缺失时回退到列表页 URL', () => {
  const items = parsePigaiEssayText(SAMPLE);
  const assignments = mapPigaiAssignments(items, {
    url: 'https://www.pigai.org/index.php',
    syncedAt: '2026-10-23T00:35:31.000Z',
    urls: new Map(),
  });
  assert.equal(assignments.length, 3);
  assert.equal(
    assignments.every((a) => a.url === 'https://www.pigai.org/index.php'),
    true,
  );
});

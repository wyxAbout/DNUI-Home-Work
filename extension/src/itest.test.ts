// iTEST 考试解析器单元测试（基于用户贴回的已核实诊断样本，2026-10-22）。
// 运行：node --experimental-strip-types --test src/itest.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyItestStatus,
  mapItestAssignments,
  parseItestExamPageText,
  type ParsedItestItem,
} from './itest.ts';

// 真实诊断样本（itestcloud.unipus.cn/utest/itest/s/exam 的 body.innerText 去敏后）。
const SAMPLE =
  '考试 训练 比赛 我的班级 王云贤 全部考试 12 待完成 2 已完成 10 诊断报告 0 ' +
  '我的班级 25级软工、数据科学B2班 查看更多 待完成 已完成 全部考试类型 考试标签 搜 索 ' +
  '日常 26-27-1大学英语I（三）单元作业-新标准B2U6（ID：1000107669） ' +
  '学校考试 进入考试 考试已开始，请进入作答 考试终端：电脑浏览器云平台客户端 考试总分：120分 考试时长：999分钟 ' +
  '进入时间：2026-10-19 04:15:00 - 2026-11-16 23:55:00 考试地点：-- ' +
  '日常 26-27-1大学英语I（三）单元作业-新标准B2U5（ID：1000106858） ' +
  '学校考试 缺考 考试已结束，无法参加考试 考试终端：电脑浏览器云平台客户端 考试总分：120分 考试时长：999分钟 ' +
  '进入时间：2026-09-21 00:00:00 - 2026-10-19 23:55:00 考试地点：-- ' +
  '共 2 条 1 5 条/页';

test('解析真实样本：定位两条考试并提取标题/ID/类型/截止时间', () => {
  const { pendingCount, items } = parseItestExamPageText(SAMPLE);
  assert.equal(items.length, 2);
  assert.equal(pendingCount, 2);

  assert.deepEqual(
    items.map((i) => ({ title: i.title, examId: i.examId, type: i.type, tag: i.tag })),
    [
      {
        title: '26-27-1大学英语I（三）单元作业-新标准B2U6',
        examId: '1000107669',
        type: '学校考试',
        tag: '日常',
      },
      {
        title: '26-27-1大学英语I（三）单元作业-新标准B2U5',
        examId: '1000106858',
        type: '学校考试',
        tag: '日常',
      },
    ],
  );

  // 截止时间取“进入时间”窗口的结束时刻，并转为本地时间 ISO。
  assert.equal(items[0]?.dueAt, '2026-11-16T23:55:00');
  assert.equal(items[1]?.dueAt, '2026-10-19T23:55:00');
});

test('状态分类：仍可作答 vs 缺考 vs 已完成', () => {
  assert.equal(
    classifyItestStatus('学校考试 进入考试 考试已开始，请进入作答 考试终端：…'),
    'pending',
  );
  assert.equal(
    classifyItestStatus('学校考试 缺考 考试已结束，无法参加考试 考试终端：…'),
    'absent',
  );
  assert.equal(
    classifyItestStatus('学校考试 考试已结束，成绩已出 考试终端：…'),
    'done',
  );
  // 无法判定时回退 unknown（保守：不误判为未提交）。
  assert.equal(classifyItestStatus('学校考试 考试终端：…'), 'unknown');
});

test('未提交集合 = pending + absent，与“待完成”汇总一致', () => {
  const { pendingCount, items } = parseItestExamPageText(SAMPLE);
  const nonDone = items.filter((i) => i.status === 'pending' || i.status === 'absent');
  assert.equal(nonDone.length, 2);
  assert.equal(
    nonDone.map((i) => i.status).sort().join(','),
    'absent,pending',
  );
  assert.equal(nonDone.length, pendingCount);
});

test('映射到 Assignment：pending 与 absent 都进入未完成，absent 标记为 expired', () => {
  const { items } = parseItestExamPageText(SAMPLE);
  const assignments = mapItestAssignments(items, {
    courseId: '25级软工_数据科学B2班',
    courseName: '25级软工、数据科学B2班',
    url: 'https://itestcloud.unipus.cn/utest/itest/s/exam',
    syncedAt: '2026-10-22T00:00:00.000Z',
  });

  // 真实样本里 B2U6 为可作答的 pending，B2U5 已缺考（absent）。
  // 用户要求“已过期任务重新显现”，故两项都应出现，且缺考项标记为 expired。
  assert.equal(assignments.length, 2);
  const aPending = assignments.find((a) => a.id === 'itest:1000107669');
  assert.ok(aPending);
  assert.equal(aPending?.platformId, 'itest');
  assert.equal(aPending?.courseId, '25级软工_数据科学B2班');
  assert.equal(aPending?.courseName, '25级软工、数据科学B2班');
  assert.equal(aPending?.title, '26-27-1大学英语I（三）单元作业-新标准B2U6');
  assert.equal(aPending?.dueAt, '2026-11-16T23:55:00');
  assert.equal(aPending?.status, 'unsubmitted');
  assert.equal(aPending?.source, 'home');
  assert.equal(aPending?.url, 'https://itestcloud.unipus.cn/utest/itest/s/exam');

  const aExpired = assignments.find((a) => a.id === 'itest:1000106858');
  assert.ok(aExpired);
  assert.equal(aExpired?.title, '26-27-1大学英语I（三）单元作业-新标准B2U5');
  assert.equal(aExpired?.dueAt, '2026-10-19T23:55:00');
  assert.equal(aExpired?.status, 'expired');
});

test('absent（已错过截止时间）项进入未完成并标记为 expired', () => {
  const items: ParsedItestItem[] = [
    { examId: '1', title: '仍可作答', type: null, tag: null, dueAt: null, status: 'pending' },
    { examId: '2', title: '已错过', type: null, tag: null, dueAt: null, status: 'absent' },
  ];
  const assignments = mapItestAssignments(items, {
    courseId: 'c1',
    courseName: 'C1',
    url: 'https://itestcloud.unipus.cn/utest/itest/s/exam',
    syncedAt: '2026-10-22T00:00:00.000Z',
  });
  assert.equal(assignments.length, 2);
  assert.equal(assignments[0]?.status, 'unsubmitted');
  assert.equal(assignments[1]?.status, 'expired');
});

test('仍可作答项（pending）无 examId 时回退到标题 slug 作为稳定 ID', () => {
  const fallback: ParsedItestItem[] = [
    { examId: null, title: '某单元测试', type: null, tag: null, dueAt: null, status: 'pending' },
  ];
  const assignments = mapItestAssignments(fallback, {
    courseId: 'c1',
    courseName: 'C1',
    url: 'https://itestcloud.unipus.cn/utest/itest/s/exam',
    syncedAt: '2026-10-22T00:00:00.000Z',
  });
  assert.equal(assignments.length, 1);
  assert.equal(assignments[0]?.id, 'itest:某单元测试');
  assert.equal(assignments[0]?.status, 'unsubmitted');
});

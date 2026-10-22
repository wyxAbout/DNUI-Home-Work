// 跨课程聚合的纯逻辑单元测试（无浏览器依赖）。
// 运行：node --experimental-strip-types --test src/models.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyStore,
  mergeAssignmentsByCourse,
  dedupeAssignments,
  countCoveredCourses,
  type Assignment,
} from './models.ts';

function mk(
  id: string,
  courseId: string,
  courseName: string,
  title = id,
  dueAt: string | null = null,
  source: 'home' | 'course' = 'course',
): Assignment {
  return {
    id,
    platformId: 'neusoft',
    courseId,
    courseName,
    title,
    dueAt,
    url: 'https://study.neusoft.edu.cn/course/' + courseId,
    status: 'unsubmitted',
    syncedAt: '2026-10-22T00:00:00.000Z',
    source,
  };
}

test('按课程合并：替换同一课程旧作业，保留其它课程', () => {
  const existing = [
    mk('neusoft:A:01', 'A', '课程A'),
    mk('neusoft:A:02', 'A', '课程A'),
    mk('neusoft:B:01', 'B', '课程B'),
  ];
  const incoming = [mk('neusoft:A:03', 'A', '课程A')];

  const merged = mergeAssignmentsByCourse(existing, incoming, ['A']);

  // A 课程的旧项被替换，仅留下新的 A 项；B 课程原样保留。
  assert.deepEqual(
    merged.map((a) => a.id).sort(),
    ['neusoft:A:03', 'neusoft:B:01'],
  );
});

test('合并范围缺省时按本次作业所属课程推导，其它课程仍保留', () => {
  const existing = [mk('neusoft:A:01', 'A', '课程A'), mk('neusoft:B:01', 'B', '课程B')];
  const incoming = [mk('neusoft:B:02', 'B', '课程B')];

  const merged = mergeAssignmentsByCourse(existing, incoming);

  assert.deepEqual(
    merged.map((a) => a.id).sort(),
    ['neusoft:A:01', 'neusoft:B:02'],
  );
});

test('两条来源（首页 / 课程详情页）：同标题沿用信息更完整来源的课程归属，不产生重复分组', () => {
  // 已缓存：来自首页“我的学习任务”，按课程名 slug，带截止时间。
  const existing = [
    mk(
      'neusoft:home:ai:1',
      '人工智能通识',
      '人工智能通识',
      '人工智能基础篇：计算机视觉基础与图像识别原理',
      '2026-10-27T23:59:59',
      'home',
    ),
  ];
  // 本次：来自课程详情页，按 URL 数字 id，无截止时间。
  const incoming = [
    mk(
      'neusoft:350241:01',
      '350241',
      '350241',
      '人工智能基础篇：计算机视觉基础与图像识别原理',
      null,
    ),
  ];

  const merged = mergeAssignmentsByCourse(existing, incoming, ['350241']);

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.courseName, '人工智能通识');
  assert.equal(merged[0]?.dueAt, '2026-10-27T23:59:59');
});

test('首页同步：清理已不在首页列表的旧首页条目，保留课程详情页来源条目', () => {
  const existing = [
    mk('h1', 'C1', '课程1', '作业一', '2026-12-11T23:59:59', 'home'),
    mk('h2', 'C2', '课程2', '作业二', '2026-12-11T23:59:59', 'home'),
    mk('d1', 'C3', '课程3', '作业三', null, 'course'),
  ];
  // 本次首页只剩 C1：C2 的作业已全部完成 → 旧条目应被清理；C3 来自课程详情页，不受影响。
  const incoming = [mk('h1b', 'C1', '课程1', '作业一', '2026-12-11T23:59:59', 'home')];

  const merged = mergeAssignmentsByCourse(existing, incoming, ['C1']);

  assert.deepEqual(
    merged.map((a) => a.id).sort(),
    ['d1', 'h1b'],
  );
});

test('去重：同平台同课程同标题只保留一条，有截止时间者优先', () => {
  const items = [
    mk('a', 'C1', '课程1', '同一作业', null),
    mk('b', 'C1', '课程1', '同一作业', '2026-10-27T23:59:59'),
    mk('c', 'C1', '课程1', '另一作业', null),
  ];

  const deduped = dedupeAssignments(items);

  assert.deepEqual(deduped.map((a) => a.id).sort(), ['b', 'c']);
});

test('跨平台与跨课程：countCoveredCourses 统计唯一组合', () => {
  const store = createEmptyStore();
  store.platforms.neusoft.assignments = [
    mk('neusoft:A:01', 'A', '课程A'),
    mk('neusoft:A:02', 'A', '课程A'),
    mk('neusoft:B:01', 'B', '课程B'),
  ];
  store.platforms.pigai.assignments = [mk('pigai:X:01', 'X', '批改网课X')];

  assert.equal(countCoveredCourses(store), 3);
});

// 跨课程聚合的纯逻辑单元测试（无浏览器依赖）。
// 运行：node --experimental-strip-types --test src/models.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyStore,
  mergeAssignmentsByCourse,
  dedupeAssignments,
  countCoveredCourses,
  isAssignmentExpired,
  isAssignmentExpiredByStatus,
  isAssignmentVisible,
  assignmentStatusLabel,
  isAssignmentHiddenByDefault,
  PLATFORM_HOME,
  PLATFORM_IDS,
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

// 学习通一门课会分两页上报（任务列表 / 作业·考试列表），两次的课程作用域完全相同。
// 若合并时不区分页面种类，先到的任务页会把作业页刚写入的条目整批清掉
// —— 这正是「逐课同步全部成功，但看板没有作业」的成因，必须有回归测试盯住。
const KEY = '259363438-139380153';

function mkChaoxing(id: string, title: string): Assignment {
  return {
    id,
    platformId: 'chaoxing',
    courseId: '25数据科学34',
    courseName: '25数据科学34',
    title,
    dueAt: null,
    url: 'https://mooc1.chaoxing.com/exam-ans/mooc2/exam/exam-list',
    status: 'unsubmitted',
    syncedAt: '2026-10-29T00:00:00.000Z',
    source: 'course',
  };
}

test('学习通分页合并：任务页只替换任务项，不波及作业页已写入的作业', () => {
  const taskOld = mkChaoxing(`chaoxing:${KEY}:task:t1`, '签到·普通签到');
  const exam = mkChaoxing(`chaoxing:${KEY}:exam:e1`, '作业·线代作业3');
  const taskNew = mkChaoxing(`chaoxing:${KEY}:task:t2`, '选人·选人');

  // 先有「任务 + 作业」两页的数据（作业页先成功过）。
  const merged = mergeAssignmentsByCourse(
    [taskOld, exam],
    [taskNew],
    [KEY],
    { kind: 'task' },
  );

  // 任务项被替换，作业项必须原样保留。
  assert.deepEqual(
    merged.map((a) => a.id).sort(),
    [exam.id, taskNew.id].sort(),
  );
});

test('学习通分页合并：作业页只替换作业项，不波及任务项', () => {
  const task = mkChaoxing(`chaoxing:${KEY}:task:t1`, '签到·普通签到');
  const examOld = mkChaoxing(`chaoxing:${KEY}:exam:e1`, '作业·线代作业3');
  const examNew = mkChaoxing(`chaoxing:${KEY}:exam:e2`, '测验·线代测验4');

  const merged = mergeAssignmentsByCourse(
    [task, examOld],
    [examNew],
    [KEY],
    { kind: 'exam' },
  );

  assert.deepEqual(
    merged.map((a) => a.id).sort(),
    [task.id, examNew.id].sort(),
  );
});

test('学习通分页合并：不传 kind 时保持旧行为（整门课一起清）', () => {
  const task = mkChaoxing(`chaoxing:${KEY}:task:t1`, '签到·普通签到');
  const exam = mkChaoxing(`chaoxing:${KEY}:exam:e1`, '作业·线代作业3');

  const merged = mergeAssignmentsByCourse([task, exam], [], [KEY]);

  assert.deepEqual(merged, []);
});

test('学习通分页合并：无种类段的旧条目仍按课程作用域清理（不被 kind 漏掉）', () => {
  // 收件箱来源的 id 是 `chaoxing:<课程名>:homework:*`，没有 task/exam 段。
  const legacy = mkChaoxing('chaoxing:25数据科学34:homework:h1', '考试·线代期末');
  const taskNew = mkChaoxing(`chaoxing:${KEY}:task:t1`, '签到·普通签到');

  const merged = mergeAssignmentsByCourse([legacy], [taskNew], [KEY], { kind: 'task' });

  // 旧条目 id 里的课程键是课程名，不在本作用域内，因此保留；
  // 这条断言锁定“kind 不会把无关条目误删”这一侧。
  assert.deepEqual(merged.map((a) => a.id).sort(), [legacy.id, taskNew.id].sort());
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

test('isAssignmentExpired：无截止时间或无法解析的均视为未过期', () => {
  assert.equal(isAssignmentExpired(null), false);
  assert.equal(isAssignmentExpired(''), false);
  assert.equal(isAssignmentExpired('不是时间'), false);
  assert.equal(isAssignmentExpired('2026-13-99 99:99'), false);
});

test('isAssignmentExpired：明显早于此刻的截止时间视为已过期', () => {
  assert.equal(isAssignmentExpired('2000-01-01T00:00:00'), true);
  assert.equal(isAssignmentExpired('2020-06-15T23:59:59'), true);
});

test('isAssignmentExpired：明显晚于此刻的截止时间视为未过期', () => {
  assert.equal(isAssignmentExpired('2099-12-31T23:59:59'), false);
  assert.equal(isAssignmentExpired('2999-01-01T00:00:00'), false);
});

// 判定表（用户 2026-10-25 最终确认）：状态 → 看板标签 / 是否默认隐藏。
test('assignmentStatusLabel：中文标签与判定表一致', () => {
  assert.equal(assignmentStatusLabel('unsubmitted'), '未提交');
  assert.equal(assignmentStatusLabel('in_progress'), '进行中');
  assert.equal(assignmentStatusLabel('submitted'), '已提交');
  // 用户拍板：任务页“已结束”直接判定为已完成（不是“已结束”）。
  assert.equal(assignmentStatusLabel('ended'), '已完成');
  assert.equal(assignmentStatusLabel('completed'), '已完成');
  assert.equal(assignmentStatusLabel('returned'), '需重交');
  assert.equal(assignmentStatusLabel('retake'), '已完成（可重考）');
  assert.equal(assignmentStatusLabel('expired'), '已过期');
});

test('isAssignmentHiddenByDefault：仅 completed/ended 默认隐藏，需重交与可重考必须显示', () => {
  // 已结束（= 已完成）与已完成都默认隐藏。
  assert.equal(isAssignmentHiddenByDefault('ended'), true);
  assert.equal(isAssignmentHiddenByDefault('completed'), true);
  // 这两类必须显示，不能被隐藏逻辑吞掉。
  assert.equal(isAssignmentHiddenByDefault('returned'), false);
  assert.equal(isAssignmentHiddenByDefault('retake'), false);
  assert.equal(isAssignmentHiddenByDefault('in_progress'), false);
  assert.equal(isAssignmentHiddenByDefault('unsubmitted'), false);
  // 已过期受独立开关控制，不属于“默认隐藏”。
  assert.equal(isAssignmentHiddenByDefault('expired'), false);
});

// 2026-10-29 修改意见·问题 2：平台已明确标记“已过期”的条目，即使缺截止时间也要判为已过期，
// 否则“自动隐藏已过期项”开关对它无效，看板里会一直显示“未提供截止时间”。
test('isAssignmentExpiredByStatus：状态为 expired 时缺截止时间也算已过期', () => {
  assert.equal(isAssignmentExpiredByStatus('expired', null), true);
  assert.equal(isAssignmentExpiredByStatus('expired', ''), true);
  assert.equal(isAssignmentExpiredByStatus('expired', '2099-12-31T23:59:59'), true);
  // 非 expired 状态仍按截止时间判定：缺截止时间视为未过期。
  assert.equal(isAssignmentExpiredByStatus('unsubmitted', null), false);
  assert.equal(isAssignmentExpiredByStatus('unsubmitted', '2000-01-01T00:00:00'), true);
  assert.equal(isAssignmentExpiredByStatus('in_progress', null), false);
});

// 看板“是否可见”的统一判定：后台角标/通知与弹窗看板必须共用同一套口径，
// 否则会出现“角标 58、看板 19”这类数字对不上的问题（2026-10-29 修改意见·问题 1）。
test('isAssignmentVisible：与看板同口径——排除 completed/ended，开关开启时排除已过期', () => {
  const base = (status: Assignment['status'], dueAt: string | null = null): Assignment => ({
    ...mk('x', 'c', '课程', '标题', dueAt, 'course'),
    status,
  });

  // 默认（不开开关）：completed/ended 隐藏，其余可见。
  assert.equal(isAssignmentVisible(base('completed'), { hideExpired: false }), false);
  assert.equal(isAssignmentVisible(base('ended'), { hideExpired: false }), false);
  assert.equal(isAssignmentVisible(base('unsubmitted'), { hideExpired: false }), true);
  assert.equal(isAssignmentVisible(base('returned'), { hideExpired: false }), true);
  // 未过期但开关开着：仍可见。
  assert.equal(isAssignmentVisible(base('unsubmitted', '2099-01-01T00:00:00'), { hideExpired: true }), true);
  // 已过期（dueAt 已过）且开关开着：隐藏。
  assert.equal(isAssignmentVisible(base('unsubmitted', '2000-01-01T00:00:00'), { hideExpired: true }), false);
  // 平台标 expired 但无截止时间，开关开着：隐藏（问题 2 的关键修复）。
  assert.equal(isAssignmentVisible(base('expired', null), { hideExpired: true }), false);
  // 平台标 expired 但无截止时间，开关关着：仍可见（与看板保持一致，开关不强制）。
  assert.equal(isAssignmentVisible(base('expired', null), { hideExpired: false }), true);
});

// ============================================================================
// 学习通任务页的合并作用域（2026-10-29 修复）
// 背景：任务页解析结果里 assignment.courseId 是**课程名 slug**（保证与收件箱同课程
// 在看板只出现一个分组），而合并作用域 courseIds 是**稳定的 courseid-clazzid**。
// 旧实现只比对 courseId，两者永不相等 → 单课程合并实际没生效：
// ① 活动从「进行中」滑到「已结束」后旧条目残留（看板一直显示进行中）；
// ② 教师删除活动后旧条目永不消失。
// 修复：额外用作业项 id 中内嵌的 `:<courseKey>:` 做边界匹配。
// ============================================================================
const CX_KEY = '259363438-139380153';

function cx(id: string, courseName: string, title: string, status: Assignment['status'] = 'in_progress') {
  return {
    ...mk(id, courseName, courseName, title),
    platformId: 'chaoxing' as const,
    status,
  };
}

test('学习通任务合并：scope 为 courseid-clazzid 时能替换按课程名分组的旧条目', () => {
  const existing = [
    cx(`chaoxing:${CX_KEY}:task:aaa`, '25数据科学34', '签到·普通签到（05-20 08:06）'),
    cx(`chaoxing:${CX_KEY}:task:bbb`, '25数据科学34', '任务·课堂投票（12-30 23:59）'),
    cx('chaoxing:266109891-152005723:task:ccc', '数科25003', '作业·数据库（11-01 23:59）', 'unsubmitted'),
  ];
  // 第二次同步：课堂投票已结束；签到那条已被教师删除（不在本次结果里）。
  const incoming = [cx(`chaoxing:${CX_KEY}:task:bbb`, '25数据科学34', '任务·课堂投票（12-30 23:59）', 'ended')];

  const merged = mergeAssignmentsByCourse(existing, incoming, [CX_KEY]);

  assert.deepEqual(
    merged.map((a) => a.id).sort(),
    [`chaoxing:${CX_KEY}:task:bbb`, 'chaoxing:266109891-152005723:task:ccc'].sort(),
  );
  // 状态变化能落到缓存（不再残留“进行中”的旧副本）。
  assert.equal(merged.find((a) => a.id.endsWith('bbb'))!.status, 'ended');
  // 已删除的活动不残留。
  assert.equal(merged.some((a) => a.id.endsWith('aaa')), false);
  // 其它课程不受影响。
  assert.equal(merged.some((a) => a.id.endsWith('ccc')), true);
});

test('学习通任务合并：课程键按 :key: 边界匹配，前缀相近的课程不会被误清', () => {
  // 2593634 是 259363438 的前缀，朴素 includes 会把两门课混为一谈。
  const other = cx('chaoxing:2593634-9999:task:zzz', '另一门课', '任务·前缀陷阱', 'unsubmitted');
  const existing = [other, cx(`chaoxing:${CX_KEY}:task:bbb`, '25数据科学34', '任务·课堂投票')];

  const merged = mergeAssignmentsByCourse(existing, [], [CX_KEY]);

  assert.deepEqual(merged.map((a) => a.id), ['chaoxing:2593634-9999:task:zzz']);
});

test('学习通任务合并：课程改名（courseId slug 变化）后旧条目仍能被清掉', () => {
  // 课程名从「25数据科学34」改为「数据科学-2025」时，slug 变化，靠 courseId 比对必然失配；
  // id 里内嵌的 courseid-clazzid 才是稳定身份。
  const existing = [cx(`chaoxing:${CX_KEY}:task:old`, '25数据科学34', '任务·改名前的旧活动')];
  const incoming = [cx(`chaoxing:${CX_KEY}:task:new`, '数据科学-2025', '任务·改名后的新活动')];

  const merged = mergeAssignmentsByCourse(existing, incoming, [CX_KEY]);

  assert.deepEqual(merged.map((a) => a.id), [`chaoxing:${CX_KEY}:task:new`]);
});

test('PLATFORM_HOME：覆盖全部平台且均为 https 主页', () => {
  // 快捷跳转按钮依赖此映射；缺一个平台或协议不对都会在弹窗打开错误地址。
  for (const id of PLATFORM_IDS) {
    const url = PLATFORM_HOME[id];
    assert.ok(url, `PLATFORM_HOME[${id}] 不能为空`);
    assert.ok(url.startsWith('https://'), `PLATFORM_HOME[${id}] 必须是 https：${url}`);
  }
});

// 学习通邮箱收件箱解析器单元测试（基于用户贴回的已核实诊断样本，2026-10-23）。
// 运行：node --experimental-strip-types --test src/chaoxing.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyChaoxingTitle,
  decideChaoxingExamStatus,
  extractChaoxingCourse,
  mapChaoxingAssignments,
  mapChaoxingExamAssignment,
  normalizeChaoxingExamTime,
  parseChaoxingExamDetailText,
  type RawChaoxingItem,
} from './chaoxing.ts';

// 真实诊断样本中的标题（来自 notice.chaoxing.com 收件箱 mainText）。
const T_LINEAR = '作业:《线性代数》作业指导手册矩阵的运算43。44页拍照上传';
const T_MATH = '作业:《高等数学（上）》作业 可分离变量的微分方程 p134页拍照上传';
const T_CLOSED = '作业结束提醒';
const T_EXAM = '考试通知';

test('classifyChaoxingTitle：作业下发计入，作业结束提醒排除，考试通知计入 exam', () => {
  assert.equal(classifyChaoxingTitle(T_LINEAR), 'homework');
  assert.equal(classifyChaoxingTitle(T_MATH), 'homework');
  assert.equal(classifyChaoxingTitle(T_CLOSED), 'homework_closed');
  assert.equal(classifyChaoxingTitle(T_EXAM), 'exam');
  assert.equal(classifyChaoxingTitle(''), 'other');
});

test('extractChaoxingCourse：从《》抽取课程名，无书名号返回空', () => {
  assert.equal(extractChaoxingCourse(T_LINEAR), '线性代数');
  assert.equal(extractChaoxingCourse(T_MATH), '高等数学（上）');
  assert.equal(extractChaoxingCourse(T_CLOSED), '');
});

// 模拟 DOM 层过滤后的“待办”原始项（detailUrl 取诊断 tree 中真实 data-url 形态）。
const RAW: RawChaoxingItem[] = [
  {
    id: 'C64B1178D9FC5DE4AF23CD7D71FF95F8',
    title: T_LINEAR,
    sender: '学习通知',
    detailUrl: 'https://notice.chaoxing.com/pc/notice/$CACG$294da3bd-900c-4c54-8052-7e163dca9d5e/detail?sendTag=0',
  },
  {
    id: 'F0EEDDCCBBAA99887766554433221100',
    title: T_MATH,
    sender: '学习通知',
    detailUrl: 'https://notice.chaoxing.com/pc/notice/$CACG$aa11bb22-33cc-44dd-55ee-66ff00112233/detail?sendTag=0',
  },
  // 以下两项会被 DOM 层按 classify 过滤掉，不进入 map：
  { id: 'CLOSED1', title: T_CLOSED, sender: '学习通知', detailUrl: 'https://notice.chaoxing.com/x' },
  { id: 'EXAM1', title: T_EXAM, sender: '学习通知', detailUrl: 'https://notice.chaoxing.com/y' },
];

test('mapChaoxingAssignments：字段正确（id/平台/课程/状态/来源/绝对深链）', () => {
  const assignments = mapChaoxingAssignments(RAW.slice(0, 2), {
    syncedAt: '2026-10-23T02:07:42.000Z',
  });
  assert.equal(assignments.length, 2);

  const a0 = assignments.find((a) => a.id === 'chaoxing:C64B1178D9FC5DE4AF23CD7D71FF95F8');
  assert.ok(a0);
  assert.equal(a0?.platformId, 'chaoxing');
  assert.equal(a0?.courseId, '线性代数'); // slugifyCourse 保留中文
  assert.equal(a0?.courseName, '线性代数');
  assert.equal(a0?.title, T_LINEAR);
  assert.equal(a0?.dueAt, null); // 收件箱无截止时间
  assert.equal(a0?.status, 'unsubmitted'); // 不臆测提交状态
  assert.equal(a0?.source, 'home');
  assert.equal(
    a0?.url,
    'https://notice.chaoxing.com/pc/notice/$CACG$294da3bd-900c-4c54-8052-7e163dca9d5e/detail?sendTag=0',
  );
  assert.equal(a0?.syncedAt, '2026-10-23T02:07:42.000Z');
});

test('DOM 层过滤：作业下发与考试通知计入，作业结束提醒排除', () => {
  const homework = RAW.filter((it) => classifyChaoxingTitle(it.title) === 'homework');
  assert.deepEqual(
    homework.map((t) => t.id),
    ['C64B1178D9FC5DE4AF23CD7D71FF95F8', 'F0EEDDCCBBAA99887766554433221100'],
  );
  const exam = RAW.filter((it) => classifyChaoxingTitle(it.title) === 'exam');
  assert.deepEqual(exam.map((t) => t.id), ['EXAM1']);
  const closed = RAW.filter((it) => classifyChaoxingTitle(it.title) === 'homework_closed');
  assert.deepEqual(closed.map((t) => t.id), ['CLOSED1']);
});

// ===== 考试通知判定（“注意时间”）：样本取自用户 2026-10-23 详情页截图正文 =====
// 截图原文：课程名称：大学物理 / 考试名称：25级-大学物理-课后测试4 /
//          开始时间：2026-10-21 11:18 / 结束时间：2026-10-21 11:40 / 考试形式：自主考试
const EXAM_DETAIL_TEXT =
  '考试通知 学习通知 转发 收藏 课程名称：大学物理 考试名称：25级-大学物理-课后测试4 ' +
  '开始时间：2026-10-21 11:18 结束时间：2026-10-21 11:40 考试形式：自主考试 ' +
  '考试过程中如果出现页面卡死、题目空白情况，请尝试切换网络或退出重新进入考试 考试 25级-大学物理-课后测试4 复制 转发';

test('normalizeChaoxingExamTime：日期时间归一为本地 ISO', () => {
  assert.equal(normalizeChaoxingExamTime('2026-10-21 11:40'), '2026-10-21T11:40');
  assert.equal(normalizeChaoxingExamTime('2026-10-21 11:40:25'), '2026-10-21T11:40:25');
  assert.equal(normalizeChaoxingExamTime('无时间'), null);
  assert.equal(normalizeChaoxingExamTime(''), null);
});

test('parseChaoxingExamDetailText：解析截图正文中的课程/考试名/开始/结束时间', () => {
  const d = parseChaoxingExamDetailText(EXAM_DETAIL_TEXT);
  assert.ok(d);
  assert.equal(d?.courseName, '大学物理');
  assert.equal(d?.examTitle, '25级-大学物理-课后测试4');
  assert.equal(d?.startAt, '2026-10-21T11:18');
  assert.equal(d?.endAt, '2026-10-21T11:40');
});

test('parseChaoxingExamDetailText：非考试详情正文返回 null', () => {
  assert.equal(parseChaoxingExamDetailText(''), null);
  assert.equal(parseChaoxingExamDetailText('收件箱 作业:《线性代数》作业指导手册'), null);
});

test('decideChaoxingExamStatus：过结束时间→expired，未到→unsubmitted，无时间→unsubmitted', () => {
  const now = new Date('2026-10-23T10:00:00').getTime();
  assert.equal(decideChaoxingExamStatus('2026-10-21T11:40', now), 'expired'); // 截图场景：已过结束时间
  assert.equal(decideChaoxingExamStatus('2026-10-23T11:40', now), 'unsubmitted');
  assert.equal(decideChaoxingExamStatus(null, now), 'unsubmitted');
  assert.equal(decideChaoxingExamStatus('不是时间', now), 'unsubmitted');
});

test('mapChaoxingExamAssignment：详情解析成功→考试名/课程/结束时间/时间判定状态', () => {
  const detail = parseChaoxingExamDetailText(EXAM_DETAIL_TEXT);
  assert.ok(detail);
  const now = new Date('2026-10-23T10:00:00').getTime();
  const a = mapChaoxingExamAssignment(
    { id: 'EXAM1', title: T_EXAM, sender: '学习通知', detailUrl: 'https://notice.chaoxing.com/y' },
    detail,
    { syncedAt: '2026-10-23T02:07:42.000Z', nowMs: now },
  );
  assert.equal(a.id, 'chaoxing:EXAM1');
  assert.equal(a.platformId, 'chaoxing');
  assert.equal(a.courseName, '大学物理');
  assert.equal(a.title, '25级-大学物理-课后测试4');
  assert.equal(a.dueAt, '2026-10-21T11:40');
  assert.equal(a.status, 'expired'); // 已过结束时间 → 考试结束
  assert.equal(a.source, 'home');
  assert.equal(a.url, 'https://notice.chaoxing.com/y');
});

test('mapChaoxingExamAssignment：详情解析失败→诚实降级（列表标题/默认课程/dueAt=null）', () => {
  const now = new Date('2026-10-23T10:00:00').getTime();
  const a = mapChaoxingExamAssignment(
    { id: 'EXAM2', title: T_EXAM, sender: '学习通知', detailUrl: 'https://notice.chaoxing.com/z' },
    null,
    { syncedAt: '2026-10-23T02:07:42.000Z', nowMs: now, fallbackCourse: '学习通考试通知' },
  );
  assert.equal(a.courseName, '学习通考试通知');
  assert.equal(a.title, T_EXAM);
  assert.equal(a.dueAt, null);
  assert.equal(a.status, 'unsubmitted');
});

test('无《》标题时回退到默认课程名，仍正确归属学习通作业通知', () => {
  const items: RawChaoxingItem[] = [
    {
      id: 'NOCBOOK1',
      title: '作业:第三章练习',
      sender: '学习通知',
      detailUrl: 'https://notice.chaoxing.com/pc/notice/$CACG$zz/detail',
    },
  ];
  const assignments = mapChaoxingAssignments(items, {
    syncedAt: '2026-10-23T02:07:42.000Z',
    fallbackCourse: '学习通作业通知',
  });
  assert.equal(assignments.length, 1);
  assert.equal(assignments[0]!.courseName, '学习通作业通知');
  assert.equal(assignments[0]!.courseId, '学习通作业通知');
});

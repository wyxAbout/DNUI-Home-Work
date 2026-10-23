// 学习通邮箱收件箱解析器单元测试（基于用户贴回的已核实诊断样本，2026-10-23）。
// 运行：node --experimental-strip-types --test src/chaoxing.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyChaoxingTitle,
  extractChaoxingCourse,
  mapChaoxingAssignments,
  type RawChaoxingItem,
} from './chaoxing.ts';

// 真实诊断样本中的标题（来自 notice.chaoxing.com 收件箱 mainText）。
const T_LINEAR = '作业:《线性代数》作业指导手册矩阵的运算43。44页拍照上传';
const T_MATH = '作业:《高等数学（上）》作业 可分离变量的微分方程 p134页拍照上传';
const T_CLOSED = '作业结束提醒';
const T_EXAM = '考试通知';

test('classifyChaoxingTitle：作业下发计入，作业结束提醒与考试通知排除', () => {
  assert.equal(classifyChaoxingTitle(T_LINEAR), 'homework');
  assert.equal(classifyChaoxingTitle(T_MATH), 'homework');
  assert.equal(classifyChaoxingTitle(T_CLOSED), 'homework_closed');
  assert.equal(classifyChaoxingTitle(T_EXAM), 'other');
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

test('DOM 层过滤：仅“作业”下发计入，作业结束提醒与考试通知被排除', () => {
  const tasks = RAW.filter((it) => classifyChaoxingTitle(it.title) === 'homework');
  assert.deepEqual(
    tasks.map((t) => t.id),
    ['C64B1178D9FC5DE4AF23CD7D71FF95F8', 'F0EEDDCCBBAA99887766554433221100'],
  );
  const assignments = mapChaoxingAssignments(tasks, { syncedAt: '2026-10-23T02:07:42.000Z' });
  assert.equal(assignments.length, 2);
  assert.ok(!assignments.some((a) => a.id.includes('CLOSED1') || a.id.includes('EXAM1')));
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

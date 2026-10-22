// 东软作业解析器单元测试（基于已核实的真实结构样本）。
// 运行：node --experimental-strip-types --test src/neusoft.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseNeusoftAssignmentText,
  parseNeusoftHomeTasks,
  slugifyCourse,
} from './neusoft.ts';

// 真实结构样本：包含“已完成8/18”汇总前缀（用于验证不会误命中“18”）。
const SAMPLE =
  '导学教材教学目标知识图谱目录FAQ学习资料测验作业项目 作答状态 发布时间正序 重置 仅查看计入考核作业 已完成8/18 ' +
  '00导论 课后 剩余作答次数：0 进行中 状态： 已作答公布答案：截止后自动公布公布成绩：截止后自动公布 详情 ' +
  '01第一章 新时代坚持和发展中国特色社会主义 课后 剩余作答次数：0 进行中 状态： 已作答公布答案：截止后自动公布公布成绩：截止后自动公布 详情 ' +
  '08第八章 发展全过程人民民主 课后 剩余作答次数：1 进行中 状态： 作答中公布答案：截止后自动公布公布成绩：截止后自动公布 去作答 ' +
  '09第九章 全面依法治国 课后 剩余作答次数：1 进行中 状态： 未作答公布答案：截止后自动公布公布成绩：截止后自动公布 去作答';

test('解析真实结构：序号/标题/状态/动作', () => {
  const items = parseNeusoftAssignmentText(SAMPLE);
  assert.equal(items.length, 4);
  assert.deepEqual(
    items.map((i) => ({ index: i.index, title: i.title, status: i.status, submitted: i.submitted })),
    [
      { index: '00', title: '导论', status: '已作答', submitted: true },
      { index: '01', title: '第一章 新时代坚持和发展中国特色社会主义', status: '已作答', submitted: true },
      { index: '08', title: '第八章 发展全过程人民民主', status: '作答中', submitted: false },
      { index: '09', title: '第九章 全面依法治国', status: '未作答', submitted: false },
    ],
  );
});

test('误报防护：仅有“已完成8/18”汇总时不解析出作业项', () => {
  const items = parseNeusoftAssignmentText('仅查看计入考核作业 已完成8/18');
  assert.equal(items.length, 0);
});

test('宽松规则：类型不是“课后”时仍可解析', () => {
  const loose =
    '01第一章 单元测验 剩余作答次数：1 进行中 状态： 未作答公布答案：截止后自动公布公布成绩：截止后自动公布 去作答';
  const items = parseNeusoftAssignmentText(loose);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.status, '未作答');
  assert.equal(items[0]?.submitted, false);
});

// ============ 首页“我的学习任务”（跨课程，自带所属课程与截止时间） ============

// 真实结构样本（2026-10-22 首页诊断）：序号可选，末尾一项无序号。
const HOME_SAMPLE =
  '我的学习任务未作答作答中 作业 请选择所属课程 ' +
  '11第十一章 以保障和改善民生为重点加强社会建设 作业 截止时间：2026-12-11 23:59:59所属课程：习近平新时代中国特色社会主义思想概论 去作答 ' +
  '12第十二章 建设社会主义生态文明 作业 截止时间：2026-12-11 23:59:59所属课程：习近平新时代中国特色社会主义思想概论 去作答 ' +
  '13第十三章 维护和塑造国家安全 作业 截止时间：2026-12-11 23:59:59所属课程：习近平新时代中国特色社会主义思想概论 去作答 ' +
  '16第十六章 中国特色大国外交和推动构建人类命运共同体 作业 截止时间：2026-12-11 23:59:59所属课程：习近平新时代中国特色社会主义思想概论 去作答 ' +
  '15第十五章 坚持“一国两制”和推进祖国完全统一 作业 截止时间：2026-12-11 23:59:59所属课程：习近平新时代中国特色社会主义思想概论 去作答 ' +
  '17第十七章 全面从严治党 作业 截止时间：2026-12-11 23:59:59所属课程：习近平新时代中国特色社会主义思想概论 去作答 ' +
  '人工智能基础篇：计算机视觉基础与图像识别原理 作业 截止时间：2026-10-27 23:59:59所属课程：人工智能通识 去作答';

test('首页解析：跨课程抽取标题/所属课程/截止时间', () => {
  const items = parseNeusoftHomeTasks(HOME_SAMPLE);
  assert.equal(items.length, 7);

  assert.deepEqual(
    items.map((i) => ({ index: i.index, courseName: i.courseName, dueAt: i.dueAt })),
    [
      { index: '11', courseName: '习近平新时代中国特色社会主义思想概论', dueAt: '2026-12-11T23:59:59' },
      { index: '12', courseName: '习近平新时代中国特色社会主义思想概论', dueAt: '2026-12-11T23:59:59' },
      { index: '13', courseName: '习近平新时代中国特色社会主义思想概论', dueAt: '2026-12-11T23:59:59' },
      { index: '16', courseName: '习近平新时代中国特色社会主义思想概论', dueAt: '2026-12-11T23:59:59' },
      { index: '15', courseName: '习近平新时代中国特色社会主义思想概论', dueAt: '2026-12-11T23:59:59' },
      { index: '17', courseName: '习近平新时代中国特色社会主义思想概论', dueAt: '2026-12-11T23:59:59' },
      { index: null, courseName: '人工智能通识', dueAt: '2026-10-27T23:59:59' },
    ],
  );

  assert.equal(items[0]?.title, '第十一章 以保障和改善民生为重点加强社会建设');
  assert.equal(items[6]?.title, '人工智能基础篇：计算机视觉基础与图像识别原理');
});

test('首页解析：类型标签为“测验”时同样可捕获，且标题不残留类型词', () => {
  // 2026-10-22 实测：该条目类型徽章是“测验”而非“作业”，旧锚点写死“作业”会整条漏掉。
  const text =
    '我的学习任务 未作答 作答中 测验 请选择所属课程 ' +
    '《新思想概论》测验三 测验 截止时间：2026-12-11 23:59:59 所属课程：习近平新时代中国特色社会主义思想概论 去作答';

  const items = parseNeusoftHomeTasks(text);

  assert.equal(items.length, 1);
  assert.equal(items[0]?.title, '《新思想概论》测验三');
  assert.equal(items[0]?.courseName, '习近平新时代中国特色社会主义思想概论');
  assert.equal(items[0]?.dueAt, '2026-12-11T23:59:59');
});

test('首页解析：标题自身以“测验”结尾时不会被误裁', () => {
  const text =
    '我的学习任务 未作答 作答中 请选择所属课程 ' +
    '《新思想概论》测验三 截止时间：2026-12-11 23:59:59 所属课程：人工智能通识 去作答';

  const items = parseNeusoftHomeTasks(text);

  assert.equal(items[0]?.title, '《新思想概论》测验三');
});

test('首页解析：课程详情结构不应被误解析（两种来源互斥）', () => {
  assert.equal(parseNeusoftHomeTasks(SAMPLE).length, 0);
});

test('slugifyCourse：中文课程名可生成稳定标识', () => {
  const a = slugifyCourse('习近平新时代中国特色社会主义思想概论');
  const b = slugifyCourse('习近平新时代中国特色社会主义思想概论');
  assert.equal(a, b);
  assert.ok(a.length > 0 && a.length <= 60);
  assert.equal(slugifyCourse('   '), 'unknown');
});

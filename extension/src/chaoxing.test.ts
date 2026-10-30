// 学习通邮箱收件箱解析器单元测试（基于用户贴回的已核实诊断样本，2026-10-23）。
// 运行：node --experimental-strip-types --test src/chaoxing.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAssignmentExpired, isAssignmentHiddenByDefault } from './models.ts';
import {
  classifyChaoxingTitle,
  decideChaoxingExamStatus,
  extractChaoxingCourse,
  mapChaoxingAssignments,
  mapChaoxingExamAssignment,
  mapChaoxingExamAssignments,
  mapChaoxingExamStatus,
  inferChaoxingExamType,
  parseChaoxingExamListDom,
  mapChaoxingTaskAssignments,
  mapChaoxingTaskTypeIcon,
  normalizeChaoxingExamTime,
  normalizeChaoxingTaskDeadline,
  parseChaoxingExamDetailText,
  parseChaoxingTaskListDom,
  parseChaoxingClazzId,
  parseChaoxingCourseId,
  parseChaoxingCourseListDom,
  parseChaoxingProgress,
  resolveChaoxingNoticeYears,
  findNextPageButton,
  type RawChaoxingItem,
  type RawChaoxingTaskItem,
} from './chaoxing.ts';

// ===== 收件箱翻页：分页控件检测（反馈：学习通此前只读第一页）=====
// 轻量假 Document：仅实现 findNextPageButton 用到的 querySelectorAll + 元素属性。
function fakeBtn(text: string, className = '', disabled = false): Element {
  return {
    textContent: text,
    className,
    disabled,
    querySelectorAll: () => [],
  } as unknown as Element;
}
function fakeDoc(containerChildren: Element[]): Document {
  const containerSel = '.el-pagination, .pagination, .page';
  return {
    querySelectorAll: (sel: string) =>
      sel === containerSel ? [fakeBtn('', 'el-pagination', false) as unknown as Element] : [],
  } as unknown as Document;
}
// 让“分页条”元素在被查询子元素时返回给定 children。
function fakeDocWithPager(children: Element[]): Document {
  const pager = {
    textContent: '',
    className: 'el-pagination',
    disabled: false,
    querySelectorAll: (sel: string) => (sel === 'button, a, li, span' ? children : []),
  } as unknown as Element;
  return {
    querySelectorAll: (sel: string) =>
      sel === '.el-pagination, .pagination, .page' ? [pager] : [],
  } as unknown as Document;
}

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

test('normalizeChaoxingExamTime：日期时间归一为本地 ISO（空白可有可无）', () => {
  assert.equal(normalizeChaoxingExamTime('2026-10-21 11:40'), '2026-10-21T11:40');
  assert.equal(normalizeChaoxingExamTime('2026-10-2111:40'), '2026-10-21T11:40');
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

// 2026-10-23 首次抓取失败根因：DOMParser 的 textContent 把相邻块级元素无空格拼接。
test('parseChaoxingExamDetailText：textContent 无空格拼接形态也能解析', () => {
  const glued =
    '考试通知转发收藏课程名称：大学物理考试名称：25级-大学物理-课后测试4' +
    '开始时间：2026-10-2111:18结束时间：2026-10-2111:40考试形式：自主考试';
  const d = parseChaoxingExamDetailText(glued);
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

// ===== 格式 2（2026-10-23 看板截图证据）：详情用“考试时间： MM-DD HH:MM 至 MM-DD HH:MM”，
// 无“开始/结束时间”标签、无年份，可能附“考试时长： N分钟”。缺省年份按调用方年份补齐。=====
const EXAM_DETAIL_TEXT_V2 =
  '考试通知 学习通知 转发 收藏 课程名称：概率论 考试名称：【64】概率论第1章单元测试 ' +
  '考试时间： 09-14 16:45 至 09-14 17:00 考试形式：网考';

test('parseChaoxingExamDetailText：格式2“考试时间…至…”无年份，按调用方年份补齐', () => {
  const d = parseChaoxingExamDetailText(EXAM_DETAIL_TEXT_V2, { year: 2026 });
  assert.ok(d);
  assert.equal(d?.courseName, '概率论');
  // 考试名称必须在“考试时间”标签前截断，不能吞掉时间文本
  assert.equal(d?.examTitle, '【64】概率论第1章单元测试');
  assert.equal(d?.startAt, '2026-09-14T16:45');
  assert.equal(d?.endAt, '2026-09-14T17:00');
});

test('parseChaoxingExamDetailText：格式2粘连形态 + 考试时长标签不干扰', () => {
  const glued =
    '考试通知转发收藏课程名称：概率论考试名称：【64】概率论第2章单元测试' +
    '考试时间：10-1216:45至10-1217:00考试时长：90分钟';
  const d = parseChaoxingExamDetailText(glued, { year: 2026 });
  assert.ok(d);
  assert.equal(d?.examTitle, '【64】概率论第2章单元测试');
  assert.equal(d?.startAt, '2026-10-12T16:45');
  assert.equal(d?.endAt, '2026-10-12T17:00');
});

// ===== 跨年通知“就近补年”（规则 1b）：无年份的格式 2 若按当前年补会落进遥远过去
// （典型：12 月发 1 月考），判为跨年、起止时间整体 +1 年。=====
test('parseChaoxingExamDetailText：跨年格式2（12月发1月考）整体翻到下一年', () => {
  // 模拟“现在”是 2026-12-20：通知 12 月发出，考试在次年 1 月。
  const nowMs = new Date('2026-12-20T10:00:00').getTime();
  const d = parseChaoxingExamDetailText(
    '课程名称：大学物理 考试名称：期末考试 考试时间： 01-10 09:00 至 01-10 10:30',
    { year: 2026, nowMs },
  );
  assert.ok(d);
  assert.equal(d?.startAt, '2027-01-10T09:00');
  assert.equal(d?.endAt, '2027-01-10T10:30');
});

test('parseChaoxingExamDetailText：半年内的过期格式2不翻年（本学期过期照旧判过期）', () => {
  const nowMs = new Date('2026-10-23T10:00:00').getTime();
  const d = parseChaoxingExamDetailText(EXAM_DETAIL_TEXT_V2, { year: 2026, nowMs });
  assert.ok(d);
  assert.equal(d?.endAt, '2026-09-14T17:00'); // 仅落后 ~39 天，不翻年
});

test('parseChaoxingExamDetailText：格式2自带年份时不翻年（日期本身无歧义）', () => {
  const nowMs = new Date('2026-12-20T10:00:00').getTime();
  const d = parseChaoxingExamDetailText(
    '课程名称：大学物理 考试名称：期末考试 考试时间： 2026-01-10 09:00 至 2026-01-10 10:30',
    { year: 2026, nowMs },
  );
  assert.ok(d);
  assert.equal(d?.startAt, '2026-01-10T09:00');
  assert.equal(d?.endAt, '2026-01-10T10:30');
});

// ===== 跨年消歧（规则 1b 完整解法）：用列表发送时间锚定每条通知的真实年份 =====
test('resolveChaoxingNoticeYears：列表倒序 + MM-DD 反向跳变即跨年 -1', () => {
  const nowMs = new Date('2026-10-23T10:00:00').getTime();
  // 倒序列表：10-21 → 09-14 → 12-25 → 11-20 → 03-11 → 12-25(次年)
  const items: RawChaoxingItem[] = [
    mkItem('A', '10-21(星期三) 11:19'),
    mkItem('B', '09-14(星期一) 16:44'),
    mkItem('C', '12-25(星期四) 08:47'),
    mkItem('D', '11-20(星期四) 15:37'),
    mkItem('E', '03-11(星期三) 09:12'),
    mkItem('F', '12-25(星期四) 07:40'),
  ];
  const years = resolveChaoxingNoticeYears(items, nowMs);
  assert.equal(years.get('A'), 2026); // 顶部锚定今年
  assert.equal(years.get('B'), 2026); // 09-14 仍今年
  assert.equal(years.get('C'), 2025); // 12-25 反向跳变 → 去年
  assert.equal(years.get('D'), 2025); // 11-20 去年
  assert.equal(years.get('E'), 2025); // 03-11 去年
  assert.equal(years.get('F'), 2024); // 再反向跳变 → 前年
});

test('resolveChaoxingNoticeYears：置顶/无时间行沿用上一项年份', () => {
  const nowMs = new Date('2026-10-23T10:00:00').getTime();
  const items: RawChaoxingItem[] = [
    mkItem('A', '10-21(星期三) 11:19'),
    mkItem('PIN', ''), // 置顶无时间
    mkItem('C', '12-25(星期四) 08:47'),
  ];
  const years = resolveChaoxingNoticeYears(items, nowMs);
  assert.equal(years.get('A'), 2026);
  assert.equal(years.get('PIN'), 2026); // 无时间 → 沿用 A 的 2026
  assert.equal(years.get('C'), 2025); // 仍正确跨年
});

test('parseChaoxingExamDetailText：用锚定年份（2025）+ 通知月日，12月考试不再误判到2026', () => {
  const nowMs = new Date('2026-10-23T10:00:00').getTime();
  // 2025-12-25 发出的通知（noticeMonthDay=1225），详情“考试时间：12-25 …”，year 锚定 2025。
  const d = parseChaoxingExamDetailText(
    '课程名称：高数 考试名称：期末考试 考试时间： 12-25 09:00 至 12-25 10:30',
    { year: 2025, nowMs, noticeMonthDay: 1225 },
  );
  assert.ok(d);
  assert.equal(d?.endAt, '2025-12-25T10:30'); // 考试月日不早于通知月日 → 不翻年，正确落在 2025
});

test('parseChaoxingExamDetailText：2025-12 通知、1月考试，考试月日早于通知月日 → 翻到次年', () => {
  const nowMs = new Date('2026-10-23T10:00:00').getTime();
  // 通知 12-25（noticeMonthDay=1225），考试 01-10（月日 110 < 1225）→ 实际为次年 1 月。
  const d = parseChaoxingExamDetailText(
    '课程名称：高数 考试名称：期末考试 考试时间： 01-10 09:00 至 01-10 10:30',
    { year: 2025, nowMs, noticeMonthDay: 1225 },
  );
  assert.ok(d);
  assert.equal(d?.startAt, '2026-01-10T09:00');
  assert.equal(d?.endAt, '2026-01-10T10:30'); // 精确跨年 +1 年
});

test('parseChaoxingExamDetailText：跨年考试区间（12-25 至 01-10）开始当年、结束次年', () => {
  const nowMs = new Date('2026-10-23T10:00:00').getTime();
  const d = parseChaoxingExamDetailText(
    '课程名称：高数 考试名称：期末 考试时间： 12-25 09:00 至 01-10 10:30',
    { year: 2025, nowMs, noticeMonthDay: 1225 },
  );
  assert.ok(d);
  assert.equal(d?.startAt, '2025-12-25T09:00'); // 开始月日不早于通知 → 当年
  assert.equal(d?.endAt, '2026-01-10T10:30'); // 结束月日早于通知 → 次年
});

// 测试辅助：造一条带发送时间的原始项。
function mkItem(id: string, noticeTime: string): RawChaoxingItem {
  return {
    id,
    title: '考试通知',
    sender: '学习通知',
    detailUrl: `https://notice.chaoxing.com/pc/notice/${id}/detail`,
    noticeTime: noticeTime || undefined,
  };
}

test('mapChaoxingExamAssignment：格式2详情→dueAt=结束时刻，按时间判定状态', () => {
  const now = new Date('2026-10-23T10:00:00').getTime();
  // 已过期样本（看板截图：概率论第1章，09-14 结束）
  const past = parseChaoxingExamDetailText(EXAM_DETAIL_TEXT_V2, { year: 2026 });
  assert.ok(past);
  const aPast = mapChaoxingExamAssignment(
    { id: 'EXAM2', title: T_EXAM, sender: '学习通知', detailUrl: 'https://notice.chaoxing.com/z' },
    past,
    { syncedAt: '2026-10-23T02:07:42.000Z', nowMs: now },
  );
  assert.equal(aPast.dueAt, '2026-09-14T17:00');
  assert.equal(aPast.status, 'expired');

  // 未过期样本（看板截图：25级-大学物理-课后测试4，10-15 09:35 至 10-31 10:35）
  const future = parseChaoxingExamDetailText(
    '课程名称：大学物理 考试名称：25级-大学物理-课后测试4 考试时间： 10-15 09:35 至 10-31 10:35 考试时长： 10分钟',
    { year: 2026 },
  );
  assert.ok(future);
  const aFuture = mapChaoxingExamAssignment(
    { id: 'EXAM3', title: T_EXAM, sender: '学习通知', detailUrl: 'https://notice.chaoxing.com/w' },
    future,
    { syncedAt: '2026-10-23T02:07:42.000Z', nowMs: now },
  );
  assert.equal(aFuture.dueAt, '2026-10-31T10:35');
  assert.equal(aFuture.status, 'unsubmitted'); // 结束时间在未来 → 待做
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

test('findNextPageButton：分页条内存在可点击“下一页”时返回该按钮', () => {
  const doc = fakeDocWithPager([fakeBtn('上一页'), fakeBtn('下一页')]);
  const btn = findNextPageButton(doc);
  assert.ok(btn);
  assert.equal((btn as Element as { textContent: string }).textContent, '下一页');
});

test('findNextPageButton：末页“下一页”被禁用时返回 null（已到末页）', () => {
  const doc = fakeDocWithPager([fakeBtn('下一页', 'is-disabled', true)]);
  assert.equal(findNextPageButton(doc), null);
});

test('findNextPageButton：分页条内无“下一页”文本时返回 null', () => {
  const doc = fakeDocWithPager([fakeBtn('上一页'), fakeBtn('1'), fakeBtn('2')]);
  assert.equal(findNextPageButton(doc), null);
});

test('findNextPageButton：分页条容器缺失时返回 null（单页，不翻页）', () => {
  const doc = fakeDoc([]);
  assert.equal(findNextPageButton(doc), null);
});

// ============================================================================
// 任务/活动列表（mobilelearn.chaoxing.com/page/active/stuActiveList）
// 样本来自用户 2026-10-25 贴回的真实诊断 JSON（页面作为顶层文档被诊断）：
//   课程名 h2#classObjName = "25数据科学34"
//   .bottomList → .status「进行中（0）」/ ul / ul / .status「已结束（15）」/ ul(15 个 li)
//   每个 li → .tag.icon-tp + .tag.icon-signin-g|icon-xr-g + .right-content>p（标题） + .time（结束时间：MM-DD HH:mm）
// ============================================================================

interface FakeNode {
  tag: string;
  className?: string;
  id?: string;
  text?: string;
  children?: FakeNode[];
}

function textOf(n: FakeNode): string {
  return ((n.text ?? '') + ' ' + (n.children ?? []).map(textOf).join(' '))
    .replace(/\s+/g, ' ')
    .trim();
}

// 极简选择器引擎：支持 #id / 标签 / .class 组合 / [attr^="v"] / [attr*="v"] / 多级后代。
function matches(node: FakeNode, sel: string): boolean {
  const attrRe = /\[([\w-]+)([*^$]?)="([^"]+)"\]/g;
  const attrs: Array<{ name: string; op: string; value: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(sel)) !== null) {
    attrs.push({ name: m[1]!, op: m[2] ?? '', value: m[3]! });
  }
  const rest = sel.replace(attrRe, '');

  if (rest.startsWith('#')) {
    if ((node.id ?? '') !== rest.slice(1)) return false;
  } else {
    const classes = rest.match(/\.([\w-]+)/g) ?? [];
    const tagPart = rest.replace(/\.[\w-]+/g, '').trim();
    if (tagPart && !/^[a-zA-Z][\w-]*$/.test(tagPart)) return false; // 不支持伪类/组合器
    if (tagPart && node.tag.toLowerCase() !== tagPart.toLowerCase()) return false;
    for (const c of classes) {
      if (!(node.className ?? '').split(/\s+/).includes(c.slice(1))) return false;
    }
    if (!tagPart && classes.length === 0 && attrs.length === 0) return false;
  }

  for (const a of attrs) {
    const value = a.name === 'id' ? (node.id ?? '') : a.name === 'class' ? (node.className ?? '') : '';
    if (a.op === '^' ? !value.startsWith(a.value) : !value.includes(a.value)) return false;
  }
  return true;
}

function descendants(n: FakeNode, out: FakeNode[]): void {
  for (const c of n.children ?? []) {
    out.push(c);
    descendants(c, out);
  }
}

function queryAll(root: FakeNode, selector: string): FakeNode[] {
  const found: FakeNode[] = [];
  for (const part of selector.split(',').map((s) => s.trim()).filter(Boolean)) {
    let current: FakeNode[] = [root];
    for (const step of part.split(/\s+/).filter(Boolean)) {
      const next: FakeNode[] = [];
      for (const n of current) {
        const all: FakeNode[] = [];
        descendants(n, all);
        for (const c of all) {
          if (matches(c, step) && !next.includes(c)) next.push(c);
        }
      }
      current = next;
    }
    for (const n of current) if (!found.includes(n)) found.push(n);
  }
  return found;
}

function toElement(n: FakeNode): Element {
  return {
    tagName: n.tag.toUpperCase(),
    className: n.className ?? '',
    id: n.id ?? '',
    textContent: textOf(n),
    children: (n.children ?? []).map(toElement),
    querySelector: (sel: string) => {
      const hit = queryAll(n, sel)[0];
      return hit ? toElement(hit) : null;
    },
    querySelectorAll: (sel: string) => queryAll(n, sel).map(toElement),
  } as unknown as Element;
}

function fakeDocument(root: FakeNode): Document {
  return {
    querySelector: (sel: string) => {
      const hit = queryAll(root, sel)[0];
      return hit ? toElement(hit) : null;
    },
    querySelectorAll: (sel: string) => queryAll(root, sel).map(toElement),
  } as unknown as Document;
}

function taskLi(title: string, icon: string, time: string): FakeNode {
  return {
    tag: 'li',
    children: [
      { tag: 'div', className: 'tag icon-tp' },
      { tag: 'div', className: `tag ${icon}` },
      {
        tag: 'div',
        className: 'right-content',
        children: [
          { tag: 'p', className: 'overHidden2 fl', text: title },
          { tag: 'div', className: 'clearfix' },
        ],
      },
      { tag: 'div', className: 'time', text: time },
      { tag: 'div', className: 'clearfix' },
    ],
  };
}

// 真实样本中「已结束」分组的 15 条活动（标题 / 图标 / 结束时间）。
const ENDED_ROWS: Array<[string, string, string]> = [
  ['普通签到', 'icon-signin-g', '结束时间：05-20 08:06'],
  ['普通签到', 'icon-signin-g', '结束时间：05-18 13:22'],
  ['普通签到', 'icon-signin-g', '结束时间：05-13 08:02'],
  ['普通签到', 'icon-signin-g', '结束时间：05-11 13:24'],
  ['选人', 'icon-xr-g', '结束时间：05-09 14:51'],
  ['选人', 'icon-xr-g', '结束时间：05-09 14:29'],
  ['普通签到', 'icon-signin-g', '结束时间：05-09 13:23'],
  ['普通签到', 'icon-signin-g', '结束时间：05-06 08:06'],
  ['普通签到', 'icon-signin-g', '结束时间：04-29 08:04'],
  ['普通签到', 'icon-signin-g', '结束时间：04-27 13:25'],
  ['普通签到', 'icon-signin-g', '结束时间：04-22 08:04'],
  ['普通签到', 'icon-signin-g', '结束时间：04-01 08:59'],
  ['选人', 'icon-xr-g', '结束时间：04-01 08:10'],
  ['位置签到', 'icon-signin-g', '结束时间：03-11 08:58'],
  ['普通签到', 'icon-signin-g', '结束时间：03-02 13:23'],
];

const TASK_URL =
  'https://mobilelearn.chaoxing.com/page/active/stuActiveList?courseid=259363438&clazzid=139380153&cpi=506947938&ut=s&stuenc=4d6d9ffa3549fa950d5d549a4ced0e60&fid=607';

function taskDom(lis: FakeNode[]): FakeNode {
  return {
    tag: 'body',
    children: [
      {
        tag: 'div',
        className: 'main task-list',
        children: [
          {
            tag: 'div',
            className: 'top-back',
            children: [{ tag: 'h2', id: 'classObjName', text: '25数据科学34' }],
          },
          {
            tag: 'div',
            className: 'has-content',
            children: [
              { tag: 'div', className: 'filter' },
              {
                tag: 'div',
                className: 'bottomList',
                children: [
                  {
                    tag: 'div',
                    className: 'status',
                    text: '进行中',
                    children: [{ tag: 'span', text: `（${lis.length ? 0 : 0}）` }],
                  },
                  { tag: 'ul', children: [] },
                  { tag: 'ul', children: [] },
                  {
                    tag: 'div',
                    className: 'status',
                    text: '已结束',
                    children: [{ tag: 'span', text: `（${lis.length}）` }],
                  },
                  { tag: 'ul', children: lis },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

test('mapChaoxingTaskTypeIcon：签到/选人/通用图标各自映射，未知图标回退', () => {
  assert.equal(mapChaoxingTaskTypeIcon('tag icon-tp'), '任务');
  assert.equal(mapChaoxingTaskTypeIcon('tag icon-tp tag icon-signin-g'), '签到');
  assert.equal(mapChaoxingTaskTypeIcon('tag icon-xr-g'), '选人');
  // 未出现过的图标：不做语义臆测，只去掉 icon- 前缀。
  assert.equal(mapChaoxingTaskTypeIcon('tag icon-zz-g'), 'zz');
  assert.equal(mapChaoxingTaskTypeIcon('tag'), '其它');
});

test('normalizeChaoxingTaskDeadline：无年份的 MM-DD HH:mm 归一为本地 ISO', () => {
  const nowMs = new Date(2026, 2, 1, 0, 0, 0).getTime(); // 2026-03-01 本地
  // 未结束：直接用当前年补齐。
  assert.equal(
    normalizeChaoxingTaskDeadline('结束时间：05-20 08:06', { nowMs, isEnded: false }),
    '2026-05-20T08:06',
  );
  // 已结束但补齐后落在未来 → 回退到上一年，避免把已结束项误判为将来。
  assert.equal(
    normalizeChaoxingTaskDeadline('结束时间：05-20 08:06', { nowMs, isEnded: true }),
    '2025-05-20T08:06',
  );
  // 已结束且补齐后就在过去 → 保持当前年。
  assert.equal(
    normalizeChaoxingTaskDeadline('结束时间：01-05 09:00', { nowMs, isEnded: true }),
    '2026-01-05T09:00',
  );
  // 无法识别的文本返回 null（不臆造截止时间）。
  assert.equal(normalizeChaoxingTaskDeadline('无截止时间', { nowMs }), null);
});

test('parseChaoxingTaskListDom：真实样本解析出课程标识与全部 15 条活动', () => {
  const lis = ENDED_ROWS.map(([t, i, d]) => taskLi(t, i, d));
  const parsed = parseChaoxingTaskListDom(fakeDocument(taskDom(lis)), TASK_URL);
  assert.ok(parsed);
  assert.equal(parsed!.courseId, '259363438-139380153'); // courseid-clazzid，稳定可跨会话复用
  assert.equal(parsed!.courseName, '25数据科学34');
  assert.equal(parsed!.items.length, 15);
  assert.equal(parsed!.items[0]!.title, '普通签到');
  assert.equal(parsed!.items[0]!.type, '签到');
  assert.equal(parsed!.items[0]!.deadlineText, '结束时间：05-20 08:06');
  assert.equal(parsed!.items[4]!.type, '选人');
  assert.ok(parsed!.items.every((it) => it.section === '已结束'));
});

test('parseChaoxingTaskListDom：进行中分组同样被识别（不只有已结束）', () => {
  const dom = taskDom([taskLi('普通签到', 'icon-signin-g', '结束时间：05-20 08:06')]);
  // 手动把「进行中」分组下第一个 ul 塞一条活动，模拟教师正在发放中的任务。
  const body = dom.children![0]!;
  const bottom = body.children![1]!.children![1]!;
  bottom.children![1] = { tag: 'ul', children: [taskLi('课堂投票', 'icon-tp', '结束时间：12-30 23:59')] };
  const parsed = parseChaoxingTaskListDom(fakeDocument(dom), TASK_URL);
  assert.ok(parsed);
  const inProgress = parsed!.items.filter((it) => it.section === '进行中');
  assert.equal(inProgress.length, 1);
  assert.equal(inProgress[0]!.title, '课堂投票');
  assert.equal(inProgress[0]!.type, '任务');
});

test('parseChaoxingTaskListDom：列表被多包一层（div > ul > li）仍能解析，不再静默 0 条', () => {
  // 2026-10-29 真实事故：复测时 6 门课任务页全部「成功 · 0 条」，
  // 而诊断用 `.bottomList li`（后代选择器）明明拿到 12 行。
  // 根因是解析器只认 `.bottomList` 的**直接子** ul，平台多包一层就一条都收不到。
  const dom: FakeNode = {
    tag: 'body',
    children: [
      {
        tag: 'div',
        className: 'top-back',
        children: [{ tag: 'h2', id: 'classObjName', text: '大学物理' }],
      },
      {
        tag: 'div',
        className: 'bottomList',
        children: [
          { tag: 'div', className: 'status', text: '进行中（0）' },
          { tag: 'div', className: 'list-wrap', children: [{ tag: 'ul', children: [] }] },
          { tag: 'div', className: 'status', text: '已结束（2）' },
          {
            tag: 'div',
            className: 'list-wrap',
            children: [
              {
                tag: 'ul',
                children: [
                  taskLi('普通签到', 'icon-signin-g', '结束时间：05-20 08:06'),
                  taskLi('选人', 'icon-xr-g', '结束时间：05-09 14:51'),
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  const parsed = parseChaoxingTaskListDom(fakeDocument(dom), TASK_URL);
  assert.ok(parsed);
  assert.equal(parsed!.items.length, 2);
  assert.ok(parsed!.items.every((it) => it.section === '已结束'));
});

test('parseChaoxingTaskListDom：分组头与列表同被包裹时，按文档顺序归属分组', () => {
  // 只放宽容器而不动分组判定会更糟：15 条已结束会被归进「进行中」，
  // 看板突然冒出 15 条假待办。这里锁住「顺序上最近的那个 .status」这条规则。
  const dom: FakeNode = {
    tag: 'body',
    children: [
      {
        tag: 'div',
        className: 'top-back',
        children: [{ tag: 'h2', id: 'classObjName', text: '高等数学（下）' }],
      },
      {
        tag: 'div',
        className: 'bottomList',
        children: [
          {
            tag: 'div',
            className: 'group',
            children: [
              { tag: 'div', className: 'status', text: '进行中（1）' },
              { tag: 'ul', children: [taskLi('课堂投票', 'icon-tp', '结束时间：12-30 23:59')] },
            ],
          },
          {
            tag: 'div',
            className: 'group',
            children: [
              { tag: 'div', className: 'status', text: '已结束（2）' },
              {
                tag: 'ul',
                children: [
                  taskLi('普通签到', 'icon-signin-g', '结束时间：05-20 08:06'),
                  taskLi('选人', 'icon-xr-g', '结束时间：05-09 14:51'),
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  const parsed = parseChaoxingTaskListDom(fakeDocument(dom), TASK_URL);
  assert.ok(parsed);
  assert.equal(parsed!.items.length, 3);
  assert.equal(parsed!.items.filter((it) => it.section === '进行中').length, 1);
  assert.equal(parsed!.items.filter((it) => it.section === '已结束').length, 2);
});

test('parseChaoxingTaskListDom：缺少 .bottomList 或课程标识时返回 null（不静默造数据）', () => {
  const noList: FakeNode = {
    tag: 'body',
    children: [{ tag: 'div', className: 'main', children: [{ tag: 'div', className: 'null-data', text: '暂无任务' }] }],
  };
  assert.equal(parseChaoxingTaskListDom(fakeDocument(noList), TASK_URL), null);
  // 有列表但 URL 无 courseid/clazzid、页面也没有课程名 → 无法确定归属，返回 null。
  const noCourse: FakeNode = {
    tag: 'body',
    children: [
      {
        tag: 'div',
        className: 'bottomList',
        children: [{ tag: 'ul', children: [taskLi('签到', 'icon-signin-g', '结束时间：05-20 08:06')] }],
      },
    ],
  };
  assert.equal(
    parseChaoxingTaskListDom(
      fakeDocument(noCourse),
      'https://mobilelearn.chaoxing.com/page/active/stuActiveList',
    ),
    null,
  );
});

test('mapChaoxingTaskAssignments：进行中→in_progress，已结束→ended（默认隐藏）', () => {
  const items: RawChaoxingTaskItem[] = [
    {
      title: '课堂投票',
      type: '任务',
      deadlineText: '结束时间：12-30 23:59',
      dueAt: '2026-12-30T23:59',
      section: '进行中',
    },
    {
      title: '普通签到',
      type: '签到',
      deadlineText: '结束时间：05-20 08:06',
      dueAt: '2025-05-20T08:06',
      section: '已结束',
    },
  ];
  const assignments = mapChaoxingTaskAssignments(items, {
    courseId: '259363438-139380153',
    courseName: '25数据科学34',
    syncedAt: '2026-10-25T03:55:47.000Z',
    nowMs: new Date(2026, 9, 25).getTime(),
    url: TASK_URL,
  });
  assert.equal(assignments.length, 2);
  assert.equal(assignments[0]!.status, 'in_progress');
  assert.equal(assignments[1]!.status, 'ended');
  assert.equal(assignments[0]!.courseName, '25数据科学34');
  assert.equal(assignments[0]!.platformId, 'chaoxing');
  assert.equal(assignments[0]!.source, 'course');
  // 标题带类型与截止时间，便于区分同名活动。
  assert.equal(assignments[0]!.title, '任务·课堂投票（12-30 23:59）');
  assert.equal(assignments[1]!.title, '签到·普通签到（05-20 08:06）');
});

test('mapChaoxingTaskAssignments：同名不同截止时间的活动得到不同稳定 id', () => {
  const base: Omit<RawChaoxingTaskItem, 'deadlineText'> = {
    title: '普通签到',
    type: '签到',
    dueAt: '2025-05-20T08:06',
    section: '已结束',
  };
  const items: RawChaoxingTaskItem[] = [
    { ...base, deadlineText: '结束时间：05-20 08:06' },
    { ...base, deadlineText: '结束时间：05-18 13:22' },
    { ...base, deadlineText: '结束时间：05-20 08:06' },
  ];
  const assignments = mapChaoxingTaskAssignments(items, {
    courseId: '259363438-139380153',
    courseName: '25数据科学34',
    syncedAt: '2026-10-25T03:55:47.000Z',
    nowMs: new Date(2026, 9, 25).getTime(),
    url: TASK_URL,
  });
  assert.equal(assignments[0]!.id, assignments[2]!.id); // 完全同项 → 同 id（可安全去重）
  assert.notEqual(assignments[0]!.id, assignments[1]!.id); // 不同截止时间 → 不同 id
  assert.match(assignments[0]!.id, /^chaoxing:259363438-139380153:task:/);
});

// ============================================================================
// 课程注册表（「我的课程」页 mooc2-ans.chaoxing.com/visit/interaction，阶段 A）
// 样本来自用户 2026-10-25 贴回的真实诊断 JSON，共 6 门课：
//   div#courseList.course-list > div#stuNormalCourseListDiv
//     └─ div.course.clearfix.learnCourse.stu_<clazzId>  id="c_<courseId>"
//        ├─ div.course-cover > div.btm-cover  「任务点进度: 62/62 100%」（章节进度，非作业状态）
//        └─ div.course-info > h3 课程名 / p(别名) / p.color3 教师
// 交叉验证：「线性代数」= c_259363438 + stu_139380153，与其课程页/任务列表 URL 的
//           courseid=259363438&clazzid=139380153 完全一致 —— 注册表与列表页 ID 体系打通。
// ============================================================================

function courseCard(opts: {
  courseId: string;
  clazzId: string;
  name: string;
  teacher: string;
  alias?: string;
  progress?: string;
}): FakeNode {
  const cover: FakeNode[] = [{ tag: 'a' }, { tag: 'ul', className: 'hanlde-list' }, { tag: 'div', className: 'wisdomBtn' }];
  if (opts.progress) {
    cover.push({ tag: 'div', className: 'btm-cover clearfix', text: opts.progress });
  }
  const infoChildren: FakeNode[] = [{ tag: 'h3', className: 'inlineBlock', text: opts.name }];
  if (opts.alias) {
    infoChildren.push({ tag: 'p', className: 'margint10 line2 color2', text: opts.alias });
  }
  infoChildren.push({ tag: 'p', className: 'line2 color3', text: opts.teacher });
  return {
    tag: 'div',
    className: `course clearfix learnCourse stu_${opts.clazzId}`,
    id: `c_${opts.courseId}`,
    children: [{ tag: 'div', className: 'course-cover', children: cover }, { tag: 'div', className: 'course-info', children: infoChildren }],
  };
}

const MY_COURSES_DOM: FakeNode = {
  tag: 'body',
  children: [
    {
      tag: 'div',
      className: 'course-list',
      id: 'courseList',
      children: [
        {
          tag: 'div',
          id: 'stuNormalCourseListDiv',
          children: [
            courseCard({ courseId: '205643380', clazzId: '151633609', name: '大学物理', teacher: '翟卫东', progress: '任务点进度: 0/35 0%' }),
            courseCard({ courseId: '219456814', clazzId: '151567528', name: '概率论与数理统计', teacher: '王欣' }),
            courseCard({
              courseId: '266109891',
              clazzId: '152005723',
              name: '数据库原理与技术（2026-2027-1学期）',
              teacher: '李翔坤',
              alias: '本校学生用课程',
              progress: '任务点进度: 0/1 0%',
            }),
            courseCard({ courseId: '203468962', clazzId: '139355754', name: '高等数学（下）', teacher: '王玉君', progress: '任务点进度: 0/2 0%' }),
            courseCard({ courseId: '259363438', clazzId: '139380153', name: '线性代数', teacher: '严维军', progress: '任务点进度: 62/62 100%' }),
            courseCard({ courseId: '204678509', clazzId: '128552525', name: '高等数学(上)', teacher: '李延玲' }),
          ],
        },
      ],
    },
  ],
};

test('parseChaoxingCourseId / parseChaoxingClazzId：从卡片 id 与 class 抽出稳定标识', () => {
  assert.equal(parseChaoxingCourseId('c_259363438'), '259363438');
  assert.equal(parseChaoxingCourseId('course_259363438'), ''); // 形态不符 → 不臆造
  assert.equal(parseChaoxingClazzId('course clearfix learnCourse stu_139380153'), '139380153');
  assert.equal(parseChaoxingClazzId('course clearfix learnCourse'), '');
});

test('parseChaoxingProgress：解析「62/62 100%」，无法识别返回 null', () => {
  assert.deepEqual(parseChaoxingProgress('任务点进度: 62/62 100%'), { done: 62, total: 62 });
  assert.deepEqual(parseChaoxingProgress('任务点进度: 0/35 0%'), { done: 0, total: 35 });
  assert.equal(parseChaoxingProgress('暂无进度'), null);
});

test('parseChaoxingCourseListDom：真实样本解析出 6 门课，含 courseId/clazzId/教师/进度', () => {
  const courses = parseChaoxingCourseListDom(fakeDocument(MY_COURSES_DOM), '2026-10-25T06:24:27.000Z');
  assert.equal(courses.length, 6);

  // 与任务列表 URL 参数交叉验证的关键一门课。
  const linear = courses.find((c) => c.name === '线性代数');
  assert.ok(linear);
  assert.equal(linear!.courseId, '259363438');
  assert.equal(linear!.clazzId, '139380153');
  assert.equal(linear!.teacher, '严维军');
  assert.equal(linear!.progressText, '任务点进度: 62/62 100%');
  assert.equal(linear!.progressDone, 62);
  assert.equal(linear!.progressTotal, 62);

  // 有班级别名的一门课。
  const db = courses.find((c) => c.courseId === '266109891');
  assert.equal(db!.alias, '本校学生用课程');
  assert.equal(db!.teacher, '李翔坤');

  // 无 .btm-cover 的课程不应凭空造出进度。
  const gaoShang = courses.find((c) => c.courseId === '204678509');
  assert.equal(gaoShang!.teacher, '李延玲');
  assert.equal(gaoShang!.progressText, undefined);
  assert.equal(gaoShang!.progressDone, undefined);
});

test('parseChaoxingCourseListDom：ID 不全 / 无课程名 / 重复的卡片被跳过', () => {
  const dom: FakeNode = {
    tag: 'body',
    children: [
      {
        tag: 'div',
        id: 'courseList',
        children: [
          // 缺 clazzId（class 里没有 stu_）→ 跳过
          { tag: 'div', className: 'course clearfix', id: 'c_111', children: [{ tag: 'div', className: 'course-info', children: [{ tag: 'h3', text: '缺班级号' }] }] },
          // 缺 courseId（id 形态不符）→ 跳过
          { tag: 'div', className: 'course stu_222', id: 'x_333', children: [{ tag: 'div', className: 'course-info', children: [{ tag: 'h3', text: '缺课程号' }] }] },
          // 课程名为空 → 跳过（宁可漏，也不造“未知课程”占位）
          { tag: 'div', className: 'course stu_444', id: 'c_555', children: [{ tag: 'div', className: 'course-info', children: [{ tag: 'h3' }] }] },
          courseCard({ courseId: '666', clazzId: '777', name: '有效课程', teacher: '甲' }),
          courseCard({ courseId: '666', clazzId: '777', name: '有效课程', teacher: '甲' }), // 重复 → 去重
        ],
      },
    ],
  };
  const courses = parseChaoxingCourseListDom(fakeDocument(dom), '2026-10-25T06:24:27.000Z');
  assert.equal(courses.length, 1);
  assert.equal(courses[0]!.name, '有效课程');
});

test('parseChaoxingCourseListDom：没有课程卡片时返回空数组（由调用方据此报 needs-verification）', () => {
  const empty: FakeNode = {
    tag: 'body',
    children: [{ tag: 'div', id: 'courseList', children: [{ tag: 'div', className: 'null-data', text: '暂无课程' }] }],
  };
  assert.deepEqual(parseChaoxingCourseListDom(fakeDocument(empty), '2026-10-25T06:24:27.000Z'), []);
});

// ============================================================================
// 2026-10-25 第二批真实诊断：数据库原理与技术（courseid=266109891&clazzid=152005723，
// h2#classObjName = 「数科25003-25004班」）任务页 —— 进行中（0）/ 已结束（12）。
// 关键发现：任务页**不只是活动**，它聚合了作业/测验：12 条里 11 条标题写着「作业」，
// 图标为 icon-cy-g（此前只见过 icon-signin-g / icon-xr-g / icon-tp）。
// 用户拍板：即便如此，「已结束」仍按判定表判“已完成”并默认隐藏（等作业页解析器用
// 真实提交状态覆盖）。此处只固化“类型识别正确 + 状态映射符合判定表”。
// ============================================================================

const DB_ENDED_ROWS: Array<[string, string, string]> = [
  ['10.19日作业：完成数据更新笔记中的题目（library001库），所有代码滚动截图提交学习通作业', 'icon-cy-g', '结束时间：10-22 13:47'],
  ['10.19日作业1：短视频系统实施及数据导入。查询评论表结果截图 提交。', 'icon-cy-g', '结束时间：10-22 13:46'],
  ['10.12日作业：根据短视频平台功能用例图，画数据库E-R图（写好学号姓名），将E-R图转换关系模式', 'icon-cy-g', '结束时间：10-22 13:46'],
  ['10.8日作业：完成视图笔记中的题目，视图名后面要带学号末三位。最后show tables;截图后提交学习通作业。', 'icon-cy-g', '结束时间：10-12 08:26'],
  ['9.29日作业：创建学生选课系统数据库和四张表后，请将show tables;的结果截图上传。', 'icon-cy-g', '结束时间：10-08 13:15'],
  ['9.28日作业：多表连接查询作业', 'icon-cy-g', '结束时间：10-07 11:18'],
  ['9.24日作业，将所有分组实践截图提交，截一张图', 'icon-cy-g', '结束时间：09-28 08:58'],
  ['9.21日分组查询第一课代码，截图上传', 'icon-cy-g', '结束时间：09-24 13:08'],
  ['9.17日作业：完成如下两道题目，上传全屏允许效果截图。（1）查询所有图书书名、出版社和出版日期，中文显示列名，结果', 'icon-cy-g', '结束时间：09-21 09:01'],
  ['9.14日作业：条件查询运行代码和结果都拷贝粘贴过来。', 'icon-cy-g', '结束时间：09-20 16:01'],
  ['二维码签到', 'icon-signin-g', '结束时间：09-14 07:59'],
  ['请提交学生信息表中学生表的查看记录截图。请截全屏图。', 'icon-cy-g', '结束时间：09-08 19:10'],
];

const DB_TASK_URL =
  'https://mobilelearn.chaoxing.com/page/active/stuActiveList?courseid=266109891&clazzid=152005723&cpi=506947938&fid=607&stuenc=ed948ea8c95b8b2e06968c19a51c8637';

test('mapChaoxingTaskTypeIcon：icon-cy-g（任务页里的作业/测验类）用中性标签，不误标为“任务”', () => {
  // 每个 li 都有通用 icon-tp + 具体图标，必须优先取具体图标。
  assert.equal(mapChaoxingTaskTypeIcon('tag icon-tp tag icon-cy-g'), '作业或测验');
  assert.equal(mapChaoxingTaskTypeIcon('tag icon-tp tag icon-signin-g'), '签到');
  // 只有通用图标时才回退“任务”。
  assert.equal(mapChaoxingTaskTypeIcon('tag icon-tp'), '任务');
});

test('parseChaoxingTaskListDom：数据库课真实 12 条（作业类 icon-cy-g + 一条签到）全部解析为已结束', () => {
  const lis = DB_ENDED_ROWS.map(([title, icon, time]) => taskLi(title!, icon!, time!));
  const dom: FakeNode = {
    tag: 'body',
    children: [
      {
        tag: 'div',
        className: 'main task-list',
        children: [
          { tag: 'div', className: 'top-back', children: [{ tag: 'h2', id: 'classObjName', text: '数科25003-25004班' }] },
          {
            tag: 'div',
            className: 'has-content',
            children: [
              { tag: 'div', className: 'filter' },
              {
                tag: 'div',
                className: 'bottomList',
                children: [
                  { tag: 'div', className: 'status', text: '进行中', children: [{ tag: 'span', text: '（0）' }] },
                  { tag: 'ul', children: [] },
                  { tag: 'ul', children: [] },
                  { tag: 'div', className: 'status', text: '已结束', children: [{ tag: 'span', text: '（12）' }] },
                  { tag: 'ul', children: lis },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  const parsed = parseChaoxingTaskListDom(fakeDocument(dom), DB_TASK_URL, new Date(2026, 9, 25).getTime());
  assert.ok(parsed);
  assert.equal(parsed!.courseId, '266109891-152005723');
  assert.equal(parsed!.courseName, '数科25003-25004班');
  assert.equal(parsed!.items.length, 12);
  assert.ok(parsed!.items.every((it) => it.section === '已结束'));

  // 作业类与签到类都要识别正确（不是一律“任务”）。
  const homework = parsed!.items.filter((it) => it.type === '作业或测验');
  const signin = parsed!.items.filter((it) => it.type === '签到');
  assert.equal(homework.length, 11);
  assert.equal(signin.length, 1);
  assert.equal(signin[0]!.title, '二维码签到');

  // 已结束项的截止年份：10-22 早于当前 10-25 → 用当前年（2026）。
  assert.equal(parsed!.items[0]!.dueAt, '2026-10-22T13:47');
  // 09-08 同样落在过去 → 保持当前年，不回退。
  assert.equal(parsed!.items[11]!.dueAt, '2026-09-08T19:10');

  const assignments = mapChaoxingTaskAssignments(parsed!.items, {
    courseId: parsed!.courseId,
    courseName: parsed!.courseName,
    syncedAt: '2026-10-25T13:21:51.000Z',
    nowMs: new Date(2026, 9, 25).getTime(),
    url: DB_TASK_URL,
  });
  assert.equal(assignments.length, 12);
  // 判定表：任务页“已结束且无提交状态” → ended（看板“已完成”，默认隐藏）。
  assert.ok(assignments.every((a) => a.status === 'ended'));
  assert.match(assignments[0]!.title, /^作业或测验·10\.19日作业/);
  assert.match(assignments[0]!.id, /^chaoxing:266109891-152005723:task:/);
  // 12 条互不重复（标题/时间不同 → id 不同）。
  assert.equal(new Set(assignments.map((a) => a.id)).size, 12);
});

test('parseChaoxingCourseListDom：课程名嵌在 h3 的子元素（<a>）里也能取到（新诊断实证形态）', () => {
  // 「我的课程」页实测：h3 本身没有直接文本节点，课程名在其内部的 <a> 里。
  const dom: FakeNode = {
    tag: 'body',
    children: [
      {
        tag: 'div',
        id: 'courseList',
        children: [
          {
            tag: 'div',
            id: 'stuNormalCourseListDiv',
            children: [
              {
                tag: 'div',
                className: 'course clearfix  learnCourse stu_151633609',
                id: 'c_205643380',
                children: [
                  { tag: 'div', className: 'course-cover', children: [{ tag: 'div', className: 'btm-cover clearfix', text: '任务点进度: 0/35 0%' }] },
                  {
                    tag: 'div',
                    className: 'course-info',
                    children: [
                      { tag: 'h3', className: 'inlineBlock', children: [{ tag: 'a', text: '大学物理' }] },
                      { tag: 'p', className: 'margint10 line2 color2' },
                      { tag: 'p', className: 'line2 color3', text: '翟卫东' },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  const courses = parseChaoxingCourseListDom(fakeDocument(dom), '2026-10-25T13:21:09.000Z');
  assert.equal(courses.length, 1);
  assert.equal(courses[0]!.courseId, '205643380');
  assert.equal(courses[0]!.clazzId, '151633609');
  assert.equal(courses[0]!.name, '大学物理');
  assert.equal(courses[0]!.teacher, '翟卫东');
  assert.equal(courses[0]!.progressDone, 0);
  assert.equal(courses[0]!.progressTotal, 35);
  // 空别名段落不应产出空字符串别名。
  assert.equal(courses[0]!.alias, undefined);
});

// 同一条活动的「状态迁移」不得产生第二个身份：
// 任务页把活动分成「进行中 / 已结束」两个分组，活动到点后会从上面滑到下面。
// 若 id 哈希里含分组，状态一变 ID 就变，看板会同时出现“进行中”和“已完成”两条同项记录。
test('mapChaoxingTaskAssignments：同一活动滑到「已结束」时 id 保持不变，只换状态', () => {
  const base: Omit<RawChaoxingTaskItem, 'section'> = {
    title: '课堂投票',
    type: '任务',
    deadlineText: '结束时间：12-30 23:59',
    dueAt: '2026-12-30T23:59',
  };
  const ctx = {
    courseId: '259363438-139380153',
    courseName: '25数据科学34',
    syncedAt: '2026-10-25T03:55:47.000Z',
    nowMs: new Date(2026, 9, 25).getTime(),
    url: TASK_URL,
  };
  const [opened] = mapChaoxingTaskAssignments([{ ...base, section: '进行中' }], ctx);
  const [closed] = mapChaoxingTaskAssignments([{ ...base, section: '已结束' }], ctx);

  assert.equal(opened!.id, closed!.id);
  assert.equal(opened!.status, 'in_progress');
  assert.equal(closed!.status, 'ended');
});

// ============================================================================
// 作业 / 考试列表（exam-ans/mooc2/exam/exam-list）—— 2026-10-29 真实取证样本
//
// 取证结论（决定了下面所有断言）：
//   ① 该页标题叫「考试列表」，但内容是**作业 + 测验 + 课堂活动**混合列表，
//      作业进看板只能靠这一页（mooc2/work/list 实测打开只有弹窗、正文 0 字）。
//   ② 每行的状态在自己的 p.status 上，**没有**「进行中/已结束」分组（与任务页相反）。
//   ③ 该页完全不显示截止时间 → dueAt 必须是 null，不能臆造。
// ============================================================================
const EXAM_URL =
  'https://mooc1.chaoxing.com/exam-ans/mooc2/exam/exam-list?courseid=259363438&clazzid=139380153&enc=fd0f1329b515680c698c68b9787b0fc5&v=2&hideHead=0&pageHeader=0';

// 页面真实顺序（诊断 JSON 的 listRows 原样搬运）。
const EXAM_ROWS: Array<[string, string]> = [
  ['课堂学习活动（第三章、第四章）', '已完成'],
  ['线代测验4', '已完成'],
  ['线代作业4', '已完成'],
  ['课堂学习活动（第三章）', '已完成'],
  ['线代测验3', '已完成'],
  ['线代作业3', '已过期'],
  ['线代测验2', '已完成'],
  ['线代作业2', '已完成'],
  ['线代测验1', '已完成'],
  ['线代作业1', '已完成'],
];

// 还原真实行结构：li > div > div.right-content > (p.overHidden2 标题 / p.status 状态)
function examLi(title: string, status: string): FakeNode {
  return {
    tag: 'li',
    children: [
      {
        tag: 'div',
        children: [
          {
            tag: 'div',
            className: 'right-content',
            children: [
              { tag: 'div', className: 'tag icon-exam-g' },
              { tag: 'p', className: 'overHidden2 fl', text: title },
              { tag: 'div', className: 'clear' },
              { tag: 'p', className: 'status fl', text: status },
            ],
          },
          { tag: 'div', className: 'clear' },
        ],
      },
    ],
  };
}

// 注意：本页课程名只有 .top-back > h2（无 #classObjName），与任务页不同。
function examDom(rows: Array<[string, string]>, courseName = '25数据科学34'): FakeNode {
  return {
    tag: 'body',
    children: [
      {
        tag: 'div',
        className: 'main task-list',
        children: [
          {
            tag: 'div',
            className: 'has-content',
            children: [
              { tag: 'div', className: 'top-back', children: [{ tag: 'h2', text: courseName }] },
              {
                tag: 'div',
                className: 'bottomList',
                children: [{ tag: 'ul', children: rows.map(([t, st]) => examLi(t, st)) }],
              },
            ],
          },
        ],
      },
    ],
  };
}

test('parseChaoxingExamListDom：真实 10 行全部解析，课程名取自 .top-back h2', () => {
  const parsed = parseChaoxingExamListDom(fakeDocument(examDom(EXAM_ROWS)), EXAM_URL);
  assert.ok(parsed);
  assert.equal(parsed!.courseId, '259363438-139380153');
  assert.equal(parsed!.courseName, '25数据科学34');
  assert.equal(parsed!.items.length, 10);
  assert.equal(parsed!.unparsedRows, 0);

  // 标题与状态不能串行：p.overHidden2 是标题、p.status 是状态（两个 p 是兄弟）。
  assert.equal(parsed!.items[2]!.title, '线代作业4');
  assert.equal(parsed!.items[2]!.statusText, '已完成');
  assert.equal(parsed!.items[5]!.title, '线代作业3');
  assert.equal(parsed!.items[5]!.status, 'expired');

  // 类型只能从标题推断（该页所有行图标都是 icon-exam-g，图标无区分度）。
  assert.equal(parsed!.items[2]!.type, '作业');
  assert.equal(parsed!.items[1]!.type, '测验');
  assert.equal(parsed!.items[0]!.type, '课堂活动');
});

// 把「解析结果」直接换算成「看板实际会显示几条」。
// 这是 2026-10-29 用户困惑的正面回答：作业解析成功了，但样本里 10 条有 9 条已完成，
// 看板按口径只显示 1 条（已过期的那条）。不做这个换算，就会把“正常显示”误判成“没抓到”。
test('真实 10 行样本映射后：看板只显示「线代作业3（已过期）」1 条', () => {
  const parsed = parseChaoxingExamListDom(fakeDocument(examDom(EXAM_ROWS)), EXAM_URL)!;
  const list = mapChaoxingExamAssignments(parsed.items, {
    courseId: parsed.courseId,
    courseName: parsed.courseName,
    syncedAt: '2026-10-29T00:00:00.000Z',
    url: EXAM_URL,
  });
  assert.equal(list.length, 10);

  // 与 App.tsx / 通知 / 角标完全同口径：completed/ended 默认隐藏，
  // expired 因 dueAt 为 null 不会被「自动隐藏已过期项」命中。
  const visible = list.filter(
    (a) => !isAssignmentHiddenByDefault(a.status) && !isAssignmentExpired(a.dueAt),
  );
  assert.equal(visible.length, 1);
  assert.match(visible[0]!.title, /线代作业3/);
  assert.equal(visible[0]!.status, 'expired');
  assert.equal(visible[0]!.dueAt, null);
});

test('parseChaoxingExamListDom：无 .bottomList 返回 null（不误判成空列表）', () => {
  const dom: FakeNode = {
    tag: 'body',
    children: [{ tag: 'div', className: 'top-back', children: [{ tag: 'h2', text: '课名' }] }],
  };
  assert.equal(parseChaoxingExamListDom(fakeDocument(dom), EXAM_URL), null);
});

test('parseChaoxingExamListDom：.null-data 空态页返回 0 条（有效结论，不是解析失败）', () => {
  // 一门没布置作业的课只渲染 .null-data。若这里返回 null，提取层会抛「列表未渲染」，
  // 该课就永远显示失败——2026-10-29 实测「数据库原理与技术」正是卡在这个位置。
  const dom: FakeNode = {
    tag: 'body',
    children: [
      { tag: 'div', className: 'top-back', children: [{ tag: 'h2', text: '数据库原理与技术' }] },
      { tag: 'div', className: 'null-data', text: '暂无数据' },
    ],
  };
  const parsed = parseChaoxingExamListDom(fakeDocument(dom), EXAM_URL);
  assert.ok(parsed);
  assert.equal(parsed!.items.length, 0);
  assert.equal(parsed!.unparsedRows, 0);
  assert.equal(parsed!.courseName, '数据库原理与技术');
  assert.equal(parsed!.courseId, '259363438-139380153');
});

test('parseChaoxingExamListDom：无法识别状态的行计入 unparsedRows，绝不猜成已完成', () => {
  // 猜成“已完成”会把一条真实待办直接隐藏掉 —— 宁可报未识别，也不静默吞掉。
  const parsed = parseChaoxingExamListDom(
    fakeDocument(examDom([['线代作业5', '某种没见过的状态文案']])),
    EXAM_URL,
  );
  assert.ok(parsed);
  assert.equal(parsed!.items.length, 0);
  assert.equal(parsed!.unparsedRows, 1);
});

test('mapChaoxingExamStatus：判定表覆盖各状态，未知返回 null', () => {
  assert.equal(mapChaoxingExamStatus('已完成'), 'completed');
  assert.equal(mapChaoxingExamStatus('已过期'), 'expired');
  assert.equal(mapChaoxingExamStatus('未完成'), 'unsubmitted');
  assert.equal(mapChaoxingExamStatus('待批阅'), 'submitted');
  assert.equal(mapChaoxingExamStatus('已退回'), 'returned');
  assert.equal(mapChaoxingExamStatus('重考'), 'retake');
  assert.equal(mapChaoxingExamStatus('进行中'), 'in_progress');
  // 复合语义优先：含“重交”不能落到“已交”上。
  assert.equal(mapChaoxingExamStatus('需重交'), 'returned');
  assert.equal(mapChaoxingExamStatus(''), null);
  assert.equal(mapChaoxingExamStatus('审核中'), null);
});

test('inferChaoxingExamType：考试优先于作业（“期末考试作业”按考试算）', () => {
  assert.equal(inferChaoxingExamType('线代作业1'), '作业');
  assert.equal(inferChaoxingExamType('线代测验2'), '测验');
  assert.equal(inferChaoxingExamType('期末考试'), '考试');
  assert.equal(inferChaoxingExamType('课堂学习活动（第三章）'), '课堂活动');
  assert.equal(inferChaoxingExamType(''), '其它');
});

test('mapChaoxingExamAssignments：无截止时间、按课程名分组、id 含稳定课程键', () => {
  const parsed = parseChaoxingExamListDom(fakeDocument(examDom(EXAM_ROWS)), EXAM_URL)!;
  const list = mapChaoxingExamAssignments(parsed.items, {
    courseId: parsed.courseId,
    courseName: parsed.courseName,
    syncedAt: '2026-10-29T03:23:10.000Z',
    url: EXAM_URL,
  });

  assert.equal(list.length, 10);
  // 该页不显示截止时间：必须是 null，不能拿同步时间冒充。
  assert.equal(list.every((a) => a.dueAt === null), true);
  // courseId 用课程名 slug（与收件箱、任务页同源），保证看板一门课一个分组。
  assert.equal(list[0]!.courseId, list[9]!.courseId);
  assert.match(list[0]!.id, /^chaoxing:259363438-139380153:exam:/);
  assert.equal(list[0]!.source, 'course');
  // 类型进入标题，方便看板一眼区分作业/测验。
  assert.equal(list[2]!.title, '作业·线代作业4');
});

test('mapChaoxingExamAssignments：状态变化不改变 id（否则同一条作业会裂成两条）', () => {
  const mk = (statusText: string) => {
    const parsed = parseChaoxingExamListDom(
      fakeDocument(examDom([['线代作业4', statusText]])),
      EXAM_URL,
    )!;
    return mapChaoxingExamAssignments(parsed.items, {
      courseId: parsed.courseId,
      courseName: parsed.courseName,
      syncedAt: '2026-10-29T03:23:10.000Z',
      url: EXAM_URL,
    })[0]!;
  };
  const before = mk('未完成');
  const after = mk('已完成');
  const expired = mk('已过期');

  assert.equal(before.id, after.id);
  assert.equal(before.id, expired.id);
  assert.equal(before.status, 'unsubmitted');
  assert.equal(after.status, 'completed');
  assert.equal(expired.status, 'expired');
});

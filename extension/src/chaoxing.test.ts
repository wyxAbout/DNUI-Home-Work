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
  resolveChaoxingNoticeYears,
  findNextPageButton,
  type RawChaoxingItem,
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

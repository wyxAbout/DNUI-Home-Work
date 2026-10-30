// 阶段 B 逐课抓取的纯逻辑测试（无浏览器依赖）。
// 运行：node --experimental-strip-types --test src/chaoxing-crawl.test.ts
//
// 只测「拼地址 / 排计划 / 汇总结论」三件纯函数的事。
// 真正的取数（开临时标签、等上报、关标签）在 background 里，属浏览器行为，
// 必须靠人工端到端验证——与项目既有“先取证、再落地”的做法一致，不在此处假装验证。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChaoxingExamListUrl,
  buildChaoxingTaskListUrl,
  chaoxingCourseKey,
  chaoxingCrawlPageKindOf,
  chaoxingCrawlPageLabel,
  crawlUrlMemoryKey,
  createFinishedCrawlState,
  createIdleCrawlState,
  createRunningCrawlState,
  mergeChaoxingFrameUrl,
  orderCrawlCandidateUrls,
  crawlCourseKeysOfReport,
  planChaoxingCrawl,
  rememberCourseTaskUrl,
  redactDiagnosticUrl,
  summarizeChaoxingCrawl,
  withChaoxingPageAdvice,
  CHAOXING_TASK_LIST_BASE,
  type ChaoxingCrawlOutcome,
} from './chaoxing-crawl.ts';
import type { ChaoxingCourse } from './models.ts';

function course(
  courseId: string,
  clazzId: string,
  name: string,
): ChaoxingCourse {
  return {
    courseId,
    clazzId,
    name,
    teacher: '王云贤',
    syncedAt: '2026-10-25T09:00:00.000Z',
  };
}

test('buildChaoxingTaskListUrl：拼出取证过的真实端点，参数顺序与编码稳定', () => {
  const url = buildChaoxingTaskListUrl({ courseId: '259363438', clazzId: '139380153' });
  assert.equal(
    url,
    `${CHAOXING_TASK_LIST_BASE}?courseid=259363438&clazzid=139380153`,
  );
  // 端点必须是 2026-10-25 诊断里真实出现过的地址，不能凭猜测换域或换路径。
  assert.equal(new URL(url).hostname, 'mobilelearn.chaoxing.com');
  assert.equal(new URL(url).pathname, '/page/active/stuActiveList');
});

test('buildChaoxingTaskListUrl：ID 做 URL 编码，不会被注入额外参数', () => {
  const url = buildChaoxingTaskListUrl({ courseId: '1&clazzid=2', clazzId: '3' });
  const params = new URL(url).searchParams;
  assert.equal(params.get('courseid'), '1&clazzid=2');
  assert.equal(params.get('clazzid'), '3');
});

test('chaoxingCourseKey：与任务项 id 中间段用同一种拼法', () => {
  assert.equal(chaoxingCourseKey({ courseId: '259363438', clazzId: '139380153' }), '259363438-139380153');
});

test('planChaoxingCrawl：跳过缺 ID 的残缺条目，其余按注册表顺序排计划', () => {
  const plan = planChaoxingCrawl([
    course('259363438', '139380153', '线性代数'),
    course('', '152005723', '缺课程 ID'),
    course('266109891', '', '缺班级 ID'),
    course('266109891', '152005723', '数据库'),
  ]);
  assert.deepEqual(plan.map((t) => t.name), ['线性代数', '数据库']);
  assert.deepEqual(plan.map((t) => t.courseKey), ['259363438-139380153', '266109891-152005723']);
  assert.equal(plan[1]!.url, `${CHAOXING_TASK_LIST_BASE}?courseid=266109891&clazzid=152005723`);
});

test('planChaoxingCrawl：同一 courseKey 只抓一次（注册表重复不重复开标签）', () => {
  const dup = course('259363438', '139380153', '线性代数');
  const plan = planChaoxingCrawl([dup, { ...dup, name: '线性代数（重复卡片）' }]);
  assert.equal(plan.length, 1);
  assert.equal(plan[0]!.name, '线性代数');
});

test('planChaoxingCrawl：超过上限时截断，避免一次开几十个标签', () => {
  const many = Array.from({ length: 20 }, (_, i) => course(`1000${i}`, `2000${i}`, `课程${i}`));
  assert.equal(planChaoxingCrawl(many, 5).length, 5);
  // 默认上限同样生效。
  assert.equal(planChaoxingCrawl(many).length, 12);
});

test('planChaoxingCrawl：注册表为空 → 空计划（调用方据此提示先访问「我的课程」页）', () => {
  assert.deepEqual(planChaoxingCrawl([]), []);
});

function outcome(name: string, ok: boolean): ChaoxingCrawlOutcome {
  return {
    courseKey: `k-${name}`,
    name,
    ok,
    message: ok ? '成功' : '超时',
    pages: [{ kind: 'task', ok, message: ok ? '成功' : '超时' }],
  };
}

test('summarizeChaoxingCrawl：全部成功 / 部分失败 / 全失败 / 空注册表 四种口径', () => {
  assert.equal(summarizeChaoxingCrawl([outcome('A', true), outcome('B', true)]), '逐课同步完成：2 门课全部成功');
  assert.equal(
    summarizeChaoxingCrawl([outcome('A', true), outcome('B', true), outcome('C', false)]),
    '逐课同步完成：2/3 门课成功，1 门失败（详见运行日志）',
  );
  assert.equal(summarizeChaoxingCrawl([outcome('A', false)]), '逐课同步失败：1 门课均未成功（详见运行日志）');
  assert.equal(
    summarizeChaoxingCrawl([]),
    '没有可抓取的课程（课程注册表为空或缺少 courseId/clazzId）',
  );
});

// ============================================================================
// 候选内容页 URL 合并（2026-10-29 修复）：这是“作业/考试诊断不出来”的直接原因。
// 旧实现 `dataUrl + window.location.search` 在 data-url 自带 `?courseId=…` 时
// 会拼出 `…?courseId=1&clazzid=2?courseid=1&clazzid=2` —— 第二个 `?` 之后的参数全部作废，
// 打开就是空壳或错误页；而任务列表走的是 iframe src（不拼串），所以只有任务能诊断出来。
// ============================================================================
const SHELL = 'https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/stu?courseid=259363438&clazzid=139380153&cpi=506947938';

test('mergeChaoxingFrameUrl：data-url 自带查询串时只补缺失键，绝不拼出第二个问号', () => {
  const dataUrl = 'https://mooc1.chaoxing.com/mooc2/work/list?courseId=259363438&classId=139380153&enc=abc123';
  const merged = mergeChaoxingFrameUrl(dataUrl, new URL(SHELL).search, SHELL);

  assert.equal((merged.match(/\?/g) ?? []).length, 1);
  const params = new URL(merged).searchParams;
  // data-url 自带的参数优先（enc/classId 不能被外壳的 clazzid 覆盖掉）。
  assert.equal(params.get('enc'), 'abc123');
  assert.equal(params.get('classId'), '139380153');
  // 外壳补上的缺失键：cpi。
  assert.equal(params.get('cpi'), '506947938');
  assert.equal(params.get('courseid'), '259363438');

  // 反面断言：旧写法会拼出两个问号。
  const legacy = dataUrl + new URL(SHELL).search;
  assert.equal((legacy.match(/\?/g) ?? []).length, 2);
});

test('mergeChaoxingFrameUrl：相对地址按 origin 解析成绝对地址', () => {
  const merged = mergeChaoxingFrameUrl('/mooc2/work/list?courseId=1', '?clazzid=2', SHELL);
  assert.equal(new URL(merged).origin, 'https://mooc2-ans.chaoxing.com');
  assert.equal(new URL(merged).searchParams.get('clazzid'), '2');
});

test('mergeChaoxingFrameUrl：非法输入原样返回，不抛异常', () => {
  assert.equal(mergeChaoxingFrameUrl('http://[bad', '?a=1', SHELL), 'http://[bad');
});

test('redactDiagnosticUrl：诊断输出只留 origin+pathname，会话参数一律省略', () => {
  assert.equal(
    redactDiagnosticUrl('https://mobilelearn.chaoxing.com/page/active/stuActiveList?courseid=1&stuenc=deadbeef'),
    'https://mobilelearn.chaoxing.com/page/active/stuActiveList?…[查询参数已省略]',
  );
  assert.equal(
    redactDiagnosticUrl('https://mooc1.chaoxing.com/mooc2/work/list'),
    'https://mooc1.chaoxing.com/mooc2/work/list',
  );
});

// 逐课同步状态存档：弹窗靠它展示进度/结果（不依赖 sendMessage 应答）。
test('逐课同步状态：开跑清空上一轮结论，结束带上成功/失败计数', () => {
  const running = createRunningCrawlState('2026-10-29T03:00:00.000Z');
  assert.equal(running.running, true);
  assert.equal(running.message, null);
  assert.equal(running.total, 0);
  // 关键：不能沿用上一轮的 message，否则弹窗会把旧结论当成本轮结果。
  assert.equal(running.finishedAt, null);

  const finished = createFinishedCrawlState(
    {
      ok: false,
      total: 6,
      succeeded: 5,
      failed: 1,
      items: [
        {
          courseKey: '259363438-139380153',
          name: '线性代数',
          ok: false,
          partial: true,
          pages: [
            { kind: 'task', ok: true, message: '学习通任务列表：12 项' },
            { kind: 'exam', ok: false, message: '等待页面上报超时' },
          ],
          message: '共 2 页：任务列表成功，作业/考试列表失败',
        },
      ],
      message: '逐课同步完成：5/6 门课成功，1 门失败（详见运行日志）',
    },
    '2026-10-29T03:00:00.000Z',
    '2026-10-29T03:01:00.000Z',
  );
  assert.equal(finished.running, false);
  assert.equal(finished.total, 6);
  assert.equal(finished.succeeded, 5);
  assert.equal(finished.failed, 1);
  assert.match(finished.message ?? '', /5\/6/);
  // 逐页明细必须落进存档：否则「作业页到底抓没抓到」永远查不出来。
  assert.equal(finished.items.length, 1);
  assert.equal(finished.items[0]?.pages[1]?.ok, false);

  // 空闲态：全部归零，作为“从未同步过”的初始值。
  const idle = createIdleCrawlState();
  assert.deepEqual(
    [idle.running, idle.total, idle.message],
    [false, 0, null],
  );
});

// 逐课抓取的地址顺序：先用「上次真的成功过」的地址，再用手拼地址；两者互为后备。
test('orderCrawlCandidateUrls：记住的地址优先，去重后保留两个候选', () => {
  const built = buildChaoxingTaskListUrl({ courseId: '1', clazzId: '2' });
  const remembered = `${built}&stuenc=abc`;

  assert.deepEqual(orderCrawlCandidateUrls(built, remembered), [remembered, built]);
  // 没记住过 → 只有手拼地址。
  assert.deepEqual(orderCrawlCandidateUrls(built), [built]);
  // 记住的就是手拼地址 → 不重复尝试同一个地址。
  assert.deepEqual(orderCrawlCandidateUrls(built, built), [built]);
  // 空值不算候选。
  assert.deepEqual(orderCrawlCandidateUrls(built, '   '), [built]);
});

test('rememberCourseTaskUrl：按课程键记录，超过上限时淘汰最旧的', () => {
  let memory: Record<string, string> = {};
  memory = rememberCourseTaskUrl(memory, 'a-1', 'https://x/mobilelearn/a');
  memory = rememberCourseTaskUrl(memory, 'b-2', 'https://x/mobilelearn/b');
  assert.equal(memory['a-1'], 'https://x/mobilelearn/a');
  assert.equal(Object.keys(memory).length, 2);

  // 空键/空地址不写入，避免污染记忆表。
  memory = rememberCourseTaskUrl(memory, '', 'https://x/y');
  memory = rememberCourseTaskUrl(memory, 'c-3', '');
  assert.equal(Object.keys(memory).length, 2);

  // 上限 2：再记一门课，最旧的被淘汰。
  memory = rememberCourseTaskUrl(memory, 'c-3', 'https://x/mobilelearn/c', 2);
  assert.deepEqual(Object.keys(memory), ['b-2', 'c-3']);
});

// ============================================================================
// 一门课抓两页（2026-10-29 修复）
// 历史缺陷：逐课同步只抓 stuActiveList（任务/活动），而作业、测验、课堂活动全在
// exam-ans/mooc2/exam/exam-list 里 —— 所以「6 门课全部成功」却一条作业都没进看板。
// ============================================================================
test('planChaoxingCrawl：每门课排两页（任务列表 + 作业/考试列表）', () => {
  const plan = planChaoxingCrawl([
    { courseId: '259363438', clazzId: '139380153', name: '25数据科学34', teacher: '', syncedAt: '' },
  ]);
  assert.equal(plan.length, 1);
  const pages = plan[0]!.pages;
  assert.equal(pages.length, 2);
  assert.deepEqual(
    pages.map((p) => p.kind),
    ['task', 'exam'],
  );
  // 两页各自指向取证过的真实端点，不能互相串。
  assert.equal(
    pages[0]!.url.startsWith('https://mobilelearn.chaoxing.com/page/active/stuActiveList?'),
    true,
  );
  assert.equal(
    pages[1]!.url.startsWith('https://mooc1.chaoxing.com/exam-ans/mooc2/exam/exam-list?'),
    true,
  );
  // url 字段仍等于任务页（历史调用方/日志以它为主地址）。
  assert.equal(plan[0]!.url, pages[0]!.url);
});

test('buildChaoxingExamListUrl：courseid/clazzid 走 URLSearchParams，不硬编码会话令牌 enc', () => {
  const url = buildChaoxingExamListUrl({ courseId: '259363438', clazzId: '139380153' });
  const u = new URL(url);
  assert.equal(u.origin, 'https://mooc1.chaoxing.com');
  assert.equal(u.pathname, '/exam-ans/mooc2/exam/exam-list');
  assert.equal(u.searchParams.get('courseid'), '259363438');
  assert.equal(u.searchParams.get('clazzid'), '139380153');
  // enc 是会话令牌，随登录态变化：硬编码会立刻失效，必须靠“地址记忆”补。
  assert.equal(u.searchParams.has('enc'), false);
  // ID 里的特殊字符要被编码，防止拼接注入额外参数。
  const injected = new URL(buildChaoxingExamListUrl({ courseId: '1&enc=x', clazzId: '2' }));
  assert.equal(injected.searchParams.get('courseid'), '1&enc=x');
  assert.equal(injected.searchParams.has('enc'), false);
});

test('chaoxingCrawlPageKindOf：两页地址都认得出种类，其它地址返回 null', () => {
  assert.equal(
    chaoxingCrawlPageKindOf('https://mobilelearn.chaoxing.com/page/active/stuActiveList?courseid=1'),
    'task',
  );
  assert.equal(
    chaoxingCrawlPageKindOf('https://mooc1.chaoxing.com/exam-ans/mooc2/exam/exam-list?courseid=1'),
    'exam',
  );
  assert.equal(chaoxingCrawlPageKindOf('https://mooc1.chaoxing.com/mooc2/work/list?courseid=1'), null);
  assert.equal(chaoxingCrawlPageKindOf(''), null);
  assert.equal(chaoxingCrawlPageLabel('task'), '任务列表');
  assert.equal(chaoxingCrawlPageLabel('exam'), '作业/考试列表');
});

test('crawlUrlMemoryKey：任务页与作业页各自独立记忆，不会互相覆盖', () => {
  const key = '259363438-139380153';
  assert.notEqual(crawlUrlMemoryKey('task', key), crawlUrlMemoryKey('exam', key));
  // 直接回归旧 bug 的形态：共用一个键时，后成功的页会把前一页的地址顶掉。
  const memory = rememberCourseTaskUrl({}, crawlUrlMemoryKey('task', key), 'https://t/1');
  const next = rememberCourseTaskUrl(memory, crawlUrlMemoryKey('exam', key), 'https://e/1');
  assert.equal(next[crawlUrlMemoryKey('task', key)], 'https://t/1');
  assert.equal(next[crawlUrlMemoryKey('exam', key)], 'https://e/1');
  assert.equal(Object.keys(next).length, 2);
});

test('summarizeChaoxingCrawl：一门课两页只成功一页时，不报“全部成功”', () => {
  // 这是 2026-10-29 用户踩到的坑：任务页全成功、作业页全失败，
  // 汇总却显示「6 门课全部成功」→ 用户以为作业该出现了，实际一条都没有。
  const partial = summarizeChaoxingCrawl([
    { courseKey: 'a-1', name: 'A', ok: true, partial: true, message: '任务列表成功，作业/考试列表失败', pages: [] },
    { courseKey: 'b-2', name: 'B', ok: true, partial: true, message: '任务列表成功，作业/考试列表失败', pages: [] },
  ]);
  assert.equal(partial.includes('全部成功'), false);
  assert.match(partial, /2 门有页面失败/);

  // 两页都成功（无 partial）才允许说「全部成功」。
  const all = summarizeChaoxingCrawl([
    { courseKey: 'a-1', name: 'A', ok: true, message: '两页均成功', pages: [] },
  ]);
  assert.match(all, /全部成功/);
});

// 失败原因必须给出可执行的下一步：只说“超时/未渲染”，用户无从下手。
test('withChaoxingPageAdvice：作业页失败一律指向「先打开一次作业页」，任务页不这么说', () => {
  assert.equal(
    withChaoxingPageAdvice('exam', true, '学习通作业/考试列表：10 项'),
    '学习通作业/考试列表：10 项',
  );

  // 未渲染（缺 enc 的典型表现）与超时（也可能是缺 enc）都要给出同一条可执行动作。
  for (const reason of ['作业/考试列表未渲染或缺少课程标识', '等待页面上报超时（25s）']) {
    const examFail = withChaoxingPageAdvice('exam', false, reason);
    assert.match(examFail, /打开一次该课程的「作业」页/);
    assert.match(examFail, /再重试逐课同步/);
  }

  // 任务页不需要 enc，不能给“打开作业页”这种误导性建议。
  const taskTimeout = withChaoxingPageAdvice('task', false, '等待页面上报超时（25s）');
  assert.doesNotMatch(taskTimeout, /作业」页/);
  assert.match(taskTimeout, /重试逐课同步/);

  // 真·未登录（非超时）仍优先提示登录。
  assert.match(withChaoxingPageAdvice('task', false, '需要登录'), /先.*登录/);
});

// 失败上报里没有 courseIds（页面都没解析出来），只能靠 URL 反推课程键来兑现等待表。
// 否则等待表匹配不上 → 明明页面已经答复“未渲染”，后台仍硬等 25s 并误报成“可能未登录”。
test('crawlCourseKeysOfReport：显式 courseIds 优先，缺失时从 URL 的 courseid/clazzid 兜底', () => {
  const withIds = crawlCourseKeysOfReport({
    url: 'https://mooc1.chaoxing.com/exam-ans/mooc2/exam/exam-list?courseid=1&clazzid=2',
    courseIds: ['9-9'],
  });
  assert.deepEqual(withIds.sort(), ['1-2', '9-9']);

  const urlOnly = crawlCourseKeysOfReport({
    url: 'https://mooc1.chaoxing.com/exam-ans/mooc2/exam/exam-list?courseid=259363438&clazzid=139380153&enc=abc',
  });
  assert.deepEqual(urlOnly, ['259363438-139380153']);

  // 缺一个 ID、或 URL 不可解析时返回空数组（不造半个键，避免误兑现别的课）。
  assert.deepEqual(
    crawlCourseKeysOfReport({ url: 'https://mooc1.chaoxing.com/exam-ans/mooc2/exam/exam-list?courseid=1' }),
    [],
  );
  assert.deepEqual(crawlCourseKeysOfReport({ url: 'not-a-url' }), []);
});

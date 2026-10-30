// 本地只读、去敏的页面 DOM 诊断工具（主动取证版）。
//
// 用途：在无法连接浏览器调试会话时，让用户在已登录的平台页面里一键生成
// “经过过滤的 DOM 摘要”，用于定位作业列表、作业卡片结构、状态文字和详情链接。
//
// 相比第一版的关键升级：
// - 主动识别并点击“作业”类标签（Element UI / 通用标签），等待 SPA 渲染后再扫描，
//   解决此前 courseContentArea 为空（标签未渲染就被抓取）的问题。
// - 额外抓取“作业区可见文本”（innerText，已去敏截断）与“疑似接口路径”（仅 pathname，
//   剥离 query 参数与响应体，符合隐私边界），用于确认“未提交”文案与真实接口。
//
// 隐私边界（来自交接文档）：
// - 仅保留标签名、id、class、有限的可见文本片段、链接路径、data-* 键。
// - 排除表单值、密码、Cookie、Authorization、token、用户标识及长随机字符串。
// - 不读取、不保存、不上传任何会话凭证或个人信息；网络钩子只记录同源 pathname，
//   不读取响应体、不读取 Authorization 头。
//
// 实现说明：本函数通过 scripting.executeScript({ func }) 注入到页面执行，
// 因此必须完全自包含——不得引用任何模块作用域的变量、常量或 import，
// 否则序列化到页面后会因找不到依赖而报错。所有工具函数都定义在函数体内部。

export interface DiagnosticNode {
  tag: string;
  id?: string;
  class?: string;
  text?: string;
  href?: string;
  src?: string;
  data?: Record<string, string>;
  children?: DiagnosticNode[];
}

export interface DiagnosticTab {
  text: string;
  active: boolean;
}

export interface DiagnosticRequest {
  method: string;
  path: string;
}

// 聚焦提取的作业项：每项作业 = 序号 + 标题 + 剩余作答次数 + 状态 + 动作 + 进度条。
// 状态取值来自真实页面：已作答 / 作答中 / 未作答。
export interface DiagnosticAssignment {
  // 序号，如 "00".."17"。
  index: string;
  // 章节 / 作业标题。
  title: string;
  // 剩余作答次数，如 "0" / "1"。
  remainingAttempts: string;
  // 作答状态：已作答 / 作答中 / 未作答。
  status: string;
  // 动作链接文案：详情（已提交）/ 去作答（待提交）。
  action: string;
  // 是否已提交（已作答 = true；作答中 / 未作答 = 待提交）。
  submitted: boolean;
  // 进度条百分比（来自 .el-progress-bar__inner 的内联 width，如 "70%"），可能为 null。
  progress: string | null;
  // 卡片可见文本（去敏截断，作为结构化解析的备查原始片段）。
  text: string;
  // 首页“我的学习任务”结构特有：所属课程与截止时间（本地时间 ISO）。
  courseName?: string;
  dueAt?: string;
  // 备注（泛雅任务页专用）：承载“截止时间： MM-DD HH:MM”等补充文案，
  // 便于诊断阶段确认任务页项的截止信息（正式解析器会转成 dueAt）。
  note?: string;
}

// 作业列表汇总，如“已完成8/18”。
export interface DiagnosticAssignmentSummary {
  done: number;
  total: number;
}

// 学习通考试详情抓取探测：在收件箱框架内直接 fetch 一条考试通知的详情 data-url，
// 回传 fetch 状态 + 结构化解析结果 + 去敏正文样本，用于端到端验证“注意时间”解析链路。
export interface DiagnosticExamProbe {
  // 被探测的详情路径（仅 pathname，去敏）。
  source: string;
  // 取证手段：live-detail-frame（当前帧已是详情页，直接读已渲染 DOM）/
  // injected-iframe（列表页自建同源隐藏 iframe 加载详情后读已渲染 DOM）/
  // none（未能渲染出考试字段）/ exception（探测异常）。
  method: string;
  ok: boolean;
  status: number;
  parsed: {
    courseName: string;
    examTitle: string;
    startAt: string | null;
    endAt: string | null;
  } | null;
  // 详情正文样本（去敏截断），用于人工核对标签文本形态。
  textSample: string;
  error: string | null;
}

// 列表行取证：捕获常见列表容器里每一行的结构（标签/类名/id/data-*/文本/链接/子行文本），
// 用于还原作业/考试列表的真实 DOM——全局 tree 遍历看不出“哪一层是行、行标识在哪”，
// 而行级 data-id / data-rid 正是构造稳定 ID 的关键。
export interface DiagnosticListRow {
  // 命中该行的采样选择器（便于判断列表用的是哪种结构）。
  selector: string;
  tag: string;
  class?: string;
  id?: string;
  data?: Record<string, string>;
  text?: string;
  href?: string;
  childTexts: string[];
}

// 单个候选内容页的取证结论（由 popup 侧在“开临时标签”取数后回填）。
// 用于定位“为什么某个标签（作业/考试）诊断不出内容”：是没拼对地址、被重定向到登录页，
// 还是页面本身只是个空壳（列表在更深一层 iframe 里）。
export interface DiagnosticCandidateProbe {
  // 去敏后的候选地址（仅 origin + pathname）。
  url: string;
  // 0 = 外壳直接给出的候选；1 = 从候选页里再发现的内嵌 iframe。
  depth: number;
  hostname: string;
  title: string;
  mainTextLength: number;
  rowCount: number;
  adopted: boolean;
  reason?: string;
  // 正文前 200 字：一眼分辨“登录页 / 错误页 / 空列表 / 真列表”。
  textSample?: string;
}

export interface DiagnosticReport {
  url: string;
  title: string;
  // 当前标签页所属域名（取自 window.location.hostname，完全自包含）。
  // 用于确认诊断证据来自哪个平台，便于与 PLATFORM_HOSTS 对照（尤其是 iTEST 的
  // sso.unipus.cn 登录域与 itestcloud.unipus.cn 作业域分属同一平台）。
  hostname: string;
  generatedAt: string;
  truncated: boolean;
  // 本次是否主动点击了“作业”类标签（用于判断是否触发了二次渲染）。
  clickedAssignmentTab: boolean;
  // 内容区（如 .el-tabs__item）检测到的标签及激活状态。
  tabs: DiagnosticTab[];
  // 顶部菜单项文本（用于确认当前所在模块）。
  menuItems: string[];
  // 作业区（优先 .courseContentArea，否则整页）的可见文本，已去敏截断。
  mainText: string;
  // 疑似作业/课程相关接口路径（仅同源 pathname，已剥离查询参数）。
  requests: DiagnosticRequest[];
  // 学习通考试详情抓取探测结果（仅学习通页面且存在消息列表时非空）。
  examProbe: DiagnosticExamProbe | null;
  // 作业列表汇总（如“已完成8/18”），无则为 null。
  assignmentSummary: DiagnosticAssignmentSummary | null;
  // 聚焦提取的作业项（序号 / 标题 / 剩余次数 / 状态 / 动作 / 进度）。
  assignments: DiagnosticAssignment[];
  classNames: string[];
  anchors: string[];
  tree: DiagnosticNode[];
  // 外壳主文档内嵌的内容 iframe 完整 URL（任务列表 mobilelearn / 作业·考试列表 mooc1）。
  // 用于诊断时“开独立标签”定向取证，绕过跨域帧注入时机/权限问题。只在 chaoxing 域收集。
  contentFrameUrls?: string[];
  // 列表行取证（见 DiagnosticListRow）：还原列表结构用。
  listRows?: DiagnosticListRow[];
  // 候选内容页逐个开标签取证的结论（诊断弹窗侧写入）。
  // 没有它就只能看到“未取到有效正文”，无法回答“作业/考试为什么诊断不出来”。
  candidateProbes?: DiagnosticCandidateProbe[];
  // 当前页面 URL 的查询参数（courseid / clazzid / cpi 等），是构造跨课程稳定 ID 的必需信息。
  // 长随机令牌（stuenc 之类会话凭证）已脱敏。
  pageParams?: Record<string, string>;
}

export async function collectPageDiagnostic(): Promise<DiagnosticReport> {
  // ============ 自包含工具函数（注入页面后独立运行，禁止引用外部作用域） ============

  const LONG_TOKEN = 40;

  const isLongToken = (value: string): boolean => {
    const t = value.trim();
    if (t.length <= LONG_TOKEN) return false;
    return /^[\w\-+.=/]+$/.test(t);
  };

  const redactText = (value: string): string => {
    const t = value.replace(/\s+/g, ' ').trim();
    if (!t) return t;
    if (isLongToken(t)) return '[已脱敏-长随机串]';
    return t.slice(0, 100);
  };

  // 把长随机串替换成占位，用于大段文本去敏（避免泄露 token / 会话串）。
  const redactLongTokens = (value: string): string =>
    value.replace(/[\w\-+.=/]{40,}/g, '[已脱敏]');

  const safeHref = (href: string): string => {
    try {
      const u = new URL(href, window.location.href);
      if (u.origin !== window.location.origin) {
        return `${u.origin}${u.pathname} [外部链接]`;
      }
      if (u.search) {
        return `${u.pathname}?…[查询参数已省略]`;
      }
      return u.pathname;
    } catch {
      return href.slice(0, 120);
    }
  };

  const safePageUrl = (): string => {
    try {
      const u = new URL(window.location.href);
      let result = u.pathname;
      if (u.hash) result += redactLongTokens(u.hash);
      if (u.search) result += '?…[查询参数已省略]';
      return result;
    } catch {
      return window.location.href.slice(0, 200);
    }
  };

  // 仅记录同源 pathname，剥离查询参数；跨域只返回 origin+pathname 并标记。
  const safeRequestPath = (input: string): string | null => {
    try {
      const u = new URL(input, window.location.href);
      if (u.origin !== window.location.origin) {
        return `${u.origin}${u.pathname} [外部]`;
      }
      return u.pathname;
    } catch {
      return null;
    }
  };

  const looksLikeAssignmentApi = (path: string): boolean =>
    /(student|exam|course|assignment|homework|task|paper|work|learn|chapter|resource|study)/i.test(
      path,
    );

  const directText = (el: Element): string => {
    let t = '';
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        t += node.textContent ?? '';
      }
    }
    return redactText(t);
  };

  const SKIP_TAGS = new Set<string>([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'META', 'LINK', 'HEAD',
    'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'BUTTON',
    'IMG', 'SVG', 'PATH', 'CANVAS', 'VIDEO', 'AUDIO',
    'TEMPLATE',
  ]);

  // 深度 12 会在「我的课程」页刚好截断到 .course-info（h3 里的 <a> 课程名看不到），
  // 抬到 14 以便取证时能看到卡片内部真实文本。
  const MAX_DEPTH = 14;
  const MAX_CHILDREN = 40;
  const MAX_NODES = 2000;

  const walk = (
    el: Element,
    depth: number,
    state: { count: number; truncated: boolean },
  ): DiagnosticNode | null => {
    if (state.count >= MAX_NODES) {
      state.truncated = true;
      return null;
    }
    state.count += 1;

    const node: DiagnosticNode = { tag: el.tagName.toLowerCase() };

    // iframe 不跨域下钻（可能跨域或被注入浮层），仅记录其 src 以便判断内容宿主。
    if (el.tagName === 'IFRAME') {
      const src = el.getAttribute('src');
      if (src) node.src = src.slice(0, 200);
      return node;
    }

    if (el.id) node.id = el.id.slice(0, 120);

    const className = typeof el.className === 'string' ? el.className.trim() : '';
    if (className) node.class = className.slice(0, 160);

    const data: Record<string, string> = {};
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith('data-')) {
        const v = attr.value;
        data[attr.name] = isLongToken(v) ? '[已脱敏]' : v.slice(0, 80);
      }
    }
    if (Object.keys(data).length) node.data = data;

    if (el.tagName === 'A') {
      const href = el.getAttribute('href');
      if (href) node.href = safeHref(href);
    }

    const text = directText(el);
    if (text) node.text = text;

    if (depth < MAX_DEPTH) {
      const children: DiagnosticNode[] = [];
      for (const child of Array.from(el.children)) {
        if (SKIP_TAGS.has(child.tagName)) continue;
        if (children.length >= MAX_CHILDREN) {
          state.truncated = true;
          break;
        }
        const cn = walk(child, depth + 1, state);
        if (cn) children.push(cn);
      }
      if (children.length) node.children = children;
    }

    return node;
  };

  const collect = (
    node: DiagnosticNode,
    classNames: Set<string>,
    anchors: string[],
  ): void => {
    if (node.class) {
      for (const c of node.class.split(/\s+/)) {
        if (c) classNames.add(c);
      }
    }
    if (node.href) anchors.push(node.href);
    if (node.children) {
      for (const child of node.children) collect(child, classNames, anchors);
    }
  };

  const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => window.setTimeout(resolve, ms));

  // 内容 iframe 轮询等待：mobilelearn.chaoxing.com（任务/活动列表）与 mooc1.chaoxing.com
  // （作业/考试列表）的列表由前端 XHR 异步渲染，注入执行时正文往往尚空。若当前帧正是这两类
  // 内容帧，则轮询等待其 body 出现任务/状态类文本后再读取，最多 ~6s；超时也不阻塞（仍返回已抓到的）。
  // 该分支与“外壳主文档”逻辑互斥：外壳（mooc2-ans）不含列表，由点击标签 + 等待负责。
  const isContentFrame =
    /(^|\.)mobilelearn\.chaoxing\.com$|(^|\.)mooc1\.chaoxing\.com$/.test(
      window.location.hostname,
    );
  if (isContentFrame) {
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      const t = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
      if (
        t.length > 40 &&
        /(未完成|待批阅|已完成|已退回|重考|进行中|已结束|作业|考试|任务|随堂练习|测验|章节)/.test(
          t,
        )
      ) {
        break;
      }
      await wait(400);
    }
  }

  // 检测内容区标签（Element UI 的 .el-tabs__item，以及通用 .ant-tabs-tab / [role=tab]）。
  const detectTabs = (): DiagnosticTab[] => {
    const tabs: DiagnosticTab[] = [];
    const selectors = ['.el-tabs__item', '.ant-tabs-tab', '[role="tab"]'];
    for (const sel of selectors) {
      for (const el of Array.from(document.querySelectorAll(sel))) {
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text) continue;
        const isActive =
          el.classList.contains('is-active') ||
          el.classList.contains('ant-tabs-tab-active') ||
          el.getAttribute('aria-selected') === 'true';
        tabs.push({ text: text.slice(0, 40), active: isActive });
      }
    }
    return tabs;
  };

  const detectMenuItems = (): string[] => {
    const items: string[] = [];
    for (const el of Array.from(document.querySelectorAll('.el-menu-item, .el-sub-menu__title'))) {
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) items.push(text.slice(0, 40));
    }
    return items;
  };

  // 主动寻找并点击“作业”类标签：文本以“作业/任务/考试/收件箱/消息/待办”开头、字数很少、且是叶子或接近叶子的可点击节点。
  // 注意：泛雅课程页左侧菜单的“任务/作业/考试”只是打开“列表页”（查看作业/考试/任务清单），
  // 并非进入“答题/交卷”页，点击它们安全、不违反“绝不误点考试按钮启动答题”铁律。
  const findAssignmentTab = (): HTMLElement | null => {
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!/^(作业|任务|考试|收件箱|消息|未读|待办)/.test(text)) continue;
      if (text.length > 16) continue;
      if (el.children.length > 3) continue;
      if (el.tagName === 'BODY' || el.tagName === 'HTML') continue;
      const tagName = el.tagName.toLowerCase();
      const cls = typeof el.className === 'string' ? el.className : '';
      const clickable =
        tagName === 'a' ||
        tagName === 'button' ||
        /tab|menu|item|click|cursor-pointer/.test(cls) ||
        (el as HTMLElement).onclick != null;
      if (!clickable) continue;
      return el as HTMLElement;
    }
    return null;
  };

  // 聚焦提取作业项：基于“作业区可见文本”按真实结构解析，并扫描 DOM 进度条。
  // 真实结构（来自东软课程详情 → 作业标签）：
  //   <两位序号><中文标题> 课后 剩余作答次数：N 进行中 状态： 已作答|作答中|未作答
  //   公布答案：截止后自动公布 公布成绩：截止后自动公布 <详情|去作答>
  // 另：DOM 中的 .el-progress-bar__inner 进度条按位置与作业项关联（数量一致时）。
  const extractAssignments = (
    text: string,
  ): {
    items: DiagnosticAssignment[];
    summary: DiagnosticAssignmentSummary | null;
    progressBars: string[];
  } => {
    // 1) 汇总：已完成 X/Y
    const summaryMatch = text.match(/已完成\s*(\d+)\s*\/\s*(\d+)/);
    let summary: DiagnosticAssignmentSummary | null = summaryMatch
      ? { done: Number(summaryMatch[1]), total: Number(summaryMatch[2]) }
      : null;

    // 2) 逐项解析。
    //    用 (?=[\u4e00-\u9fff]) 确保序号后紧跟中文标题，避免误命中“已完成8/18”里的“18”。
    const items: DiagnosticAssignment[] = [];
    const itemRe =
      /(\d{2})(?=[\u4e00-\u9fff])(.+?)\s+课后\s+剩余作答次数：(\d+)\D*?状态：\s*(已作答|作答中|未作答)[\s\S]*?(详情|去作答)/g;
    let m: RegExpExecArray | null;
    while ((m = itemRe.exec(text)) !== null) {
      const index = m?.[1] ?? '';
      const title = (m?.[2] ?? '').replace(/\s+/g, ' ').trim();
      const remainingAttempts = m?.[3] ?? '';
      const status = m?.[4] ?? '';
      const action = m?.[5] ?? '';
      items.push({
        index,
        title,
        remainingAttempts,
        status,
        action,
        submitted: status === '已作答',
        progress: null,
        text: redactLongTokens(m?.[0] ?? '').slice(0, 260),
      });
    }

    // 2.5) 首页“我的学习任务”结构（跨课程，每项自带所属课程与截止时间）：
    //   <序号?><标题> 作业 截止时间：YYYY-MM-DD HH:MM:SS所属课程：<课程名> 去作答
    //   仅在课程详情结构一无所获时启用，两种结构互斥。
    // 与 src/neusoft.ts 的 parseNeusoftHomeTasks 同构（注入页面必须自包含，故在此复制一份）：
    // 用锚点定位每项，标题取“上一个锚点结尾 ~ 本锚点开头”的文本，并剔除首项前的界面文案。
    if (items.length === 0 && /所属课程：/.test(text)) {
      // 类型标签不能写死（实测有“作业/测验/考试”），只锚定“截止时间+所属课程+去作答”。
      const homeRe =
        /截止时间：(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s*所属课程：(.+?)\s*去作答/g;
      const markers = ['去作答', '请选择所属课程', '作答中', '我的学习任务'];
      let prevEnd = 0;
      let hm: RegExpExecArray | null;
      while ((hm = homeRe.exec(text)) !== null) {
        const start = hm.index ?? 0;
        let cut = 0;
        for (const mk of markers) {
          const at = text.slice(prevEnd, start).lastIndexOf(mk);
          if (at >= 0) cut = Math.max(cut, at + mk.length);
        }
        let region = text.slice(prevEnd + cut, start).trim();
        prevEnd = start + (hm[0]?.length ?? 0);

        const idxMatch = region.match(/^(\d+)(?=[\u4e00-\u9fff])/);
        const index = idxMatch?.[1] ?? '';
        if (index) region = region.slice(index.length);
        // 剥掉标题末尾的类型标签（“《新思想概论》测验三 测验 作业” → “《新思想概论》测验三”），
        // 有的行会同时渲染多个标签，故最多连续剥 3 次。
        for (let k = 0; k < 3; k += 1) {
          const token = region.match(/(?:^|\s)(\S{1,6})$/)?.[1];
          if (!token || !/作业|测验|考试|实验|练习|测试|讨论|互评|任务/.test(token)) break;
          const next = region.slice(0, region.length - token.length).trim();
          if (!next) break;
          region = next;
        }
        const title = region.replace(/\s+/g, ' ').trim();
        const courseName = (hm?.[2] ?? '').replace(/\s+/g, ' ').trim();
        if (!title || !courseName) continue;
        items.push({
          index,
          title,
          remainingAttempts: '-',
          status: '未提交',
          action: '去作答',
          submitted: false,
          progress: null,
          text: redactLongTokens(hm?.[0] ?? '').slice(0, 260),
          courseName,
          dueAt: (hm?.[1] ?? '').replace(' ', 'T'),
        });
      }
    }

    // 3) 进度条：扫描 DOM 中的 .el-progress-bar__inner，数量一致时按位置回填。
    const progressBars: string[] = [];
    try {
      const inners = Array.from(
        document.querySelectorAll('.el-progress-bar__inner'),
      ) as HTMLElement[];
      for (const inner of inners) {
        const style = inner.getAttribute('style') || '';
        const pm = style.match(/width\s*:\s*([\d.]+%)/i);
        progressBars.push(pm?.[1] ?? '');
      }
      if (progressBars.length === items.length) {
        items.forEach((it, i) => {
          it.progress = progressBars[i] || null;
        });
      }
    } catch {
      /* 进度条扫描失败不影响主解析 */
    }

    // 4) 泛雅课程页（mooc1/mooc2-ans.chaoxing.com）的「作业/考试/任务」列表提取。
    //    仅当东软结构一无所获、且当前域为泛雅课程页（排除收件箱 notice.chaoxing.com）、
    //    且文本含泛雅特有的状态文案时才启用。这些页面由可见文本直接暴露
    //    “未完成/待批阅/已完成/已退回/重考/进行中/已结束”等状态，与学习通收件箱
    //    （只发通知、无提交状态）是两套结构，互不干扰。
    if (
      items.length === 0 &&
      /chaoxing/.test(window.location.hostname) &&
      !/notice\.chaoxing\.com/.test(window.location.hostname) &&
      /(未完成|未交|待批阅|已完成|已退回|重考|进行中|已结束)/.test(text)
    ) {
      const cItems: DiagnosticAssignment[] = [];
      // 4a-0) 结构优先：作业/考试列表的实测结构（2026-10-29 真实 DOM 取证）
      //   .bottomList li > div > div.right-content
      //              > p.overHidden2.fl  "线代作业4"   ← 标题
      //              > p.status.fl       "已完成"      ← 状态（每行各一个）
      // 必须优先于下面的文本正则：正则以「作业/测验」开头匹配，会把标题里的课程前缀吃掉
      // （「线代测验4」→「测验4」），诊断结论与看板对不上，反而误导判断。
      const structRows: DiagnosticAssignment[] = [];
      try {
        for (const list of Array.from(document.querySelectorAll('.bottomList'))) {
          for (const li of Array.from(list.querySelectorAll('li'))) {
            const titleText = (li.querySelector('.overHidden2')?.textContent || '')
              .replace(/\s+/g, ' ')
              .trim();
            const statusText = (li.querySelector('.status')?.textContent || '')
              .replace(/\s+/g, ' ')
              .trim();
            if (!titleText || !statusText) continue;
            structRows.push({
              index: '',
              title: titleText,
              remainingAttempts: '-',
              status: statusText,
              action: '',
              submitted: /已完成|已提交|已通过|已批阅/.test(statusText),
              progress: null,
              text: redactLongTokens((li.textContent || '').replace(/\s+/g, ' ').trim()).slice(
                0,
                260,
              ),
            });
          }
        }
      } catch {
        // 结构读取失败（页面已改版）：退回下面的文本正则。
      }
      if (structRows.length > 0) {
        cItems.push(...structRows);
      } else {
        // 4a) 作业/考试列表（正则兜底）：每条 = 类型词 + 标题片段 + 状态文案。
        //     两个已修复的坑（2026-10-29 实测样本「线代作业3 已过期 线代测验2 已完成」）：
        //     ① 状态词表缺「已过期」→ 从「作业」一路懒匹配到下一行的「已完成」，
        //        产出一条 title=「3 已过期 线代测验2」的串行记录；
        //     ② 跨度只限长度（80 字）不限内容 → 会跨过整条相邻记录。
        //     现在把状态词补全，并要求跨度内**不得再出现类型词**（下一个“作业/测验/考试”
        //     一出现就说明已经进了下一条，必须收手）。
        const statusRe =
          /(作业|考试|随堂练习|测验|讨论)((?:(?!作业|考试|随堂练习|测验|讨论)[\s\S]){0,80}?)(已完成|未完成|未交|未提交|待批阅|已退回|重考|已过期|已截止)/g;
        let sm: RegExpExecArray | null;
        while ((sm = statusRe.exec(text)) !== null) {
          const rawStatus = sm[3] ?? '';
          const submitted = rawStatus === '已完成' || rawStatus === '待批阅' || rawStatus === '重考';
          cItems.push({
            index: '',
            // 类型词要留在标题里：只取 (sm[2]) 会得到「3」「4」这种读不出是什么作业的片段。
            title: `${sm[1] ?? ''}${(sm[2] ?? '').replace(/\s+/g, ' ').trim()}`.slice(0, 120),
            remainingAttempts: '-',
            status: rawStatus,
            action: rawStatus === '重考' ? '重考' : '',
            submitted,
            progress: null,
            text: redactLongTokens(sm[0] ?? '').slice(0, 260),
          });
        }
      }
      // 4b) 任务页（随堂练习等）：无逐条提交状态文案，按“进行中/已结束”分组标题判定完成——
      //     进行中=待做，已结束=已完成（按用户拍板：活动窗口结束即视为完成）。
      const inPos = text.search(/进行中\s*\(/);
      const endPos = text.search(/已结束\s*\(/);
      const taskRe = /(随堂练习|作业|任务)([\s\S]{0,120}?)截止时间：\s*([\d-]+\s*[\d:]+)/g;
      let tm: RegExpExecArray | null;
      while ((tm = taskRe.exec(text)) !== null) {
        const itemPos = tm.index ?? 0;
        const inEnded = endPos >= 0 && itemPos > endPos;
        const inProgress = endPos < 0 ? inPos >= 0 && itemPos > inPos : inPos >= 0 && itemPos > inPos && itemPos < endPos;
        const taskStatus = inEnded ? '已结束' : inProgress ? '进行中' : '任务';
        cItems.push({
          index: '',
          title: (tm[2] ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),
          remainingAttempts: '-',
          status: taskStatus,
          action: '',
          submitted: taskStatus === '已结束',
          progress: null,
          text: redactLongTokens(tm[0] ?? '').slice(0, 260),
          note: `截止 ${tm[3] ?? ''}`,
        });
      }
      if (cItems.length > 0) {
        items.push(...cItems);
        // 任务页汇总：已结束(done) / 进行中+已结束(total)。
        const inN = text.match(/进行中\s*\((\d+)\)/);
        const endN = text.match(/已结束\s*\((\d+)\)/);
        if (inN || endN) {
          const done = endN ? Number(endN[1]) : 0;
          const total = (inN ? Number(inN[1]) : 0) + done;
          summary = { done, total };
        } else if (!summary && structRows.length > 0) {
          // 作业/考试列表没有「已完成 X/Y」这类汇总文案，但每行都带状态，
          // 就按行统计一个等价口径（done=已完成，total=总行数）。
          // 否则诊断的 summary 恒为 null，用户看不出“到底解析出几项、完成几项”。
          summary = {
            done: structRows.filter((r) => r.submitted).length,
            total: structRows.length,
          };
        }
      }
    }

    return { items, summary, progressBars };
  };

  // 学习通考试详情抓取探测（自包含，注入后独立运行）：
  // 关键取证点 —— 此前“fetch 一条考试通知详情”返回的是 SPA 外壳（仅工具栏 + 内联脚本，
  // 不含考试字段），故 parsed 恒为 null。考试字段（课程名称/考试名称/开始/结束时间/考试形式）
  // 由前端 JS 异步渲染进 DOM，必须读取“已渲染的实时 DOM”才能拿到。
  // 本探针分两种情形取证：
  //   情形 A（诊断时若已点开某条通知，或对详情帧注入）：当前帧 URL 含 /detail，
  //            直接读取 document.body.innerText（已渲染）并解析。
  //   情形 B（列表页）：自建一个同源隐藏 iframe 加载该详情（等价手动点开，但主页面不跳转、
  //            也不会点到“考试”按钮误入答题），待其 JS 渲染后读取 contentDocument.body.innerText。
  //            同时保留 fetch 静态 HTML 作为对照（预期 only 外壳）。
  // 这样能确认“实时 DOM 是否含考试字段”，为正式解析器落地提供证据。
  const probeExamDetail = async (): Promise<DiagnosticExamProbe | null> => {
    try {
      if (!/(^|\.)chaoxing\.com$/.test(window.location.hostname)) return null;

      const parseExam = (
        raw: string,
        year: number,
        noticeMonthDay?: number,
      ): { courseName: string; examTitle: string; startAt: string | null; endAt: string | null } | null => {
        const flat = (raw || '').replace(/\s+/g, ' ').trim();
        if (!flat) return null;
        const grab = (label: string, stopLabels: string[]): string => {
          const stops = stopLabels.map((s) => `(?=${s})`).join('|');
          const m = flat.match(new RegExp(`${label}\\s*[：:]\\s*(.*?)\\s*(?:${stops}|$)`));
          return (m?.[1] || '').trim();
        };
        const courseName = grab('课程名称', ['考试名称', '考试时间', '考试时长', '开始时间', '结束时间', '考试形式']);
        const examTitle = grab('考试名称', ['考试时间', '考试时长', '开始时间', '结束时间', '考试形式']);
        const startRaw = flat.match(/开始时间\s*[：:]\s*(\d{4}-\d{2}-\d{2})\s*(\d{2}:\d{2}(?::\d{2})?)/);
        const endRaw = flat.match(/结束时间\s*[：:]\s*(\d{4}-\d{2}-\d{2})\s*(\d{2}:\d{2}(?::\d{2})?)/);
        // 格式 2（2026-10-23 看板截图证据）：考试时间： MM-DD HH:MM 至 MM-DD HH:MM（无年份）。
        const rangeRaw = flat.match(
          /考试时间\s*[：:]\s*((?:\d{4}-)?\d{2}-\d{2})\s*(\d{2}:\d{2}(?::\d{2})?)\s*至\s*((?:\d{4}-)?\d{2}-\d{2})\s*(\d{2}:\d{2}(?::\d{2})?)/,
        );
        if (!examTitle && !endRaw && !rangeRaw) return null;
        // 年份补齐：year 由调用方按“列表发送时间”锚定的真实年份传入（与 chaoxing.ts 规则 1b 一致）；
        // 跨年用“考试 MM-DD < 通知 MM-DD”精确判定（如 12 月通知 1 月考 → 次年）。无通知时间时
        // 回退到“落后 180 天即翻年”的粗略启发式。
        const nowMs = Date.now();
        const YEARLESS_ROLL_THRESHOLD_MS = 180 * 24 * 60 * 60 * 1000;
        const yearless = (d: string | undefined): boolean => !!d && /^\d{2}-\d{2}$/.test(d);
        const mdOf = (d: string | undefined): number | null => {
          const m = (d ?? '').match(/(\d{1,2})-(\d{1,2})/);
          return m ? Number(m[1]) * 100 + Number(m[2]) : null;
        };
        const rangeIso = (date: string | undefined, hm: string | undefined, offset = 0): string | null => {
          if (!date || !hm) return null;
          if (!/^\d{2}-\d{2}$/.test(date) && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
          return `${/^\d{4}-/.test(date) ? date : `${year + offset}-${date}`}T${hm}`;
        };
        const shiftYear = (iso: string, n: number): string | null => {
          const m = iso.match(/^(\d{4})-(\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)$/);
          return m ? `${Number(m[1]) + n}-${m[2] ?? ''}` : null;
        };
        const maybeBump = (iso: string | null, dateStr: string | undefined): string | null => {
          if (!iso || noticeMonthDay == null) return iso;
          const emd = mdOf(dateStr);
          return emd != null && emd < noticeMonthDay ? shiftYear(iso, 1) : iso;
        };
        let startAt = maybeBump(
          startRaw ? `${startRaw[1] ?? ''}T${startRaw[2] ?? ''}` : rangeIso(rangeRaw?.[1], rangeRaw?.[2]),
          rangeRaw?.[1],
        );
        let endAt = maybeBump(
          endRaw ? `${endRaw[1] ?? ''}T${endRaw[2] ?? ''}` : rangeIso(rangeRaw?.[3], rangeRaw?.[4]),
          rangeRaw?.[3],
        );
        // 回退：无通知时间可供精确判定时，才用“落后 180 天即翻年”的粗略启发式。
        if (noticeMonthDay == null && !endRaw && endAt && yearless(rangeRaw?.[3])) {
          const endT = new Date(endAt).getTime();
          if (!Number.isNaN(endT) && nowMs - endT > YEARLESS_ROLL_THRESHOLD_MS) {
            const s2 = startAt ? shiftYear(startAt, 1) : null;
            const e2 = shiftYear(endAt, 1);
            if (e2) {
              startAt = s2;
              endAt = e2;
            }
          }
        }
        return {
          courseName,
          examTitle,
          startAt,
          endAt,
        };
      };

      // 由列表行的发送时间文本推导该通知的“真实年份”与“月日”（与 resolveChaoxingNoticeYears 同类，
      // 用于探针逐条取证时给每条详情页补齐正确年份并做精确跨年判定）。
      const resolveYearFromNotice = (noticeTimeText: string): number => {
        const m = (noticeTimeText || '').match(/(\d{1,2})-(\d{1,2})/);
        const thisYear = new Date().getFullYear();
        if (!m) return thisYear;
        const d = new Date(thisYear, Number(m[1]) - 1, Number(m[2]));
        return Math.abs(d.getTime() - Date.now()) > 300 * 86400000 ? thisYear - 1 : thisYear;
      };
      const noticeMonthDayOf = (noticeTimeText: string): number | undefined => {
        const m = (noticeTimeText || '').match(/(\d{1,2})-(\d{1,2})/);
        return m ? Number(m[1]) * 100 + Number(m[2]) : undefined;
      };

      const isDetailFrame = /\/detail/.test(window.location.pathname);

      // 情形 A：当前帧本身已是详情页（诊断时若用户已点开某条通知，或对详情帧注入执行）。
      if (isDetailFrame) {
        const liveRaw = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
        // 情形 A 无列表发送时间可锚定，按当前年补齐（跨年由 now-180d 回退兜底）。
        const parsed = parseExam(liveRaw, new Date().getFullYear());
        let source = window.location.pathname;
        try {
          source = new URL(window.location.href).pathname;
        } catch {
          /* 保持 pathname */
        }
        return {
          source,
          method: 'live-detail-frame',
          ok: true,
          status: 200,
          parsed,
          textSample: redactLongTokens(liveRaw).slice(0, 1500),
          error: null,
        };
      }

      // 情形 B：列表页 —— 依次探测前 6 条“考试”消息（自建同源隐藏 iframe 读实时 DOM），
      // **优先回传解析失败（parsed=null）的那条**：看板上“未提供截止时间”的条目正来自
      // 解析失败的详情页，它们才是需要取证的对象（此前只探首条，若前几条恰好可解析会错过失败样本）。
      // 全部可解析时回传首条。每条按其列表发送时间锚定真实年份。fetch 静态 HTML 仅作对照。
      const examTargets: { open: Element; noticeTime: string }[] = [];
      for (const li of Array.from(document.querySelectorAll('li.dataBody_item'))) {
        const t = (li.querySelector('.notice_title')?.textContent || '').trim();
        if (/^考试/.test(t)) {
          const open = li.querySelector('.openNotice[data-url]');
          const noticeTime = (li.querySelector('.notice_time')?.textContent || '').replace(/\s+/g, ' ').trim();
          if (open) {
            examTargets.push({ open, noticeTime });
            if (examTargets.length >= 6) break;
          }
        }
      }
      if (!examTargets.length) {
        const only = document.querySelector('li.dataBody_item .openNotice[data-url]');
        if (only) examTargets.push({ open: only, noticeTime: '' });
      }
      if (!examTargets.length) return null;

      const waitForRender = async (
        pred: () => boolean,
        timeoutMs = 5000,
        intervalMs = 200,
      ): Promise<void> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          let ok = false;
          try {
            ok = pred();
          } catch {
            ok = false;
          }
          if (ok) return;
          await wait(intervalMs);
        }
      };

      // 单条取证：fetch 外壳对照 + 自建隐藏 iframe 读已渲染 DOM（主页面不跳转、不误点“考试”）。
      const probeOne = async (absUrl: string): Promise<{ liveRaw: string; method: string }> => {
        let liveRaw = '';
        let method = 'none';
        try {
          const frame = document.createElement('iframe');
          frame.style.display = 'none';
          frame.src = absUrl;
          document.body.appendChild(frame);
          await waitForRender(() => {
            const d = (frame as HTMLIFrameElement).contentDocument;
            if (!d || !d.body) return false;
            const txt = (d.body.innerText || '').replace(/\s+/g, ' ').trim();
            return /考试名称|考试时间|开始时间|结束时间/.test(txt);
          });
          const d = (frame as HTMLIFrameElement).contentDocument;
          if (d && d.body) {
            liveRaw = (d.body.innerText || '').replace(/\s+/g, ' ').trim();
            method = 'injected-iframe';
          }
          frame.remove();
        } catch (e) {
          liveRaw = 'live-error:' + String(e).slice(0, 120);
          method = 'exception';
        }
        return { liveRaw, method };
      };

      let result: DiagnosticExamProbe | null = null;
      for (const { open, noticeTime } of examTargets) {
        const rel = open.getAttribute('data-url') || '';
        if (!rel) continue;
        const abs = new URL(rel, window.location.href).toString();
        const source = (() => {
          try {
            return new URL(abs).pathname;
          } catch {
            return rel;
          }
        })();
        const year = resolveYearFromNotice(noticeTime);
        const nmd = noticeMonthDayOf(noticeTime);

        // 对照：fetch 静态 HTML（预期 only 外壳）。
        let fetchStatus = 0;
        let fetchOk = false;
        let fetchRaw = '';
        try {
          const res = await fetch(abs, { credentials: 'include' });
          fetchStatus = res.status;
          fetchOk = res.ok;
          const html = res.ok ? await res.text() : '';
          const doc = new DOMParser().parseFromString(html, 'text/html');
          fetchRaw = (doc.body?.textContent || '').replace(/\s+/g, ' ').trim();
        } catch (e) {
          fetchRaw = 'fetch-error:' + String(e).slice(0, 120);
        }

        const { liveRaw, method } = await probeOne(abs);
        const bestRaw =
          liveRaw && !liveRaw.startsWith('live-error') && !liveRaw.startsWith('fetch-error')
            ? liveRaw
            : fetchRaw;
        const parsed = parseExam(bestRaw, year, nmd);
        const probe: DiagnosticExamProbe = {
          source,
          method,
          ok: fetchOk,
          status: fetchStatus,
          parsed,
          textSample: redactLongTokens(bestRaw).slice(0, 1500),
          error: null,
        };
        if (!parsed) {
          result = probe; // 解析失败样本优先取证回传
          break;
        }
        if (!result) result = probe;
      }
      return result;
    } catch (e) {
      return {
        source: '',
        method: 'exception',
        ok: false,
        status: 0,
        parsed: null,
        textSample: '',
        error: String(e).slice(0, 200),
      };
    }
  };

  // ============ 主流程 ============

  // 1) 安装轻量网络钩子：记录同源、疑似作业相关接口的 pathname（不含 query / 不含响应体）。
  const requests: DiagnosticRequest[] = [];
  try {
    const origOpen = XMLHttpRequest.prototype.open;
    const patchedOpen = function (
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null,
    ): void {
      const path = safeRequestPath(String(url));
      if (path && looksLikeAssignmentApi(path)) {
        requests.push({ method: String(method).toUpperCase(), path });
      }
      origOpen.call(this, method, url, async ?? true, username ?? null, password ?? null);
    };
    (XMLHttpRequest.prototype as { open: typeof patchedOpen }).open = patchedOpen;
  } catch {
    /* 钩子安装失败不应中断诊断 */
  }
  try {
    const origFetch = window.fetch.bind(window);
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url || '';
      const path = safeRequestPath(String(url));
      const method = (init && init.method) || (input instanceof Request ? input.method : 'GET') || 'GET';
      if (path && looksLikeAssignmentApi(path)) {
        requests.push({ method: String(method).toUpperCase(), path });
      }
      return origFetch(input as RequestInfo, init);
    };
  } catch {
    /* 钩子安装失败不应中断诊断 */
  }

  // 2) 先记录点击前的标签与菜单，便于对比。
  const beforeTabs = detectTabs();

  // 3) 主动点击“作业”标签（若存在且未激活），等待渲染。
  //    内容 iframe（mobilelearn/mooc1）已是列表页，无需、也不应再点内部标签，直接跳过。
  let clickedAssignmentTab = false;
  const tab = isContentFrame ? null : findAssignmentTab();
  if (tab) {
    try {
      tab.click();
      clickedAssignmentTab = true;
      await wait(1300);
    } catch {
      clickedAssignmentTab = false;
    }
  } else {
    // 没找到明确“作业”标签时，也等一会儿，给异步组件渲染留时间。
    await wait(800);
  }

  // 4) 重新扫描 DOM（点击/等待后内容应已渲染）。
  const state = { count: 0, truncated: false };
  const tree = document.body
    ? ([walk(document.body, 0, state)].filter(Boolean) as DiagnosticNode[])
    : [];

  const classNames = new Set<string>();
  const anchors: string[] = [];
  for (const root of tree) collect(root, classNames, anchors);

  // 5) 抓取作业区可见文本：优先 .courseContentArea，回退到 .v-content-wrap，再回退整页 body。
  //    这样即使作业列表渲染在内容区的其它容器，也能被抓到。
  let mainText = '';
  try {
    // 首页优先只取“我的学习任务”区块本身：`.my-task` 同时还包住“我的考试/我的项目”，
    // 会带入无关文本与空态（`.noData`），干扰解析判定。
    const findHomeBlock = (): HTMLElement | null => {
      for (const el of Array.from(document.querySelectorAll('span, div, h2, h3, h4'))) {
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!t.startsWith('我的学习任务') || t.length > 10) continue;
        let node = el.parentElement;
        let first: HTMLElement | null = null;
        for (let d = 0; node && d < 5; d += 1) {
          if (!first) first = node;
          if (/去作答/.test((node as HTMLElement).innerText || '')) return node;
          node = node.parentElement;
        }
        return first;
      }
      return null;
    };

    const homeBlock = findHomeBlock();
    const homeText = (homeBlock?.innerText || '').replace(/\s+/g, ' ').trim();
    if (homeText.length > 40) {
      mainText = redactLongTokens(homeText).slice(0, 4000);
    } else {
      // 课程详情页：优先 .courseContentArea，回退 .v-content-wrap，再回退整页 body。
      const fallbacks = ['.courseContentArea', '.v-content-wrap', '.my-task', 'body'];
      for (const sel of fallbacks) {
        const el =
          sel === 'body' ? document.body : (document.querySelector(sel) as HTMLElement | null);
        const text = (el?.innerText || '').replace(/\s+/g, ' ').trim();
        if (text.length > 40) {
          mainText = redactLongTokens(text).slice(0, 4000);
          break;
        }
      }
    }
  } catch {
    mainText = '';
  }

  // 6) 汇总标签与菜单（点击后的状态优先，点击前作为补充）。
  const afterTabs = detectTabs();
  const tabs = afterTabs.length ? afterTabs : beforeTabs;
  const menuItems = detectMenuItems();

  const parsed = extractAssignments(mainText);

  // 7) 学习通页面附加：考试详情抓取探测（端到端验证 fetch+解析链路）。
  //    内容 iframe（mobilelearn/mooc1）已是课程内列表页，不需要、也不做收件箱式考试详情探测。
  const examProbe = isContentFrame ? null : await probeExamDetail();

  // 收集候选内容页 URL（任务列表 mobilelearn / 作业·考试列表 mooc1），供诊断“开独立标签”定向取证。
  // ① 已存在的内容 iframe src（点过的标签）；
  // ② 左侧菜单 a[data-url]（未点过的标签，iframe 尚未创建）——补上外壳 URL 里缺的查询参数
  //    （courseid/clazzid/cpi/stuenc…），这与外壳点击标签时生成的 iframe 地址等价，
  //    因此无需先手动点开「作业」「考试」标签也能直接取证。
  // 合并参数必须“只补缺失的键”。反例（2026-10-29 修的 bug）：
  // `du + shellQuery` 在 data-url 已带 `?courseId=…` 时会拼出两个 `?`，参数被截断 →
  // 作业/考试列表页打开就是空壳或错误页，表现为“只有任务能诊断出来”。
  const mergeFrameQuery = (base: string, extraQuery: string): string => {
    try {
      const u = new URL(base, window.location.href);
      const extra = new URLSearchParams(extraQuery);
      extra.forEach((v, k) => {
        if (!u.searchParams.has(k)) u.searchParams.set(k, v);
      });
      return u.toString();
    } catch {
      return base;
    }
  };

  let contentFrameUrls: string[] = [];
  if (!isContentFrame) {
    try {
      const shellQuery = window.location.search || '';
      const push = (u: string): void => {
        const v = (u || '').trim();
        if (!v || contentFrameUrls.includes(v)) return;
        contentFrameUrls.push(v);
      };
      for (const f of Array.from(document.querySelectorAll('iframe'))) {
        const src = (f.getAttribute('src') || '').trim();
        if (/mobilelearn\.chaoxing\.com|mooc1\.chaoxing\.com/.test(src)) {
          push(mergeFrameQuery(src, shellQuery));
        }
      }
      for (const a of Array.from(document.querySelectorAll('a[data-url]'))) {
        const du = (a.getAttribute('data-url') || '').trim();
        if (/mobilelearn\.chaoxing\.com|mooc1\.chaoxing\.com/.test(du)) {
          push(mergeFrameQuery(du, shellQuery));
        }
      }
    } catch {
      /* 读取 iframe src / data-url 失败不影响主流程 */
    }
  }

  // 列表行取证：按常见列表结构采样行，保留行级标识（id / data-*）与子行文本分布。
  let listRows: DiagnosticListRow[] = [];
  try {
    const LIST_ROW_SELECTORS = [
      '.bottomList li',
      'li.dataBody_item',
      '.course-list li',
      'ul[class*="list"] li',
      '.el-table__row',
      'tr',
      '[data-id]',
      '[data-rid]',
    ];
    for (const sel of LIST_ROW_SELECTORS) {
      const rows = Array.from(document.querySelectorAll(sel)).slice(0, 12);
      for (const row of rows) {
        const data: Record<string, string> = {};
        for (const attr of Array.from(row.attributes)) {
          if (attr.name.startsWith('data-') && attr.value) {
            data[attr.name] = redactText(attr.value);
          }
        }
        const childTexts: string[] = [];
        for (const c of Array.from(row.children).slice(0, 8)) {
          const t = (c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
          if (t) childTexts.push(t);
        }
        const href = row.getAttribute('href') || row.querySelector('a')?.getAttribute('href') || '';
        listRows.push({
          selector: sel,
          tag: row.tagName.toLowerCase(),
          class:
            typeof row.className === 'string' && row.className ? row.className.slice(0, 120) : undefined,
          id: row.id ? row.id.slice(0, 60) : undefined,
          data: Object.keys(data).length ? data : undefined,
          text: (row.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200) || undefined,
          href: href ? href.slice(0, 200) : undefined,
          childTexts,
        });
      }
      if (listRows.length >= 40) break;
    }
  } catch {
    /* 列表取证失败不影响主流程 */
  }

  // 页面查询参数（courseid / clazzid / cpi 用于构成稳定 ID；会话类长令牌脱敏）。
  let pageParams: Record<string, string> = {};
  try {
    new URL(window.location.href).searchParams.forEach((v, k) => {
      pageParams[k] = isLongToken(v) ? '[已脱敏-长随机串]' : v.slice(0, 80);
    });
  } catch {
    /* URL 解析失败则留空 */
  }

  return {
    url: safePageUrl(),
    title: document.title.slice(0, 200),
    hostname: window.location.hostname,
    generatedAt: new Date().toISOString(),
    truncated: state.truncated,
    clickedAssignmentTab,
    tabs,
    menuItems,
    mainText,
    requests: requests.slice(0, 60),
    examProbe,
    assignmentSummary: parsed.summary,
    assignments: parsed.items,
    classNames: [...classNames].sort(),
    anchors: [...new Set(anchors)].sort(),
    tree,
    contentFrameUrls,
    listRows,
    pageParams,
  };
}

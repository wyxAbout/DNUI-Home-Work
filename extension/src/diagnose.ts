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
}

// 作业列表汇总，如“已完成8/18”。
export interface DiagnosticAssignmentSummary {
  done: number;
  total: number;
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
  // 作业列表汇总（如“已完成8/18”），无则为 null。
  assignmentSummary: DiagnosticAssignmentSummary | null;
  // 聚焦提取的作业项（序号 / 标题 / 剩余次数 / 状态 / 动作 / 进度）。
  assignments: DiagnosticAssignment[];
  classNames: string[];
  anchors: string[];
  tree: DiagnosticNode[];
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

  const MAX_DEPTH = 12;
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

  // 主动寻找并点击“作业”类标签：文本以“作业”开头、字数很少、且是叶子或接近叶子的可点击节点。
  const findAssignmentTab = (): HTMLElement | null => {
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!/^(作业|收件箱|消息|未读|待办)/.test(text)) continue;
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
    const summary: DiagnosticAssignmentSummary | null = summaryMatch
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

    return { items, summary, progressBars };
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
  let clickedAssignmentTab = false;
  const tab = findAssignmentTab();
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
    assignmentSummary: parsed.summary,
    assignments: parsed.items,
    classNames: [...classNames].sort(),
    anchors: [...new Set(anchors)].sort(),
    tree,
  };
}

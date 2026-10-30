# 工作进度

## 2026-10-22

- 已阅读 `planning-with-files` 技能说明。
- 已执行会话恢复检查；由于环境没有 `python` 命令，脚本未能运行。
- 已确认工作区为空项目，仅存在需求文档。
- 已创建 `task_plan.md`、`findings.md` 和 `progress.md`。
- 已在 `extension/` 子目录生成 WXT 0.21.4 React 模板并安装 npm 依赖。
- 已加入本地作业数据模型、平台快照存储、三个平台适配器接口和 Edge Manifest 配置。
- 已替换默认 React 示例为作业整合看板界面。
- 已加入平台页面访问报告、缓存通知和当前页面手动刷新基础流程。
- 首次编译发现当前标签页查询结果可能为空，已增加空值判断。
- `npm run compile` 和 `npm run build` 均已通过。
- 已修正未完成平台解析时的缓存合并逻辑：非成功状态不会清空已有作业，也不会更新最近成功同步时间。
- 已补充 `extension/README.md`，说明开发、构建和在 Edge 中加载解压缩扩展的方法。
- 已在需求文档中增加当前实现状态。
- 2026-10-22：新增 `东软作业解析_交接文档.md`，记录东软适配器现状、登录态页面证据缺口、隐私边界和分批实施步骤。
- 2026-10-22：实现本地临时 DOM 诊断入口（小任务 1/2 的取数工具）：新增 `extension/src/diagnose.ts`（去敏 DOM 摘要，剔除表单值/Cookie/token/长随机串），在 `content.ts` 接入 `RUN_DIAGNOSTIC` 消息，popup 增加“诊断当前页面”按钮与可复制输出面板。`npm run compile` 与 `npm run build` 均通过。东软生产解析器仍为 `needs-verification` 占位，未猜测任何接口或字段。下一步需用户在已登录的东软作业页运行诊断并返回摘要，方可推进小任务 1/2。
- 2026-10-22：修复诊断失败问题。根因：用户当前东软标签页在扩展重载前打开，页面内 content script 已孤立，`RUN_DIAGNOSTIC` 消息无人接收。改为 `browser.scripting.executeScript({ func: collectPageDiagnostic })` 直接向当前标签页注入自包含扫描函数，不再依赖页面是否注入过 content script；`diagnose.ts` 重写为完全自包含函数；`content.ts` 移除诊断分支恢复为仅上报；`wxt.config.ts` 增加 `scripting` 权限。compile/build 通过。用户需在扩展管理页重载扩展以生效新权限。
- 2026-10-22：截图初步证据：东软作业页 URL 形如 `/course/study/studentExamCourse/{...数字段...}`；该“四史概述”课程作业项状态显示为“已作答”、并有“剩余作答次数：0 已截止”，未见“未提交”项。验证“未提交”识别需另找存在真正未提交作业的课程。
- 2026-10-22：用户运行诊断成功返回真实 DOM 摘要（scripting 注入生效）。关键发现：捕获的 `courseContentArea` 为空，作业列表（“作业” tab 内容）当时未渲染，故仍未拿到作业结构；需用户点开“作业”标签、等列表渲染后再诊断。诊断增强：记录 iframe 的 src（不下钻），以防作业列表位于 iframe 内。页面 DOM 中还存在第三方 `control-panel`「智能助手 v1.5.0」浮层（含考试反检测/批量答题等），与本项目无关，代码保持只聚焦作业列表。
- 2026-10-22：按用户要求新增"运行日志"模块：`src/log.ts`（storage-backed 环形日志，上限 200 条，只记事件不记作业内容与凭据）；background 在平台同步结果（success/warn/error）时写日志；popup 在诊断开始/完成/失败时写日志并新增日志面板 UI（显示最近 30 条、按级别着色、可清空）。compile/build 通过。
- 2026-10-22：诊断升级为"主动取证"版（`diagnose.ts` 改为 async + 自包含）。新增能力：① 自动识别并点击"作业"类标签（Element UI / 通用标签），等待 SPA 渲染后重新扫描，解决此前 `courseContentArea` 为空的问题；② 抓取作业区可见文本（innerText，去敏截断，fallback 链：`.courseContentArea`→`.v-content-wrap`→整页）；③ 安装 XHR/fetch 钩子，仅记录同源、疑似作业相关接口的 **pathname**（剥离 query 与响应体，符合隐私边界）。报告新增 `clickedAssignmentTab / tabs / menuItems / mainText / requests` 字段。popup 新增结构化取证展示（标签、可见文本、疑似接口）与"复制完整摘要"。compile/build 通过。待用户在重载扩展后于东软作业页重跑诊断，拿到作业列表结构方可推进小任务 4。
- 2026-10-22：按用户结构线索（每项作业 = 状态 + 进度条 + 未作答/已作答）增强诊断 `diagnose.ts`：新增 `extractAssignments()` 聚焦提取——锚定"未作答/已作答/部分作答"元素，向上攀爬命中 item/card/row/list 等类找到作业卡片容器，抽取容器可见文本 + 进度条百分比（读 `.el-progress-bar__inner` 内联 width，兼容其它 progress 写法）；新增 `DiagnosticAssignment{answerStatus, progress, text}` 与报告 `assignments` 字段。popup 新增"疑似作业项（状态/进度/作答状态）"结构化展示（带配色）。compile/build 通过。下一步让用户重跑诊断，从 assignments 块直接拿到可落解析器的"标题+状态+进度+作答状态"证据。

- 2026-10-22：用户回传"主动取证"版诊断真实数据（clickedAssignmentTab=true，mainText 成功捕获作业列表）。真实结构确认：汇总"已完成8/18"；每项 = 两位序号 + 中文标题 + "课后" + "剩余作答次数：N" + "进行中" + "状态： 已作答|作答中|未作答" + "公布答案/公布成绩：截止后自动公布" + "详情|去作答"。状态三值（已作答/作答中/未作答），动作"详情"=已提交、"去作答"=待提交；"待提交"=作答中+未作答。"进度条"在本页无逐条文本，仅聚合"已完成8/18"，故保留 DOM 扫描 `.el-progress-bar__inner` 作兜底（数量一致时回填）。据此彻底重写 `extractAssignments()`：改用 mainText 正则解析（CJK 前瞻防误命中"已完成8/18"中的"18"），重构 `DiagnosticAssignment{index,title,remainingAttempts,status,action,submitted,progress,text}` + `DiagnosticAssignmentSummary{done,total}` + 报告 `assignmentSummary`；popup 作业项展示改为"已完成X/Y · 待提交N项" + 逐项状态徽章(已提交绿/待提交橙)+序号+标题+剩余次数+动作。已用真实 mainText 写临时脚本验证：6 条样例（含作答中/未作答/多词标题）全部正确解析、无误报；compile/build 均通过。下一步：用户重载扩展后于含未提交作业的东软课程重跑诊断，确认结构化块正确，再据其接入真实页面解析器（小任务 4：把东软作业页解析落地到 HomeworkStore，标记待提交项）。

- 2026-10-22：用户截图确认“作业项解析”生效：18 项全部解析，顶部显示“已完成 8/18 · 待提交 10 项”，逐项含状态徽章（已作答/作答中/未作答）、进度（100%/50%/0%，DOM 进度条按位置回填成功）、剩余次数、详情/去作答；JSON 输出含 `assignments`/`assignmentSummary`。至此小任务 2/3 完成。
- 2026-10-22：完成小任务 4（东软真实解析器）。新增 `extension/src/neusoft.ts`：`extractNeusoftAssignments(doc,url,{allowAutoOpen})` 异步解析——非课程页/登录失效安全返回；被动上报仅在作业标签已渲染时解析，显式刷新（SYNC_ACTIVE_PAGE）才主动点击“作业”标签并轮询等待渲染；仅当“解析条数 === 已完成 X/Y 的总数”时才返回 success（防不完整列表）；仅纳入“作答中/未作答”，排除“已作答”；生成稳定 ID（`neusoft:<courseId>:<index>`）、标题、url（回退课程页，因“去作答/详情”为 JS 按钮无 href）、dueAt=null。`platforms.ts` 适配器接口改为可返回 `Promise<...|null>` 并接入东软；`content.ts` 改为 await + allowAutoOpen（自动上报 false / 手动刷新 true）；`PlatformExtractionResult` 移入 `models.ts` 避免循环依赖。新增 `src/neusoft.test.ts`（node:test，样本 3 例全通过）、`npm test` 脚本。`tsc --noEmit` 与 `wxt build` 均通过（content.js 4.71→7.50 kB）。已知限制：① store 每个平台仅保留一个数组，同步会整组替换，因此跨多门课程时看板只显示“最近同步的那门课”；② 逐项深链暂缺，url 回退课程页；③ 扩展重载后需刷新页面才有 content script。

- 2026-10-22（晚 21:24）：解决“页面已显示任务但看板仍 0 项”的**扩展重载失联**问题：popup 的 ↻ 现在先 `tabs.sendMessage`，失败则用 `scripting.executeScript({files:['/content-scripts/content.js']})` 补注入，并轮询 `store.updatedAt` 变化（4~6s）后再刷新 UI，不必再手动 F5；首页区块存在但解析 0 条时由静默 `null` 改为 `needs-verification` 并在状态/日志里给出原因；类型词剥离改为循环 3 次（同一行可能同时渲染“测验”“作业”两个徽章）。
- 2026-10-22（晚）：修复“我的学习任务里有内容但看板获取不到（未完成 0 项）”。两个根因：① `HOME_ANCHOR_RE` 把类型标签写死为 `作业\s*截止时间：`，而实测条目徽章是**测验** → 整条漏抓；改为只锚 `截止时间：<date>所属课程：<course> 去作答`，再用 `stripTrailingType()` 从标题末尾剥掉 1~6 字类型词（边界正则 `(?:^|\s)([^\s]{1,6})$` 保证“标题自身以测验结尾”不被误裁）。② `.my-task` 还包住“我的考试”，其 `.noData` 让 `hasHomeEmptyState` 误判为空 → 返回 `success+replaceAll` 把缓存清成 0；新增 `findHomeTaskBlock(doc)` 把解析与空态判定都限定在“我的学习任务”区块内，并加保险“区块内出现‘去作答’即判非空”。`diagnose.ts` 同步修复。单测 14 例全过，tsc/build 通过（content.js 11.09 kB）。
- 2026-10-22（下午）：实现**首页“我的学习任务”自动同步**（用户诉求：直接打开首页/重新加载即可自动同步）。用户在首页（`东软智慧教育平台 - 首页`）回传诊断，发现 `.my-task` 区块天然跨课程且无需点击任何标签，每项形如 `<序号?><标题> 作业 截止时间：YYYY-MM-DD HH:MM:SS所属课程：<课程名> 去作答`，同时解决了“跨课程”与“截止时间缺失”两个老限制。实施：① `neusoft.ts` 新增 `parseNeusoftHomeTasks(text)` + `slugifyCourse()` + `hasHomeEmptyState()`，首页路径优先于课程详情页路径；② 解析改为**锚点定位 + 边界切割**（先用 `作业\s*截止时间：<date>\s*所属课程：<course>\s*去作答` 定位每项，标题取“上一个锚点结尾 ~ 本锚点开头”，再剔除首项前的界面文案），修掉了可选序号组被惰性标题吞掉、首项吃进“我的学习任务/请选择所属课程”的缺陷；③ 时序加固：`readText()` 在容器文本 <40 字时回退整页，并新增 `pageReady()` 有界等待（首页区块标题或课程作业标记任一出现）——解决 document_idle 时 Vue 尚未渲染导致漏同步；④ 空态保护：区块在但无待办且命中 `.el-empty/.neu-empty/.no-data-content` 等空态标记时才返回 `success + replaceAll:true` 清空该平台，否则静默跳过不覆盖缓存；⑤ `models.ts`：`Assignment` 新增 `source: 'home'|'course'`，`mergeAssignmentsByCourse` 在本次含首页来源时把“旧的首页来源课程”也纳入清理范围（避免某门课作业全做完从首页消失后旧条目永久残留），并新增 `unifyCourseAttribution`（同标题沿用信息更完整来源的课程归属，避免首页/课程页两条路径把同一门课裂成两个分组）与 `dedupeAssignments`（同平台+课程+标题去重，有截止时间优先）；`PlatformExtractionResult` 新增 `courseIds[]` 与 `replaceAll`；⑥ `background.ts` 按 `courseIds` 定合并范围、支持 `replaceAll` 整组替换；`storage.ts` 回填 `source` 并兼容 `neusoft:home:<slug>:...` 的 id 形式；⑦ `diagnose.ts` 同步支持首页结构解析（自包含副本）并把 `.my-task` 加入可见文本 fallback 链，`DiagnosticAssignment` 新增 `courseName`/`dueAt`；popup 诊断项展示课程名与截止日期。新增 6 项单测（首页解析 3 例 + 合并/去重/清理 3 例），`npm test` 12/12 通过；`tsc --noEmit` 与 `wxt build` 均通过（content.js 7.50→10.49 kB）。待用户重载扩展后打开东软首页（刷新一次）验证看板按课程分组列出全部待提交作业及截止时间。
- 2026-10-22（下午）：实现**跨课程汇总**（用户择定方向 A）。根因修复：此前后台在 success 时整体替换 `platforms[neusoft].assignments`，导致访问多门课程后仅保留最近同步的一门。方案：① `models.ts` 的 `Assignment` 新增 `courseId`/`courseName` 维度；新增纯函数 `mergeAssignmentsByCourse(existing, incoming, scopeCourseId)`（按课程替换、保留其它课程与平台）与 `countCoveredCourses(store)`；② `neusoft.ts` 新增 `extractCourseName(doc, fallback)`（best-effort：内容区主标题→页面标题剥离站点后缀→回退 courseId），每条作业带上课程信息，结果含 `courseId`/`courseName`；③ `content.ts` 转发 `courseId`/`courseName`；④ `background.ts` 成功同步改为先读缓存、按课程合并再写回（而非覆盖），`onMessage` 回调改为 async；⑤ `storage.ts` 加载时对旧缓存按 id 前缀回填 `courseId`/`courseName`，避免 undefined；⑥ popup `App.tsx` 作业列表改为按“平台+课程”分组展示（组头显示课程名+平台+数量），摘要条新增“覆盖 N 门课程”。新增 `src/models.test.ts`（3 例跨课程合并/统计测试），`npm test` 改为 `src/*.test.ts`。`tsc --noEmit`、`wxt build`、6 项单测均通过。原先限制①已解除：现在每门课独立累积。待用户重载扩展后分别打开两门以上东软课程刷新，应在看板看到多课程分组汇总。

## 2026-10-22（晚）

- 启动 **iTEST 适配器**工作（东软已完成真实解析，iTEST 此前为内联占位）。按东软已验证的“先取证、再落地”路线推进，严守“不猜测 API/字段/未提交状态文案”硬约束。
- 新增 `extension/src/itest.ts`：导出 `extractItestAssignments(doc, url, {allowAutoOpen})`，当前为**占位实现**——返回 `needs-verification`、不更新缓存（与东软占位行为一致，后台不会覆盖上次成功同步）。文件头部注明 iTEST 入口（sso.unipus.cn 登录域 + itestcloud.unipus.cn 作业域同属一平台）、待验证项与实现约束。
- `platforms.ts`：iTEST 适配器从内联 `notReadyResult` 改为调用 `extractItestAssignments`；`content.ts` 的 matches 已含 `sso.unipus.cn`/`itestcloud.unipus.cn`/`*.unipus.cn`，popup 的诊断按钮文案也已提示 iTEST，故**壳层已就绪，仅缺真实页面解析**。
- `diagnose.ts`：诊断报告新增 `hostname` 字段（取自 `window.location.hostname`，完全自包含，无隐私风险），popup 诊断面板新增“当前域名”一行。用途：用户把 iTEST 诊断结果贴回时，可立即确认来源域名、与 `PLATFORM_HOSTS.itest` 对照，避免把登录域/作业域混淆。
- 注意：`diagnose.ts` 的 `extractAssignments()` 仍**写死东软结构**（课后/剩余作答次数/已完成 X/Y/所属课程），在 iTEST 页会返回空 `assignments`；但通用的 `mainText`/`tree`/`requests`/`tabs`/`menuItems`/`hostname` 已能抓到 iTEST 原始结构——这正是落地解析器所需的证据。
- 待用户执行的关键一步（对应东软小任务 1/2）：在 Edge 中**登录 iTEST 并打开“作业列表页”**（域名应为 `itestcloud.unipus.cn`，而非 `sso.unipus.cn` 登录页），点击看板“诊断当前页面”，把去敏摘要贴回。拿到真实状态词/列表结构/接口后再落地 `itest.ts` 的解析逻辑，并补 `itest.test.ts`。

## 2026-10-22（22 时许）

- 用户回传 iTEST 真实诊断样本（`itestcloud.unipus.cn/utest/itest/s/exam` 的 `mainText`/`tree`/`hostname`）。据此把 **iTEST 真实解析器落地到 `extension/src/itest.ts`**，彻底告别占位。
- 真实结构确认（证据驱动，零猜测）：
  - 顶部汇总 `全部考试 12 待完成 2 已完成 10 诊断报告 0` → 平台“待完成”桶即本扩展的“未提交”语义。
  - 每条考试 = `<标签 日常>` + `<名称（含“（ID：数字）”）>` + `<类型 学校考试>` + `<状态按钮/标签 进入考试|缺考>` + `<状态提示 考试已开始，请进入作答 / 考试已结束，无法参加考试>` + `进入时间：起 - 止` 窗口 + `考试地点：--`。
  - 两种现场状态均见到：① 仍可作答（状态提示含“考试已开始，请进入作答”+“进入考试”按钮）→ 归 `pending`；② 缺考/已错过（状态提示含“考试已结束，无法参加考试”或“缺考”标签）→ 归 `absent`。两者都属于平台“待完成”计数，均纳入看板；已完成（已完成/已提交/已交卷/成绩已出）排除。
- 实现要点（对齐东软“先取证再落地 + 不猜 API”约束）：
  - 解析**以可见文本为锚**（不以 CSS module 哈希类名为锚，避免前端发布后类名变化失效），用稳定可见的“（ID：数字）”作为每条考试边界，标题/标签取边界前紧邻两词，类型/状态/时间取边界后片段；截止时间取“进入时间”窗口结束时刻（本地时间 ISO）。
  - 净化为纯函数 `parseItestExamPageText(text)` / `classifyItestStatus(text)` / `mapItestAssignments(items, ctx)`，DOM 胶水层只占 `extractItestAssignments(doc,url,{allowAutoOpen})` 一小段（等待 React+qiankun SPA 渲染、SSO 登录域判 `login-required`、非考试列表页静默 `null`）。
  - **完整性校验**：解析出的“未提交”条数必须等于页面“待完成”汇总；不一致先再等一轮，仍不一致则报 `needs-verification`（后台不覆盖旧缓存）。确实为 0 项时 `replaceAll` 整组清空该平台，避免班级名提取波动残留旧条目。
  - “进入考试”为 JS 按钮无 href，无逐项深链证据 → `url` 回退考试列表页（与东软同策略）。分组维度 `courseId/courseName` 取“我的班级”区块文本（best-effort，缺失回退 `iTEST`）。
- 新增 `extension/src/itest.test.ts`（5 例，用真实诊断样本：定位两条考试+标题/ID/类型/截止、状态三分类、未提交集合与“待完成”一致、映射到 Assignment、无 ID 回退标题 slug），复用 neusoft 的 `slugifyCourse`。`import` 用 `'./neusoft.ts'` 显式扩展名（node ESM 运行时要求）。
- 验证：`npm run compile` 零错误；`npm test` 19/19 通过（neusoft 14 + itest 5）；`npm run build` 成功（content.js 11.49→14.83 kB）。
- 待用户在扩展管理页**重载扩展**后，于已登录的 iTEST 考试列表页重跑同步（看板自动上报或点“刷新当前平台”），确认看板出现“iTEST · 班级名”分组及待完成项（含仍可作答/已错过截止的区分提示）。若状态词与样本不同（如其它“待完成”措辞），按“未知即不计入、触发 needs-verification”的既有保护，再据新证据补正则。

- 2026-10-22（晚）：用户反馈“显示有问题”并附截图。定位到**两个独立缺陷**：
  1. **同步无数据（根因）**：截图中 22:17:11 同步结果为 `needs-verification`。新解析器本身无问题（单测即用真实样本），真因是**页面内仍在运行上一次构建的旧 content script**——扩展更新后已打开的标签页不会自动换脚本，旧脚本只会返回占位“待验证”。原补救逻辑仅在 `sendMessage` 抛错时才补注入，旧脚本能正常应答时永远不会触发。
     - 方案：新增 `src/build.ts`（`BUILD_ID` 由 `wxt.config.ts` 的 `vite.define` 在每次构建注入，popup 与 content script 同一次构建共享同一值）；`entrypoints/content.ts` 增加 `HW_PING` 版本探测应答 + 首次注入标记（防重复注入导致重复上报）；popup 的“刷新当前平台”改为：先 ping，版本一致才发 `SYNC_ACTIVE_PAGE`，不一致/无应答则补注入最新产物由其首次上报完成同步。
     - 顺带提升可诊断性：`background.ts` 的 `needs-verification` 日志改为带上解析器具体原因（原来只有一句“解析器待验证”）。
  2. **弹窗被压窄（显示问题）**：`.app-shell` 的 `width:680px` 与 `@media(max-width:560px)` 里的 `width:auto;min-width:320px` 冲突 —— 宿主可能按初始窄视口排版后永久停留在窄态，表现为内容堆叠、运行日志每行只剩几个字。
     - 方案：`style.css` 的 `body` 显式定宽 `680px`（不再依赖内容撑开）、`overflow-x:hidden`；`.app-shell` 改 `width:100%`；媒体查询只调内边距/列数，**不再改宽度**；`.log-item` 列宽改 `auto auto minmax(0,1fr)` 并允许消息任意换行；`.finding-val`/`.empty-platform-msg` 加 `overflow-wrap:anywhere`。
     - 另补**空态自解释**：空看板下列出三个平台的同步状态与后台返回的具体 message，区分“确实没有待办”与“同步未成功/待验证”，避免空态看起来像坏了。
- 验证：`npm run compile` 零错误；`npm test` 19/19 通过；`npm run build` 成功（content.js 15.02 kB）；已确认 `content.js` 与 `chunks/popup-*.js` 内构建标识一致、`HW_PING` 同时存在、产物 CSS 中 `body{width:680px}` 生效。
- 仍需用户执行：扩展管理页**重载扩展** → 打开 iTEST 考试列表页 → 点看板右上角“↻”（此时应记录“已注入最新版并重新解析”）→ 确认出现 iTEST 分组 2 项待完成。

- 2026-10-22 22:30（截图复现：仍是旧包）：用户第二次贴图，日志仍为“iTEST 解析器待验证，未更新作业数据”且空态没有平台自检列表 → 判定**扩展从未重载**（22:25 的日志由仍在运行的旧 Service Worker 写入旧文案；我的新文案是“iTEST 待验证：…”）。佐证：① 全盘仅一份产物 `extension/.output/chrome-mv3/manifest.json`，路径无误；② 产物内已是新代码（新文案、`width:680px`、空态自检列表、`HW_PING`）；③ 弹窗 CSS 无法把 680px 压成截图里的窄条，且 JSX 里的自检列表完全没出现 —— 只能是旧 bundle。
  - **解析器离线复验**：用用户贴回的真实 `mainText` 直接跑 `parseItestExamPageText`，输出 `pending`（B2U6，截止 11-16 23:55）+ `absent`（B2U5，截止 10-19 23:55），`pendingCount=2 / nonDone=2 / MATCH=true` → 重载后应一次成功，不存在“换个方式失败”的风险。
  - 降低“忘记重载”的复发：弹窗页脚新增**构建时间戳**（`formatBuildId`，显示“构建 MM-DD HH:mm”）与**“重载扩展”按钮**（`browser.runtime.reload()`，延迟 200ms 让日志落盘）；注射脚本后**再 ping 一次**校验是否真被接管，失败则明确报错而非假成功。
  - 验证：`tsc --noEmit` 零错误、`npm test` 19/19、`npm run build` 成功，`content.js` 与 `chunks/popup-*.js` 构建标识一致 = `2026-10-22T14:30:34.554Z`。
  - 本轮判定标准（给用户）：重载后页脚应显示“构建 10-22 22:30”，日志应变成“iTEST 同步成功：2 项未提交作业”。

- 2026-10-22 22:36（**真正根因：构建产物与浏览器加载目录不是同一个**）：
  - 第三次贴图仍为旧包后，直接读 Edge `Secure Preferences` 定位扩展注册路径，得到 `D:\Users\lenovo\Desktop\作业集合\extension\.output\chrome-mv3`（扩展 id `lnlimlpboefcjcbohdakpiaonibbonjk`）。
  - 即 `C:\Users\lenovo\WorkBuddy\Worktrees\作业集合\master-89f86879` 只是 `D:\Users\lenovo\Desktop\作业集合` 的 **git worktree**（分支 `workbuddy/master-89f86879`，主仓 `master`）。此前所有构建都写在 worktree，桌面主副本一直停在 `03a73f3`（无 iTEST 解析器）→ 浏览器只能显示旧行为，与代码无关。
  - 处置：worktree 提交 `d3543ce` → `git -C "D:/Users/lenovo/Desktop/作业集合" merge --ff-only workbuddy/master-89f86879` → **在 D 盘工程执行 `npm run build`**。D 盘产物 22:36 生成，buildId `2026-10-22T14:36:03.857Z`，`content.js` 15.02 kB，含 iTEST 解析器、「重载扩展」按钮、`body{width:680px}`；D 盘 `tsc --noEmit` 零错误、`npm test` 19/19。
  - **流程固化**：以后改完必须"worktree 验证 → 提交 → 快进合并到 D 盘 → 在 D 盘 build → 浏览器重载"，已写入 `.workbuddy/memory/MEMORY.md`，避免再次把改动构建到没人加载的目录。

## 2026-10-23

- 启动 **批改网（pigai.org）模块**制作（东软、iTEST 已完成真实解析，批改网此前为内联占位）。按项目"先取证、再落地"硬约束推进：
  - 新增 `extension/src/pigai.ts`：独立适配器模块，结构与 `itest.ts` 对齐——导出 `extractPigaiAssignments(doc,url,{allowAutoOpen})`，当前为**占位实现**：仅处理 `pigai.org` 域（非 pigai 静默 `null` 双保险），登录态判定与真实解析均留 `TODO`，返回 `needs-verification` 且**不覆盖**上次成功缓存（与东软/iTEST 占位行为一致）。文件头注明入口（`www.pigai.org`）、约束与已规划的真实解析纯函数签名（`parsePigaiPageText` / `classifyPigaiStatus` / `mapPigaiAssignments`）。
  - `platforms.ts`：批改网适配器从内联 `notReadyResult` 改为调用 `extractPigaiAssignments`；删除因此变为死代码的 `notReadyResult` 函数。`content.ts` 的 `matches` 与 `wxt.config.ts` 的 `host_permissions` 此前已含 `pigai.org`，故**壳层本就就绪，仅缺真实页面解析**。
  - 验证：`npm run compile` 零错误；`npm test` 20/20 通过（未破坏既有东软/iTEST 单测）；`npm run build` 成功（content.js 15.02→15.27 kB，产物落在 D 盘 `.output/chrome-mv3/`，即浏览器实际加载目录）。
  - 待用户执行的关键一步（对应东软/iTEST 小任务 1/2）：在 Edge 中**登录批改网并打开作业/写作任务列表页**，点击看板"诊断当前页面"，把去敏摘要（`hostname`/`mainText`/`requests`/`tabs`/`menuItems`）贴回。据此确认"未提交"真实文案、列表结构与截止时间字段后，再落地 `pigai.ts` 的真实解析并补 `pigai.test.ts`。
  - 说明：批改网真实解析器**不能凭猜测落地**——项目硬规矩禁止猜 API 路径、字段名或"未提交"状态文案，且无已登录作业页证据。本次仅完成模块骨架与接线，使其达到 iTEST 取证前的同形态。

- 用户回传批改网真实诊断样本（`www.pigai.org/index.php` 学生端"我的作文"页，"未完成"标签激活），据此把**批改网真实解析器落地到 `extension/src/pigai.ts`**，正式告别占位。
  - 真实结构确认（证据驱动，零猜测）：
    - 状态分桶由平台自带：`未完成`（`li.showST.select`，激活）vs `已完成`（`li.showST`）——平台已做好"未提交"分类，解析器只认"未完成"视图，无需再猜状态文案。
    - 列表容器 `#essayList`（`.ydTable`），表头七列固定：作业号｜作业标题｜类型｜出题人｜指定班级｜截止时间｜操作；每行 `ul.reItemS`。
    - 每条标题是真实 `<a href>`（非 JS 按钮），可取逐项深链；截止时间字段真实存在（`YYYY-MM-DD HH:MM`）。
    - 样本 3 条：B2U6（截止 2026-11-16）、B2U5（截止 2026-10-19）、B1U2（截止 2025-11-10，已过期一年仍被平台留在"未完成"）。
  - 实现要点（对齐东软/iTEST"先取证再落地 + 不猜"约束）：
    - 核心用**纯文本正则**解析（以 6+ 位作业号为行起点，规避页头/页脚"作文""ICP 号"干扰），不依赖会变的 CSS 类名；深链单独用 DOM `ul.reItemS > li.stu_title a` 取真实 href，以作业号为键关联，缺则回退列表页。
    - 登录态判定：页头有 `#pigai_nickname` 用户链接＝已登录；列表页缺失且无用户链接→`login-required`（避免把登录页误判为 0 条）。
    - 视图判定：`findActiveStatusTab` 仅"未完成"视图产出数据；"已完成"视图或其它页静默 `null` 跳过，**不覆盖**未提交缓存。
    - 过期项决策：按需求文档"是否未提交以平台状态为准、不得仅因截止时间推断"，默认**全部纳入**，截止时间仅用于排序/提示；如需"自动隐藏已过期项"可后续加开关（已向用户说明）。
    - 0 条未完成：`replaceAll` 整组清空该平台缓存，避免旧条目残留（同 iTEST 聚合视图策略）。
  - 新增 `extension/src/pigai.test.ts`（5 例，用真实诊断样本重组：精确命中 3 行不误命中导航/页脚"作文"、截止时间转 ISO、空列表返回空、映射到 Assignment 含逐项深链/回退）。复用 `slugifyCourse` 做缺作业号时的 id 兜底。
  - 验证：`npm run compile` 零错误；`npm test` 25/25 通过（东软 14 + iTEST 5 + 批改网 5）；`npm run build` 成功（content.js 15.27→17.30 kB，产物在 D 盘 `.output/chrome-mv3/`）。
  - 需求文档已同步更新（第 1 节实现状态、第 12 节待验证项、第 14 节当前实现）将批改网从"待验证占位"改为"已实现"。
  - 待用户执行：扩展管理页**重载扩展** → 打开批改网学生端"我的作文"（默认即"未完成"）或点看板"刷新当前平台" → 确认看板出现"批改网"分组及 3 项未完成（含已过期项排在最前）。若平台换用分页或状态文案变化，按"未知即不计入"的既有保护再据新证据修正则。

- 用户拍板：为批改网样本里那条已过期近一年的"未完成"作业（B1U2，截止 2025-11-10）**增加"自动隐藏已过期项"开关**（小型切换按钮）。实施为**全局显示偏好**（不限平台，因三个平台 Assignment 都带 dueAt），纯渲染层过滤，绝不动缓存。
  - `models.ts`：新增纯函数 `isAssignmentExpired(dueAt)`——仅当存在有效截止时间且早于当前时刻才判过期；`dueAt` 为 null 或无法解析一律视为未过期（避免无截止时间作业被误隐藏）；`dueAt` 是本地时间 ISO，`new Date()` 按本机时区解析即可与 `Date.now()` 比较，无需时区换算。
  - `storage.ts`：新增 `loadHideExpired()` / `saveHideExpired()`（`browser.storage.local` 键 `hide-expired`，默认 false），与既有 homework-store 读写范式一致。
  - `log.ts`：`LogSource` 新增 `'display'`，使开关动作可记入运行日志。
  - `popup/App.tsx`：
    - 新增 `hideExpired` 状态，挂载时 `loadHideExpired()` 读入；切换时 `setHideExpired` + `saveHideExpired` + 写一条 `'display'` 日志。
    - 渲染列表 `assignments` 的记忆块改为：先按平台筛选、再按 `hideExpired` 过滤（调用 `isAssignmentExpired` 排除过期项）、最后排序；`groups` 与所有计数都基于"可见集合"。
    - 计数一致性：汇总条"未完成 X 项"、平台筛选按钮徽标、全部徽标全部改用**可见数**（`visibleCount` / `visibleByPlatform`）；新增 `totalCount`/`visibleCount`/`hiddenCount`，开启且确有隐藏项时显示"已隐藏 N 项过期作业"提示。
    - 空态增强：当 `visibleCount===0 && hiddenCount>0` 时，明确提示"全部 N 项均未过截止时间，已被隐藏，关闭开关即可恢复"——避免用户误以为"真的没有待办"。
    - 新增"显示选项"区（在平台筛选行下方）放置该开关，样式为 teal 主题的小型 pill 切换。
  - `popup/App.css`：新增 `.display-options`/`.toggle`/`.toggle-switch`/`.toggle-knob`/`.hidden-hint`/`.empty-note` 样式（与现有 teal/绿配色一致）。
  - `models.test.ts`：新增 3 例 `isAssignmentExpired` 单测（null/非法→未过期；明显过去→过期；明显未来→未过期）。
  - 验证：`npm run compile` 零错误；`npm test` 28/28 通过（东软 14 + iTEST 5 + 批改网 5 + 新增 3 + 原有 models 3）；`npm run build` 成功（**content.js 仍 17.30 kB**——开关是纯展示层、解析器未改动，符合预期；popup chunk 与 CSS 体积因新 UI 略增）。
  - 设计取舍：隐藏是"显示偏好"而非"删除数据"——过期但平台仍标未提交的作业仍留在 `homework-store` 缓存里，关掉开关立即恢复显示；不会因前端发版或用户改主意而丢失。

- 2026-10-23（上午）：启动**学习通邮箱模块**（i.chaoxing.com 消息中心收件箱），按用户要求与批改网/iTEST 同等级接入。严格沿用"先取证、再落地"规矩，严禁猜域名/接口/状态文案。
  - 前置澄清（用户已确认）：入口域 `i.chaoxing.com`；目标界面为"消息中心收件箱"；"还需要做的任务"具体判定留待诊断取证后再定。
  - 同等级接线全部完成：`models.ts` 新增 `chaoxing` 平台（PlatformId/PLATFORM_IDS/PLATFORM_LABELS=学习通邮箱/PLATFORM_HOSTS=i.chaoxing.com），并把 `createEmptyStore`/`loadHomeworkStore` 改为按 `PLATFORM_IDS` 遍历（避免漏接）；新增 `extension/src/chaoxing.ts` 占位解析器（仅认 i.chaoxing.com 域、返回 `needs-verification` 且不覆盖缓存，与东软/iTEST/批改网占位行为一致，文件头注明待实现纯函数签名）；`platforms.ts` 注册适配器；`content.ts` 与 `wxt.config.ts` 各自加入 `https://i.chaoxing.com/*`；`storage.ts` 归一化覆盖 `chaoxing`；`popup/App.tsx` 文案（空态/诊断错误/注入失败提示）纳入学习通邮箱；`diagnose.ts` 的主动点击关键词由仅"作业"扩展为含"收件箱/消息/未读/待办"，使诊断能主动进入收件箱取证。
  - 验证：`npm run compile` 零错误；`npm test` 28/28 通过（既有东软/iTEST/批改网/模型单测未受影响）；`npm run build` 成功（content.js 17.30→17.73 kB），构建产物 manifest 的 `host_permissions` 与 `content_scripts.matches` 均含 `https://i.chaoxing.com/*`，确认接线已进发布包（D 盘 `.output/chrome-mv3`）。
  - 下一步（对应"测试"环节）：用户在 Edge 重载扩展 → 登录 i.chaoxing.com 打开消息中心收件箱 → 点看板"诊断当前页面" → 把去敏摘要（hostname/mainText/requests/tree/tabs）贴回。据此确认收件箱真实结构、"还需要做的任务"的判定方式后，落地 `chaoxing.ts` 真实解析并补 `chaoxing.test.ts`（即"生成最终结果"）。

- 2026-10-23（中午）：**学习通诊断首轮取证 + 发现 iframe 结构，修正诊断穿透 iframe**。
  - 用户回传首轮诊断：hostname=i.chaoxing.com（正确），但 `mainText=""`、`requests=[]` 皆为**空**——关键证据：右侧内容区 `#mainright` 是一个 `<iframe>`，其 `src="https://notice.chaoxing.com/pc/notice/myNotice?s=<token>"`。**即：学习通"收件箱"真实内容渲染在 `notice.chaoxing.com` 的跨域 iframe 里，顶层文档看不到内容**，左菜单"收件箱"项（id=first521830，class 含 active/cur）的未读角标为 `<i>0</i>`。
  - 修正：① `wxt.config.ts` 的 `host_permissions` 新增 `https://notice.chaoxing.com/*`（征得 scripting 注入 iframe 权限）；② `popup/App.tsx` 的 `runDiagnostic` 改用 `target:{tabId, allFrames:true}`，并聚合多框架结果、优先取 hostname 含 `notice.chaoxing.com` 的框架（收件箱真实内容所在）。诊断说明文案同步改为"当前标签页及其内嵌 iframe"。
  - 验证：`npm run compile` 零错误；`npm run build` 成功，manifest `host_permissions` 已含 `i.chaoxing.com` 与 `notice.chaoxing.com` 两条。
  - 待用户（测试环节第二轮）：重载扩展 → 登录 i.chaoxing.com 打开个人空间、"收件箱"已默认激活 → 等 iframe 加载完（约 2 秒）→ 点"诊断当前页面"。本轮诊断应能在 `notice.chaoxing.com` 框架抓到收件箱 `mainText`/`requests`/`tree`。据此再定"还有需要做的任务"判定规则，落地真实解析。

- 2026-10-23（下午）：**学习通邮箱真实解析器已落地（基于第二轮 iframe 诊断证据）**。
  - 证据（notice.chaoxing.com 收件箱 iframe，title=收件箱）：每条消息 = `li.dataBody_item[data-id=GUID]`，内含 `.notice_unread > .notice_title`（标题）、`.notice_time`（MM-DD(星期X) HH:MM）、`.receiverName`（发件人，均"学习通知"）、`.openNotice[data-url=/pc/notice/$CACG$<uuid>/detail?sendTag=0]`（详情深链）、`.redDot`（未读标记）。真实 mainText 全为"考试通知"/"作业:《课程》…"/"作业结束提醒"，发件人学习通知。
  - 判定规则（不猜）：标题以"作业"开头且不含"结束提醒" → 计入待办；"作业结束提醒"与"考试通知"等排除。收件箱只下发通知、无提交状态，故统一标 `status=unsubmitted`、`dueAt=null`（看板显示"未提交/未提供截止时间"，不触发"自动隐藏已过期"）；课程名从《》抽取，无则回退"学习通作业通知"，按 slugifyCourse 归属。
  - 架构：解析器在 iframe 上下文（notice.chaoxing.com）执行；顶层 i.chaoxing.com 直接返回 null（不覆盖 iframe 已写入缓存）。`models.ts` 的 `PLATFORM_HOSTS.chaoxing` 加 `notice.chaoxing.com`；`content.ts` matches 加 `https://notice.chaoxing.com/*`；`wxt.config.ts` host_permissions 已含该域。
  - `chaoxing.ts` 落地：纯函数 `classifyChaoxingTitle`/`extractChaoxingCourse`/`mapChaoxingAssignments`（可单测）+ DOM 胶水 `readRawItems`/`extractChaoxingAssignments`（用诊断证据中的稳定 class，不猜未出现字段）；replaceAll 整组替换缓存，列表为空/无作业通知时清空旧条目。
  - 新增 `chaoxing.test.ts`（5 例，真实标题样本：分类、课程抽取、字段映射、DOM 层过滤排除结束提醒/考试通知、无书名号回退）。
  - 验证：`npm run compile` 零错误；`npm test` 33/33（新增 5）；`npm run build` 成功，manifest `content_scripts.matches` 与 `host_permissions` 均含 i.chaoxing.com 与 notice.chaoxing.com。
  - 需求文档已同步（第 2/6/12/14 节：学习通从"待验证"移入"已实现"，写明判定规则与 iframe 结构）。
  - 已知限制：① 收件箱分页（"点击加载更多"）仅取首屏，未自动翻页；② 顶层 i.chaoxing.com 点"刷新当前平台"只能触发顶层（跨域读不到 iframe），实际依赖 iframe 加载时自动上报；③ 不解析未读之外的提交状态，历史作业也会列出（如需"仅未读/仅近期"可后续加过滤）。

- 2026-10-25（上午）：**明确「学习通任务是否完成」的判定方案，并改造诊断工具使其支持泛雅课程页**。
  - 现状复盘：当前 `chaoxing.ts` 只解析收件箱（`notice.chaoxing.com`），收件箱天生不含提交状态 → 无法判定完成（作业恒 `unsubmitted`、考试仅按截止分 `unsubmitted`/`expired`，且 `expired`≠已完成）。确认网页版无跨课程“我的作业”聚合页，只能逐门课程解析。
  - 判定方案定型：作业/考试列表页（带 `未完成/待批阅/已完成/已退回/重考` 状态）为权威源；任务页按 `进行中(待做)/已结束(已完成，按用户拍板)` 简化判定。用户确认的最终判定表见 `document/学习通任务完成判定规则.md`。
  - 域名权限：截图证据显示课程枚举在 `mooc1.chaoxing.com`、课程内作业/考试/任务在 `mooc2-ans.chaoxing.com`（同一 SPA 靠 enc 切标签）。`wxt.config.ts` 的 `host_permissions` 与 `content.ts` 的 `matches` 均新增 `mooc1.chaoxing.com` / `mooc2-ans.chaoxing.com` / `*.chaoxing.com`（诊断在泛雅页失败的根因就是缺这些域权限）。
  - 诊断工具改造（`src/diagnose.ts`）：`findAssignmentTab` 关键词扩展为 `作业|任务|考试|收件箱|消息|未读|待办`（泛雅菜单可点开列表，不进答题页）；新增泛雅课程页提取分支——按可见状态文案结构化产出 `DiagnosticAssignment`（作业/考试列表 + 任务页 进行中/已结束 分组 + 截止时间进 `note`），与东软结构互斥；`DiagnosticAssignment` 新增可选 `note` 字段。`popup/App.tsx`：报错文案纳入泛雅课程页、框架选择优先采用泛雅主文档、隐私说明补充课程页、渲染 `note`。
  - 落地规格存档：`document/学习通任务完成判定规则.md`（判定表 + 数据源 + 课程枚举前置 + 状态枚举扩展 + 完整性校验 + 安全边界）。后续据泛雅三标签诊断证据回填 `chaoxing.ts` 正式解析器。
  - 验证：`npm run compile` 零错误；`npm test` 58/58 通过；`npm run build` 成功，产物 manifest `host_permissions` 与 `content_scripts.matches` 均已含泛雅课程页两域。`content.js` 17.73→29.71 kB。

- 2026-10-25（下午）：**修正诊断捕获不到泛雅「任务」标签内容的问题，并补完验证**。
  - 用户回传泛雅课程页「任务」标签诊断 JSON：hostname=mooc2-ans.chaoxing.com，mainText 仅导航文字（`王云贤 课程门户 链接 线性代数 任务 章节 讨论 作业 考试 …`），`assignments` 为空；tree 显示任务真实列表在跨域 iframe（`mobilelearn.chaoxing.com/page/active/stuActiveList?courseid=…&clazzid=…`），左侧菜单 `<a data-url>` 暴露作业端点 `mooc1.chaoxing.com/mooc2/work/list`、考试端点 `mooc1.chaoxing.com/exam-ans/mooc2/exam/exam-list`。
  - 根因：一次 executeScript 只抓到 mooc2-ans 外壳主文档，内容 iframe 在点标签后才加载，漏捕。改造 `popup/App.tsx` 的 `runDiagnostic`：改为**两轮注入**（首轮 + 间隔 1800ms + 次轮）以捕获“点标签后才加载”的内容 iframe；重写框架选择优先级为**内容 iframe 优先于外壳主文档**（`mobilelearn.chaoxing.com` 含 mainText > `mooc1.chaoxing.com` 含 mainText > `notice.chaoxing.com` > 含状态文案的泛雅主文档 > 其它含 mainText > 首个）。
  - 修复编译错误 TS2322：`runDiagnostic` 内 `tab.id` 在嵌套 `injectAll` 闭包中控制流收窄失效（变 `number|undefined`），改为先 `const tabId = tab.id` 固化后在闭包内使用。
  - 文档纠正：`学习通任务完成判定规则.md` 域名入口表修正“内容在主文档”的错误假设，记录 mobilelearn/mooc1 内容 iframe 端点与“解析需在内容 iframe 上下文运行”的要求。
  - 验证：`npm run compile` 零错误；`npm test` 58/58 通过；`npm run build` 成功（content.js 29.71 kB），产物 manifest `host_permissions` 含 mooc1/mooc2-ans/`*.chaoxing.com`，`content_scripts.matches` 含上述域且 allFrames=true。
  - 待办：用户**重载扩展**后，分别于泛雅课程页诊断「作业 / 考试 / 任务」三个标签（任务标签此前因 iframe 漏捕只抓到外壳，本次修复后应能抓到内容帧），将结构化 `assignments` 与 `mainText` 贴回，即可据真实 DOM 回填 `src/chaoxing.ts` 正式解析器（阶段A课程注册表 + 状态枚举扩 submitted/completed/returned/retake + 内容 iframe 上下文解析 + 与收件箱数据按 courseId+标题 合并）。

- 2026-10-25（下午·续）：**用户重测「任务」标签仍只抓到外壳（assignments 空、选中 mooc2-ans）**——证明仅有“两轮 allFrames 注入”不够。
  - 再定位根因：`collectPageDiagnostic` 注入到 mobilelearn 内容帧后，只走 `else` 分支 `await wait(800)` 就读取 `body.innerText`；而该 iframe 列表由前端 XHR 异步渲染，800ms 远不够，正文尚空 → 该帧报告 mainText 空 → 优先级回退到外壳。
  - 修复（`src/diagnose.ts`）：新增 `isContentFrame` 分支——当运行在 `mobilelearn.chaoxing.com` / `mooc1.chaoxing.com` 帧内时，**轮询等待 body 出现任务/状态类文本（最多 ~6s，每 400ms 探一次）** 再读取；同时内容帧跳过“点击作业标签”逻辑（避免误点列表内筛选标签）与收件箱式考试详情探测。
  - 修复（`popup/App.tsx` 的 `runDiagnostic`）：在“两轮 allFrames”之后，**用 `browser.webNavigation.getAllFrames` 枚举实际帧、按 `frameId` 定向注入** mobilelearn/mooc1 内容帧（不再依赖 allFrames 的时机），注入前再等 2200ms 给 XHR 渲染；对同 hostname 的多份报告按 mainText 长度去重保留最全；新增 `framesSeen` 状态并在诊断面板展示“捕获到的框架”，便于排查内容帧是否被注入（若未含 mobilelearn/mooc1 会给提示）。
  - 验证：`npm run compile` 零错误；`npm test` 58/58 通过；`npm run build` 成功（content.js 29.71 kB，popup chunk 253.85 kB）。
  - 待用户：重载扩展 → 先点开「任务」标签等列表加载完 → 点“诊断当前页面”，确认“捕获到的框架”含 `mobilelearn.chaoxing.com` 且 assignments 不再为空；同样测「作业」「考试」标签（端点 mooc1.chaoxing.com/mooc2/work/list 与 exam-ans/mooc2/exam/exam-list）。贴回三份结构化结果即可落地解析器。

- 2026-10-25（中午）：**用户按步骤重测，「任务」仍只抓外壳**——证明 allFrames + getAllFrames(frameIds) 两条跨域注入路径在用户环境都静默失败（getAllFrames 可能抛错被吞、或跨域帧注入时机/权限问题）。不能再赌跨帧注入。
  - 改确定性路径：`diagnose.ts` 的 `collectPageDiagnostic` 在外壳主文档直接读取内嵌 iframe 的**完整 URL**（`mobilelearn.chaoxing.com`/`mooc1.chaoxing.com`，从 `document.querySelectorAll('iframe')` 取真实 src，不经 tree 的 200 字截断），写入新字段 `contentFrameUrls`；`App.tsx` 的 `runDiagnostic` 若最终选中报告非内容帧，则**用该 URL `tabs.create({active:false})` 开临时后台标签作为顶层文档诊断**（顶层注入不涉跨域帧时机/权限），抓到有效正文即采纳并 `tabs.remove` 关掉临时标签。`framesSeen` 改为最终报告后统一计算（含新标签帧 hostname）。
  - 采纳门槛放宽：内容域且 `mainText.length>40` 即采纳（即便提取器尚未精确匹配其措辞，真实 mainText+tree 也能回填空解析器）；登录/空白/重定向页不会误采纳，但确保拿到真内容。
  - 验证：`npm run compile` 零错误；`npm test` 58/58 通过；`npm run build` 成功（content.js 29.71 kB）。
  - 待用户：重载扩展 → 泛雅课程页点开「任务」标签 → 点“诊断当前页面”；预期“捕获到的框架”出现 `mobilelearn.chaoxing.com` 且 assignments/mainText 变为该列表页正文。若仍失败，新标签诊断的 warn 日志会提示原因（登录态/重定向/列表空），据此再定方案（必要时直接拿 iframe URL 手动开标签诊断）。

- 2026-10-25（下午·收网）：**确定性兜底成功，拿到 mobilelearn 任务列表真实 DOM，并据此落地任务/活动解析器**。
  - 用户贴回的诊断：`hostname=mobilelearn.chaoxing.com`、`title=任务列表`、`mainText=进行中（0） 已结束（15） 普通签到 结束时间：05-20 08:06 …（15 条）`，`assignments` 仍空（提取器未匹配泛雅措辞），但 tree 完整 —— 证明“临时后台标签 + 顶层文档诊断”路径可行。
  - **落地解析器（`src/chaoxing.ts`）**：
    - `parseChaoxingTaskListDom(doc, url, nowMs)`：课程名取 `h2#classObjName`；课程标识取 URL 的 `courseid`+`clazzid`（`259363438-139380153`），缺失降级课程名 slug；遍历 `.bottomList` 直接子元素，遇 `.status` 切换分组（进行中/已结束）、遇 `ul` 收集 `li`；单条取 `.right-content p`（标题）、`.tag[class*=icon-]`（类型）、`.time`（结束时间）。
    - `mapChaoxingTaskTypeIcon`：icon-signin-g→签到、icon-xr-g→选人、icon-tp→任务，未知图标只去 `icon-` 前缀（不臆测语义）。
    - `normalizeChaoxingTaskDeadline`：`MM-DD HH:mm` 无年份 → 用当前年补齐；已结束项若补齐后落在未来则回退上一年（避免把已结束项误判到未来）。
    - `mapChaoxingTaskAssignments`：进行中→`in_progress`，已结束→`ended`；id = `chaoxing:<courseid-clazzid>:task:<hash(分组|类型|标题|截止文本)>`；标题形如 `签到·普通签到（05-20 08:06）`。
    - `extractChaoxingAssignments` 路由：`mooc2-ans` 外壳返回 null（内容在 iframe，交给内容帧解析）；`mobilelearn` + `stuActiveList` → 任务列表解析；`work/list` / `exam-list` → 暂返回 `needs-verification`（明确提示未落地，不静默清空缓存）。
    - ID 分工（阶段 A 前的过渡）：`assignment.courseId` 用课程名 slug（与收件箱一致，保证同课程一个分组）；合并作用域 `courseIds` 用稳定 `courseid-clazzid`（不误清收件箱同课程作业）。遗留：教师删活动后旧项残留，待阶段 A 修复。
  - **状态枚举与看板（`src/models.ts` / `popup/App.tsx` / `App.css`）**：
    - `status` 扩为 `unsubmitted|expired|in_progress|submitted|completed|ended|returned|retake`；新增 `assignmentStatusLabel()`（需重交/已完成（可重考）/进行中…）与 `isAssignmentHiddenByDefault()`（仅 `completed`/`ended` 默认隐藏，`expired` 仍受独立开关控制）。
    - 看板 `visible` 与平台徽标计数同步应用新隐藏规则；行 class 改为 `is-<status>`；CSS 补 `returned`（红）、`retake`（蓝）、已办结（绿）三套样式。
  - **诊断增强（`src/diagnose.ts` + `App.tsx`）**：
    - `contentFrameUrls` 增加候选来源：左侧菜单 `a[data-url]` 拼上外壳 URL 查询参数 —— 与外壳点标签时生成的 iframe 地址一致，**无需手动点开「作业」「考试」标签**即可取证。
    - 新增 `listRows`（按 `.bottomList li` / `li.dataBody_item` / `tr` / `[data-id]` 等采样行，保留行级 id 与 data-*）与 `pageParams`（查询参数，长令牌脱敏）。
    - 兜底改为**遍历最多 3 个候选 URL** 各开临时标签取证，采纳“内容最全”的一份（某候选重定向/空列表不会拖垮整次诊断）。
  - **测试**：`src/chaoxing.test.ts` 新增 7 组单测（自研极简选择器引擎的假 Document，覆盖 #id/.class/.class[class*=x]/标签名/两级后代），含真实样本 15 条活动解析、进行中分组识别、缺 DOM/缺课程标识返回 null、状态映射、稳定 id 去重。
  - 验证：`npm run compile` 零错误；`npm test` **65/65** 通过（原 58 → 65）；`npm run build` 成功（content.js 33.60 kB）。
  - 待用户：重载扩展 → 泛雅课程页直接点「诊断当前页面」（诊断会自动开临时标签取「作业」「考试」列表），贴回这两份 JSON（重点 `listRows`/`assignments`/`mainText`），即可回填作业/考试解析器（`submitted`/`completed`/`returned`/`retake` 映射）。

- 2026-10-25（傍晚·阶段 A 收尾）：**课程注册表解析→存储→后台→弹窗全链路打通**。
  - 用户回传「我的课程」页诊断（`mooc2-ans/visit/interaction`，6 门课）：卡片 `div.course` 的 `id="c_<courseId>"`、class 含 `stu_<clazzId>`；`.course-info h3` 课程名、`p.color3` 教师、`p.margint10` 别名、`.btm-cover` 任务点进度。**线性代数 = 259363438 / 139380153**，与任务列表 URL 的 `courseid`/`clazzid` 完全一致 → 稳定 ID 方案得到交叉验证。
  - `src/chaoxing.ts` 新增：`parseChaoxingCourseId`（`c_259363438`→`259363438`）、`parseChaoxingClazzId`（class 中 `stu_139380153`）、`parseChaoxingProgress`（`任务点进度: 62/62 100%`→`{done,total}`）、`parseChaoxingCourseListDom(doc, syncedAt)`（跳过错缺 ID/无名称/重复）。路由：`mooc2-ans` + `visit/interaction` → 注册表。
  - `src/models.ts` 新增 `ChaoxingCourse` 接口（courseId/clazzId/name/teacher/alias/progressText/progressDone/progressTotal），`PlatformExtractionResult` 增 `courses?`。
  - `src/storage.ts` 新增 `loadChaoxingCourses()` / `saveChaoxingCourses()`；`background.ts` 同步消息增 `courses?` 并落盘；`content.ts` 上报增 `courses`。
  - `src/selectors.ts` SELECTORS_VERSION 1→2，补任务与课程卡片两组选择器。
  - `popup/App.tsx` / `App.css`：新增可折叠「学习通课程注册表」区块（默认折叠，展示课程名/别名/教师/`courseId · clazzId`/章节进度），并明确标注进度非作业状态。
  - ⚠️ 重要区分：「任务点进度」是章节视频学习进度，**不是作业提交状态**，不参与判定表。
  - 验证：`npm run compile` 零错误；`npm test` **70/70**（新增 5 组注册表单测，含 6 门课真实样本、线性代数 ID 交叉验证、无效卡片跳过、空→[]）；`npm run build` 成功（content.js 35.79 kB）。
  - 待用户：重载扩展 → 打开「我的课程」页（`mooc2-ans/visit/interaction`）停留几秒让其上报 → 再进任一课程页点「诊断当前页面」，诊断会自动开临时标签取「作业」「考试」列表；贴回这两份 JSON（重点 `listRows`/`assignments`/`mainText`），即可回填作业/考试解析器（`submitted`/`completed`/`returned`/`retake` 映射）。

- 2026-10-25（夜·第二批诊断）：**发现「任务」页是混合列表 —— 它聚合了作业/测验**，并据此修正类型识别。
  - 数据库课任务页（`courseid=266109891&clazzid=152005723`，h2「数科25003-25004班」）进行中（0）/已结束（12）：11 条标题写着「作业」（icon-cy-g）、1 条「二维码签到」（icon-signin-g）。公网资料印证：课程内「任务」标签会显示作业、测验、活动。
  - 风险：若一律按“已结束→已完成隐藏”，可能把**未提交的作业**藏起来。已向用户确认，用户拍板 **仍按“已完成”隐藏**，等作业页（mooc1 work/list）解析器用真实提交状态覆盖 → 代码保持 `已结束 → ended`。
  - `chaoxing.ts`：类型图标表新增 `icon-cy-g` → '作业或测验'（中性，不臆测为“测验”）；因每条 li 都带通用 `icon-tp`，取类型时优先具体图标，避免把作业误标为“任务”。
  - 课程名兜底：实测 h3 无直接文本节点（课程名在其子 `<a>` 内），parser 改为 `textContent` 优先并回退 `h3 a` / `.course-info a`。
  - `diagnose.ts`：MAX_DEPTH 12→14 —— 原深度刚好截断在 `.course-info`，导致 h3 里的课程名在诊断树里看不到（mainText 看得到，是深度截断而非 DOM 无文本）。
  - 测试 **70 → 73/73**：新增 icon-cy-g 映射、数据库课真实 12 条解析（11 作业类 + 1 签到、全部 ended、id 互不重复）、课程名嵌在 h3>a 的卡片解析。compile 零错误、build 成功。
  - 待用户：重载扩展 → 任务页点「未完成」筛选、等刷新后点「诊断当前页面」，贴回 JSON；据此校准“已结束”是否真等于已完成。

- 2026-10-25（夜·判定收口）：用户最终确认 **任务页「已结束」直接判定为已完成**（不再区分活动/作业），看板隐藏。
  - 代码早已一致（`ended` → 标签「已完成」+ `isAssignmentHiddenByDefault` 默认隐藏），本轮补单测锁死该规则，防止后续改动回退：`src/models.test.ts` 新增 2 组（8 个状态标签逐一断言；隐藏规则断言 returned/retake/expired 不隐藏）。
  - 判定规则文档：判定表该行改为「直接判定为已完成（最终确认）」；2.2 节把“待取证”降级为**可选交叉验证**（不阻塞）。
  - 验证：compile 零错误 / test **75/75** / build 成功。

- 2026-10-29：**修复“单课程合并形同失效”的隐藏 bug，并落地阶段 B 逐课抓取**（承接 10-25 的未完成项 3）。

  **1. 合并作用域 bug（真实缺陷，非重构）**
  - 现象反推：任务页解析结果的 `assignment.courseId` 是**课程名 slug**（为与收件箱通知同源、保证一门课在看板只出现一个分组），而 `extractChaoxingTaskListResult` 传的合并作用域 `courseIds` 是**稳定的 `courseid-clazzid`**。`mergeAssignmentsByCourse` 只比对 `a.courseId`，两个键永不相等 → 该课程的旧条目一条都不会被清除。后果：① 活动从「进行中」滑到「已结束」后，旧的“进行中”副本永久残留；② 教师删除活动后旧项永不消失（10-25 已记录为遗留问题，本次定位到根因）。
  - 修复（`src/models.ts`）：新增 `isAssignmentInScope`，在比对 `courseId` 之外，额外用作业项 id 内嵌的 `:<courseId-clazzId>:` 做**边界匹配**（不是 `includes(key)`，否则 `2593634` 会误匹配 `259363438`，把别的课一起清掉）。
  - 配套（`src/chaoxing.ts`）：`hashTaskItem` 的哈希**去掉 section（进行中/已结束）**。活动到点只是状态迁移，不是另一条活动；若把分组算进哈希，状态一变 ID 就变，看板会同时出现“进行中”和“已完成”两条同项记录。
  - 回归锁定（`src/models.test.ts` +`src/chaoxing.test.ts`，+4 组）：scope 为 `courseid-clazzid` 时能替换课程名分组的旧条目；前缀相近课程不被误清；课程改名（slug 变化）后旧条目仍能清掉；同一活动滑到「已结束」时 id 不变、只换 status。

  **2. 阶段 B 逐课抓取（新功能）**
  - 依据：注册表已有 6 门课的 `courseId`/`clazzId`，且与任务列表 URL 交叉验证一致；端点是 10-25 取证到的真实地址 `mobilelearn.chaoxing.com/page/active/stuActiveList?courseid=…&clazzid=…`（不是猜测）。该页是 SPA，后台 fetch HTML 只有骨架，故沿用诊断工具验证过的确定性路径：**开临时标签 → 让页面自己渲染 → 由该标签的 content script 上报**。
  - 新增 `src/chaoxing-crawl.ts`（纯函数，可单测）：`chaoxingCourseKey`、`buildChaoxingTaskListUrl`（走 `URLSearchParams`，防拼接注入）、`planChaoxingCrawl`（跳过缺 ID 的残缺卡片、按课程键去重、上限 12 门、保持注册表顺序）、`summarizeChaoxingCrawl`（成功/部分/全失败的统一口径）。常量：单门课 25s 超时、单批最多 12 门。
  - `entrypoints/background.ts`：新增等待表 `crawlWaiters`（key = 稳定课程键）+ `settleCrawlWaiter`（在既有 `PLATFORM_PAGE_READY` 处理器**落库后**兑现，保证抓取流程关标签时数据已写入）；`crawlSingleCourse`（开后台标签 → `Promise.race` 等待上报/超时 → 无论成败都在 finally 关标签）；`crawlChaoxingCourses`（顺序逐门、失败仅在“列表未渲染”时重试一次、超时不重试、每门写一条运行日志、结束汇总）。
  - MV3 保活：批量流程可能持续数分钟，而后台闲置约 30s 会被回收 → 抓取期间每 15s 调一次 `getPlatformInfo()` 重置闲置计时，`finally` 里清定时器。
  - 并发保护：连点或两个弹窗会同时开两批标签，而等待表按课程键覆盖会互相串 → 用 `crawlInFlight` 拒绝后来者（`runChaoxingCrawl` 拆出内层实现，保证任何路径都能复位）。上报先到时会清掉未触发的 25s 超时定时器。
  - 消息通道：整批几十秒，远超默认生命周期，故单独注册一个 `CRAWL_CHAOXING_COURSES` 监听器，用 `sendResponse` + `return true` 显式挂起；弹窗中途关闭导致 `sendResponse` 抛错时吞掉（后台抓取与落库不受影响）。
  - `entrypoints/popup/App.tsx` / `App.css`：注册表区块下方新增「逐课同步 N 门课」按钮（抓取中禁用并显示“逐课同步中…”）+ 结果提示行；`registry-actions` / `crawl-button` / `crawl-hint` 样式沿用既有 teal 配色。
  - 新增 `src/chaoxing-crawl.test.ts`（8 组）：端点必须仍是取证过的域与路径、ID 编码不被注入、缺 ID 跳过、重复卡片去重、上限截断、空注册表、四种汇总口径。

  **3. 验证与产物**
  - `npm run compile` 零错误；`npm test` **75 → 87/87**（+12）；`npm run build` 成功并落在 D 盘 `.output/chrome-mv3`（浏览器实际加载目录）。
  - 体积：`background.js` 8.17 kB → **11.59 kB**（新增逐课抓取）；`content.js` 35.79 kB → **35.91 kB**（仅哈希改动）；popup chunk 259.30 kB。产物内已确认含 `CRAWL_CHAOXING_COURSES`、`stuActiveList`、弹窗「逐课同步」文案，`body{width:680px}` 规则仍在。
  - 文档同步：`学习通任务完成判定规则.md` 第 4 节（阶段 B 实现细节 + ID/作用域分工 + 边界匹配的必要性）、第 8 节（已完成/下一步）已更新。

  **4. 仍需用户操作的两项（代码侧无法替代）**
  - 阶段 B 端到端：重载扩展 → 打开「我的课程」页刷新注册表 → 点「逐课同步」，预期 6 门课逐条出现在运行日志、临时标签自动关闭。**待补充：尚未实测。**
  - 作业/考试解析器：仍缺 `mooc1.chaoxing.com/mooc2/work/list` 与 `exam-ans/mooc2/exam/exam-list` 的真实 `listRows`/`mainText`（诊断会自动开临时标签取，贴回即可落地）。

- 2026-10-29（下午）：**修两个“看起来像环境问题、其实是代码 bug”的故障**（用户实测反馈：逐课同步提示“未返回结果”；诊断只能取到「任务」，作业/考试取不到）。

  **1. 逐课同步“未返回结果” —— Chrome 消息应答被抢**
  - 根因：background 里处理「页面上报」的监听器写成了 `onMessage.addListener(async (message) => {…})`。Chrome 会把 async 监听器返回的 Promise 当成**本条消息的应答**（值为 `undefined`），而一条消息只能有一个应答者 → 后注册的「逐课同步」监听器永远拿不到通道，弹窗只能收到 `undefined`，于是显示“后台可能已被回收”。
  - 修复：**取消对该应答通道的依赖**。background 改为单一**同步**分发器（对不属于自己的消息显式 `return undefined`，不返回 Promise）；逐课同步的进度与结果写入 `storage.local` 的 `chaoxing-crawl-state`（`running/startedAt/finishedAt/total/succeeded/failed/message`），弹窗读存档、跟 `storage.onChanged` 刷新。附带好处：弹窗中途关掉再打开仍能看到进度与结果。
  - 附带加固：开跑即清空上一轮结论（避免旧结论被当本轮结果）；每门课完成写一次进度（弹窗显示 `x/y 门`）；弹窗点击后 3s 内若存档没换轮次则解锁按钮并提示“未启动”，防止界面永久卡在“逐课同步中…”。

  **2. 诊断只能取到「任务」—— 候选 URL 被拼坏 + 诊断位置不对**
  - 根因 A（代码 bug）：`diagnose.ts` 收集左侧菜单候选时用 `du + window.location.search`。当 `a[data-url]` 自带 `?courseId=…` 时会拼出**两个 `?`**（`…&classId=…?courseid=…`），第二个问号之后的参数全部作废 → 作业/考试列表页打开是空壳或错误页；而任务列表走的是 iframe `src`（不拼串），所以只有任务能诊断出来。
    修复：新增 `mergeFrameQuery`（与 `src/chaoxing-crawl.ts` 的 `mergeChaoxingFrameUrl` 同构），用 `URLSearchParams` **只补缺失键**——data-url 自带的 `enc/classId` 优先，外壳补 `courseid/clazzid/cpi`。
  - 根因 B（用法）：用户那份 JSON 是在 `mobilelearn.chaoxing.com`（内容帧页）上取的，该页只能看到当前这一张列表，天然取不到作业/考试。诊断面板现在会明确提示“请回到课程页（mooc2-ans）再诊断”。
  - 可见性改造（这是本轮最重要的可诊断性提升）：候选取证从“静默丢弃”改为**有界 BFS + 逐候选记录**。
    - 最多 2 层、合计最多 6 个临时标签；候选页若自己是“壳 + 内容 iframe”，会再往下探一层。
    - 每个候选记录 `candidateProbes`：去敏地址、层级、hostname、title、正文长度、列表行数、是否采纳、未采纳原因、正文前 200 字样本。诊断 JSON 里带上它，一眼看出是“登录页 / 错误页 / 空列表 / 真列表”。
    - 面板新增「候选内容页」切换标签：任务 / 作业 / 考试各一份报告，可分别查看并复制 JSON（不再只有“最优那一份”）。

  **3. 抓取成功率加固**
  - 地址记忆：成功解析后把该门课**真实的 `location.href`**（含 `stuenc/t` 等会话参数）记进 `chaoxing-task-urls`；逐课抓取时优先用记忆地址，手拼地址作后备（`orderCrawlCandidateUrls`），两者互为兜底。记忆表上限 24 门。
  - 渲染等待放宽：任务列表 `waitFor` 从 3000ms（自动上报）/5000ms（手动刷新）提到 6000/8000ms。`waitFor` 是轮询式，就绪即返回，只在真慢时才多等——避免把慢网络误判成“未渲染”。
  - 「未渲染」时才换下一个候选地址；超时/未登录不换（换地址没用，只会多开标签）。

  **4. 验证**
  - `npm run compile` 零错误；`npm test` **92 → 94/94**（新增 URL 合并/去敏/地址顺序/记忆表/状态存档等 7 组，含“旧写法会拼出两个问号”的反面断言）。
  - `npm run build` 成功：`background.js` 11.98 → **13.17 kB**、`popup` chunk 262.68 kB、`content.js` 35.91 kB；产物已确认含 `chaoxing-crawl-state`、「候选内容页取证」、「内容帧页面」提示文案。
  - ⚠️ 仍待用户实测：重载扩展后 ① 点「逐课同步」应看到 `x/y 门` 进度并以存档结论收尾；② 回到**课程页**点「诊断当前页面」，面板应出现「任务/作业/考试」候选标签与每个候选的取证结论。

- 2026-10-29（第三轮）：**作业/考试解析器落地 + 逐课同步改为「每门课抓两页」**（用户第二次实测反馈：逐课同步已成功 6/6，但看板仍没有作业；同时贴回 exam-list 的真实 DOM）。

  **1. 用户反馈的两个事实**
  - 「逐课同步」已修好：截图显示 `逐课同步完成：6 门课全部成功`（上一轮的状态存档方案生效）。
  - 诊断面板这次取到了 4 个候选，其中 `mooc1.chaoxing.com/exam-ans/mooc2/exam/exam-list` **采纳**（正文 138 字 / 10 行）。这份 JSON 是本次全部改动的依据。

  **2. 这条证据推翻了一个此前的假设**
  - 该页 `title` 叫「考试列表」，但**内容是作业 + 测验 + 课堂活动混合列表**：实测 10 行为 `线代作业1..4`、`线代测验1..4`、`课堂学习活动（第三章/第三章、第四章）`。
  - 所有行的图标都是 `icon-exam-g` → **图标无区分度，类型只能从标题推断**（此前 2.2 节记录的 `icon-cy-g` 是任务页的图标，两者不是一回事）。
  - `mooc1.chaoxing.com/mooc2/work/list` 实测**不可用**：打开后 `title="提示"`、正文 0 字、0 行（`candidateProbes` 里明确记着 `mainTextLength: 0`）。此前计划“分别抓作业页和考试页”，实际上作业也在 exam-list 里，只需这一页。

  **3. 根因：逐课同步从来没抓过作业页**
  - `planChaoxingCrawl` 只拼 `stuActiveList`（任务/活动），所以“6 门课全部成功”是真的成功，但**成功的是任务页**，作业、测验根本不在抓取范围内。这解释了“同步成功却看不到作业”。

  **4. 代码改动**
  - `src/chaoxing.ts` 新增（替换原 `needs-verification` 分支）：
    - `mapChaoxingExamStatus`：状态文案 → 统一枚举。**认不出返回 `null`**，绝不猜成已完成（猜错会把真实待办隐藏掉）。顺序上先判「退回/过期」再判「已完成」，避免「需重交」落到「已交」。
    - `inferChaoxingExamType`：从标题推断 作业/测验/考试/课堂活动/实验/讨论（考试优先于作业）。
    - `parseChaoxingExamListDom`：按真实结构 `li > .right-content > p.overHidden2（标题）+ p.status（状态）` 抽取。与任务页**相反**——没有「进行中/已结束」分组，状态在每行内部；且 `p.overHidden2` 与 `p.status` 是兄弟，取 `.right-content p` 的第一个会把状态当标题。
    - `mapChaoxingExamAssignments`：`dueAt` 一律 `null`（该页确实不显示截止时间，不臆造）；`courseId` 用课程名 slug（与收件箱/任务页同源，看板一门课一个分组）；id = `chaoxing:<courseId-clazzId>:exam:<type|title 哈希>`，**哈希不含 status**（状态迁移不换身份）。
    - 安全阀：`.bottomList` 有行但一条都认不出 → 抛 `SelectorError` 硬失败，避免返回空列表被后台当成“教师删光作业”而清空该课缓存。
  - `src/chaoxing-crawl.ts`：抓取计划改为**每门课两页**（`pages: [{task}, {exam}]`），新增 `buildChaoxingExamListUrl`（参数取自取证 URL；**不硬编码 `enc`**——那是会话令牌，硬编码立刻失效）、`chaoxingCrawlPageKindOf`、`chaoxingCrawlPageLabel`、`crawlUrlMemoryKey`。
  - `entrypoints/background.ts`：
    - 等待表键从 `课程键` 改为 `页面种类:课程键`。两页上报的 `courseIds` 完全相同（都是 `courseid-clazzid`），只按课程键索引会让任务页的上报把作业页的等待**提前兑现**（表现为作业页永远超时或结果串掉）。
    - 地址记忆同样按种类分键，否则两页互相覆盖，每次总有一页退回自拼地址。
    - `crawlSingleCourse` → `crawlSinglePage(target, page, url)`；`runChaoxingCrawl` 每门课顺序抓两页。
    - **课程成功口径 = 至少一页成功**：作业页失败不该连带否定任务页已入库的真实数据，反之亦然；哪页失败由 message 与日志说清，不夸大。
  - `src/diagnose.ts`：修 4a 作业项的**串行 bug**。样本「线代作业3 已过期 线代测验2 已完成」被解析成 `title="3 已过期 线代测验2"`（用户 JSON 里就有这条），原因是状态词表缺 `已过期`，且跨度只限 80 字不限内容。现在补全状态词，并要求跨度内不得再出现类型词；标题也保留类型词（原来只剩「3」「4」读不出是什么）。

  **5. 验证**
  - `npm run compile` 零错误；`npm test` **94 → 105/105**（新增 8 组 exam-list 解析/状态映射/身份稳定性 + 4 组两页抓取/端点/记忆键隔离）。
  - 诊断正则用真实样本对比验证：旧正则产出 `["作业","3 已过期 线代测验2","已完成"]`，新正则拆成 `["作业","3","已过期"]` + `["测验","2","已完成"]`。
  - `npm run build` 成功：`background.js` 13.17 → **14.03 kB**、`content.js` 35.91 → **39.49 kB**、popup chunk 262.78 kB，产物已确认含 `exam-ans/mooc2/exam/exam-list`、「作业/考试列表」文案、`overHidden2` 选择器与 `已过期` 映射。
  - ⚠️ **仍待用户端到端复测**：重载扩展 → 逐课同步。预期每门课出现 2 条日志（任务页 + 作业/考试页）；看板新增的多是「已过期」或「未完成」项（`已完成` 默认隐藏）。

  **6. 已知未做**
  - **分页**：exam-list 有 `.pageDiv`，当前只读第一页，作业超过一页会漏。
  - **跨来源去重**：同一份作业可能同时在收件箱（`chaoxing:<课程名>:homework:*`）与 exam-list（`chaoxing:<courseId-clazzId>:exam:*`）里，id 不同 → 看板可能出现两条。
  - **完整性校验**：任务页「进行中 (N) / 已结束 (N)」与解析条数一致性仍未做。

  **7. 汇总口径修正（避免同一错觉再次发生）**
  - `ChaoxingCrawlOutcome` 增加 `partial`：一门课两页只成功一页时不标为“完全成功”，
    `summarizeChaoxingCrawl` 改说「N 门课均有数据入库，其中 M 门有页面失败（详见运行日志）」。
  - 理由很直接：上一轮用户看到的就是「6 门课全部成功」+「看板没有作业」。
    如果这次作业页整批失败、汇总还是“全部成功”，同一个误解会原样复现。
  - 单测 105 → **106/106**（新增 1 组：一页成功一页失败时不得报“全部成功”）。

### 2026-10-29（续）真实 DOM 复核：解析没错，错在「两页互相清空」和「没提示为什么是 0」

**1. 用户提供的 exam-list 真实诊断 JSON 说明了什么**

样本是「线性代数」这门课，`.bottomList` 共 10 行：

| 行 | 状态 |
| --- | --- |
| 课堂学习活动（第三章、第四章）/（第三章） | 已完成 ×2 |
| 线代测验 1/2/3/4 | 已完成 ×4 |
| 线代作业 1/2/4 | 已完成 ×3 |
| **线代作业 3** | **已过期** |

三个结论：

- **解析器口径是对的**：`li > .right-content > p.overHidden2 + p.status` 与真实结构一致
  （实测 class 是 `"overHidden2 fl"` / `"status fl"`，`li > div > div.right-content` 的层级也对得上）。
- **这门课确实没有「未完成」作业**：9 条已完成、1 条已过期。
  而看板默认隐藏 `completed/ended`，`expired` 因 `dueAt=null` 不会被「隐藏已过期」开关命中
  → 正常情况下**只该显示 1 条**（`作业·线代作业3`）。
  所以「看板没有作业」= 用户看到 0 条，意味着**连这 1 条也没写进去**，问题在抓取层而非解析层。
- 诊断自身的两个缺陷：`assignmentSummary` 恒为 `null`（4a 只认「已完成 X/Y」文案），
  且正则把标题前缀吃掉（`线代测验4` → `测验4`），诊断结论与看板对不上。

**2. 根因一：任务页会清掉作业页刚写入的条目**

两页上报的 `courseIds` 完全相同（都是 `courseid-clazzid`），`mergeAssignmentsByCourse`
按 `:<课程键>:` 匹配**该课全部条目**，不区分来源页：

- 任务页 success → 清空整门课（含 `:exam:` 条目）→ 再补回自己的任务项；
- 只要作业页失败/超时/晚到，`exam` 条目就此永久消失。

**修复**：`mergeAssignmentsByCourse` 新增第 4 参数 `{ kind }`，`isAssignmentInScope`
做二次过滤——id 带 `:task:` / `:exam:` 段时只有同种类才归本次清理，
无种类段的旧条目（收件箱 `homework:*`、其它平台）保持旧行为。
background 用 `chaoxingCrawlPageKindOf(message.url)` 推出 kind 传入。

**3. 根因二：作业页缺 `enc` 时只会打开「提示」弹窗**

真实 exam-list 地址形如
`?courseid=259363438&clazzid=139380153&cpi=506947938&enc=fd0f1329…&t=…&v=2&hideHead=0&pageHeader=0`。
`enc` 是服务端下发的会话串，**前端无法生成**；自拼地址只有 `courseid/clazzid`，
多数登录态下会得到一张「提示」弹窗页（正文 0 字、无 `.bottomList`），
解析器抛 `SelectorError` → 该页必然失败 → 又回到根因一。

**修复（采地址）**：content script 在任意 `*.chaoxing.com` 页面上扫描
`a[href]` 与自身 `location.href`，把带 `enc=` 的 `exam-list` 地址
（以及 `stuActiveList` 地址）通过新消息 `CHAOXING_URL_HINT` 交给后台，
后台按 `exam:<courseid-clazzid>` 记入地址记忆，下次逐课同步优先使用。
只收带 `enc=` 的 exam-list 地址——不带 enc 的多半就是那个坏地址，记下来只会更差。

**修复（给下一步）**：`withChaoxingPageAdvice` 在作业页失败时追加可执行提示
「请先在浏览器里打开一次该课程的「作业」页」；未登录则提示先登录。
只报“超时/未渲染”用户无从下手。

**4. 根因三：0 条时没有任何解释**

看板 `未完成 0 项` 与“同步失败”在视觉上完全一样，用户无法区分。
新增 `另有 N 项已完成或已过期`（`totalCount - visibleCount`），
并在窄屏断点下**只保留这一条**（其余说明照旧隐藏）——它是解释 0 的唯一线索。

**5. 让「哪一页失败」可见**

`ChaoxingCrawlOutcome` 与 `ChaoxingCrawlState` 增加 `pages` / `items`，
逐课同步后弹窗可展开「抓取明细」：每门课两页各自的成败与失败原因。
此前只有汇总数字，哪怕加了 `partial` 也说不出“作业页到底成没成”。

**6. 诊断改成结构优先**

`src/diagnose.ts` 4a-0：先用 `.bottomList li` 的真实结构解析（标题取 `.overHidden2`、
状态取 `.status`），结构不可用才退回文本正则；`assignmentSummary` 在该结构下
按行统计（done=已完成行数，total=总行数）。诊断结论从此与看板同口径。

**7. 验证**

- `npm run compile` 零错误；`npm test` **106 → 112/112**
  （新增：分页合并不互相清空 ×3、无种类段旧条目不被误删、逐页明细入存档、失败建议文案、
  以及一条把真实 10 行样本换算成「看板只显示 1 条」的口径锁定）。
- `npm run build` 成功：`background.js` 14.03 → **15.38 kB**、
  `content.js` 39.49 → **40.00 kB**、`popup` chunk 264.32 kB。
- ⚠️ 仍待用户端到端复测：重载扩展 → 逐课同步 → 展开「抓取明细」看作业/考试页那一行。

**8. 本轮之后仍未做**

- exam-list 分页（`.pageDiv`）仍只读第一页。
- 跨来源去重（收件箱 `homework:*` 与 exam-list `exam:*` 仍是两个 id）。
- 任务页「进行中 (N) / 已结束 (N)」与解析条数的完整性校验。
  （本轮样本里 `已结束（15）` 但只抽到 12 行，这个校验迟早要做。）

## 2026-10-29（第二轮复测：作业页「超时」的真因）

用户贴回逐课同步结果：6 门课里 5 门的「作业/考试」页成功，只有
「数据库原理与技术（2026-2027·1学期）」显示 `等待页面上报超时（25s…）`。
底部来源分组显示学习通已有 6 条 —— 说明作业已经进看板，问题收窄到单页失败。

**真因不是 enc，而是「失败上报兑现不了」**

`extractChaoxingExamListResult` 解析失败时抛 `SelectorError`，content script 的
catch 分支上报 `{ status, message, assignments: [] }` —— **没有 courseId/courseIds**
（页面都没解析出来，自然给不出课程标识）。而 `settleCrawlWaiter` 只用
`message.courseIds / courseId` 拼 `waitKey`，于是：

页面早就答复了「作业/考试列表未渲染」→ 匹配不到等待中的课程 → 后台继续硬等 25s
→ 最终把原因写成「超时，可能未登录」。连「换下一个候选地址重试」这条分支
（判定条件是 `message.includes('未渲染')`）也从未被触发过。

**1. 等待表改从 URL 兜底取课程键**

新增 `crawlCourseKeysOfReport({ url, courseId, courseIds })`：显式键优先，
缺失时从 URL 的 `courseid/clazzid` 推 `cid-lid`（成败两种情况下 URL 参数都在）。
`settleCrawlWaiter` 改用它 → 失败上报立刻兑现，不再白等 25s。

**2. 失败建议的判定顺序**

原来 `withChaoxingPageAdvice` 第一条是 `/未登录|登录|login/`，而超时文案本身写着
“可能未登录” → 所有失败都被吞成一句“请先登录”，真正有效的那步（打开一次作业页
让扩展记住 enc）永远说不出口。顺序改为：未渲染/解析失败 → 超时 → 登录通配。

**3. 超时不再只说“可能未登录”**

`probeCrawlTab()` 在超时后用 `scripting.executeScript` 回读那个临时标签，把真实情况
写进失败原因：`页面已渲染出列表但未上报` / `页面仍在加载(interactive)` /
`标签页正文为空（标题「提示」），大概率是缺少 enc 的弹窗壳页` / `未渲染出列表（标题+正文前 80 字）`。
下次复测就能直接看到“打开了什么页”，不必再猜。

**4. `.null-data` 空态是有效结论**

平台在「本课程没有作业/考试」时只渲染 `.null-data`、没有 `.bottomList`。
此前 `parseChaoxingExamListDom` 返回 null → 抛“未渲染”，一门本来就没布置作业的课
会永远显示失败。现在有空态标记就返回 0 条（仍要求有课程标识，避免按错误作用域清缓存）。

**5. 明细里的「成功」要给条数**

`ChaoxingCrawlPageResult` 增加 `count`，弹窗显示「成功 · 8 条」。
只写“成功”无法区分「0 条」和「8 条」——这正是上一轮“6 门课全部成功却没有作业”的信息缺口。

**6. 验证**

- `tsc --noEmit` 零错误；`npm test` **112 → 114/114**
  （新增：失败上报按 URL 兜底取键 ×1、`.null-data` 空态 0 条 ×1；重写失败建议文案顺序 ×1）。
- `npm run build` 成功：`background.js` 15.38 → **16.84 kB**、
  `content.js` 40.00 → **40.08 kB**、popup 264.37 kB。
- 待复测：重载扩展 → 逐课同步 → 那门课应变成「成功 · N 条」，或给出精确的页面状态描述。

## 2026-10-29（第三轮复测：任务页恒为「成功 · 0 条」）

复测结果：**6 门课全部成功**，作业/考试页分别 6 / 5 / 2 / 12 / 10 / 12 条，
学习通在看板已有 6 条待办。上一轮那门课也变成了「成功 · 2 条」——等待表兑现修复生效。

但同时暴露出新问题：**任务页六门课全是「成功 · 0 条」**。而同一张页在诊断时
明明是 12 行（`进行中（0） 已结束（15）`）。0 条不是事实，是解析器的层级假设错了。

**真因**

`parseChaoxingTaskListDom` 里写的是 `if (child.tagName === 'UL')`——只认
`.bottomList` 的**直接子 `ul`**。而 `selectors.ts` 里配的 `taskItem` 恰恰是
`.bottomList li`（后代选择器）。平台把列表多包一层（`.bottomList > div > ul`）后，
解析器一条都收不到，但仍然返回 `success + []`，后台就当成“教师把活动全删了”。

**1. 遍历不再假设层级**

改成按文档顺序递归 `walk(bottom)`：遇到 `LI` 收条目并**停止下钻**
（li 内部的 `.status` 是条目自己的状态，不是分组头）；其余元素继续递归。
这样 `.bottomList > ul`、`.bottomList > div > ul`、任意深度包裹都能正确收集。

**2. 分组判定同步修正**

只放宽容器而不动分组会更糟：分组头一旦不在直接子层，所有条目都会归进第一个分组，
15 条「已结束」会变成 15 条「进行中」——看板凭空多出假待办。
现在分组取“文档顺序上最近的那个 `.status`”，与遍历顺序天然对齐。

**3. 任务页补上安全阀**

`行数 > 0 && 解析条数 === 0` → 抛 `SelectorError`，与作业页同一规则。
否则“解析不出来”会一直伪装成“老师删光了”，而这类静默失败正是本轮事故的本质。

**4. 验证**

- `tsc --noEmit` 零错误；`npm test` **114 → 116/116**
  （新增：列表多包一层仍能解析 ×1、分组头与列表同被包裹时分组仍正确 ×1）。
- `npm run build` 成功：`content.js` 40.08 → **40.27 kB**。
- 待复测：任务页应显示「成功 · 12 条」左右，而看板只显示「进行中」的活动
  （已结束项默认隐藏，由摘要条「另有 N 项已完成或已过期」交代）。

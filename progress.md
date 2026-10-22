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

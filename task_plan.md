# 作业整合作业看板搭建计划

## 目标

搭建基于 WXT + React + TypeScript 的 Edge Manifest V3 扩展骨架，先完成本地作业看板、缓存数据结构、按平台访问触发的同步接口和启动通知基础能力。

## 阶段

- [complete] 1. 初始化项目与依赖
- [complete] 2. 建立类型、存储和平台适配器架构
- [complete] 3. 实现 React 作业看板和扩展入口
- [complete] 4. 实现按平台访问触发的同步占位流程与启动通知
- [complete] 5. 运行构建和静态检查，修复问题
- [complete] 6. 整理结果并更新需求文档中的实施状态

## 关键决策

- 第一版采用 Edge 浏览器扩展，不采用 Electron。
- 技术栈采用 WXT + React + TypeScript + Manifest V3。
- 作业数据只保存在本机扩展存储中。
- 平台同步采用适配器接口；在平台页面结构完成验证前，不编写猜测性的页面解析器。
- 首版接入平台为东软智慧教育、批改网和 iTEST；学习通列为后续扩展。

## 错误记录

| 错误 | 尝试 | 处理 |
|---|---:|---|
| `python` 命令不可用 | 1 | 记录环境问题，继续使用 PowerShell、Node 和 npm 完成项目搭建 |
| WXT 不能在非空根目录初始化 | 1 | 使用 `extension/` 子目录保存扩展源码 |
| `npm create wxt@latest` 找不到 `create-wxt` | 1 | 改用 `npx wxt@latest init extension --template react --pm npm` |
| TypeScript 报告当前标签页可能为空 | 1 | 在发送当前页同步消息前增加 `tab?.id` 判断 |


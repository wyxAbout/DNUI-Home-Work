# 作业整合看板扩展

基于 WXT、React、TypeScript 和 Manifest V3 的 Microsoft Edge 扩展骨架。

## 开发

```bash
npm install
npm run dev
```

## 类型检查与构建

```bash
npm run compile
npm run build
```

生产构建输出在：

```text
extension/.output/chrome-mv3/
```

## 在 Edge 中加载

1. 打开 Edge 的扩展管理页面。
2. 开启“开发人员模式”。
3. 选择“加载解压缩的扩展”。
4. 选择 `extension/.output/chrome-mv3/` 目录。

当前平台页面解析器仍是占位实现。访问东软智慧教育、批改网或 iTEST 时，扩展会记录平台访问状态，但在解析器完成验证前不会生成或覆盖作业列表。

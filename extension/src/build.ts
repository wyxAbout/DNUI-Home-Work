// 构建标识：由 wxt.config.ts 的 vite.define 在打包时注入（每次构建都不同）。
//
// 用途：看板（popup）与 content script 属于两个独立产物，但同一次构建共享同一个值。
// 扩展重新打包后，已打开的旧标签页里仍是上一次注入的 content script —— 它只会返回
// 旧逻辑的结果（例如 iTEST 占位解析器返回“待验证”）。popup 通过 HW_PING 比对构建标识，
// 不一致就补注入最新产物，避免“代码已更新、看板却一直不动”。
declare const __HW_BUILD_ID__: string | undefined;

export const BUILD_ID: string =
  typeof __HW_BUILD_ID__ === 'string' ? __HW_BUILD_ID__ : 'dev';

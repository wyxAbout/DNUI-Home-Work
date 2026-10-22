// 扩展运行日志：持久化存储，供弹窗展示“访问了哪个平台 / 同步结果 / 诊断运行 / 报错”。
// 不记录任何作业内容、凭据或个人信息，只记录事件级信息。

export type LogLevel = 'info' | 'warn' | 'error';
export type LogSource = 'system' | 'sync' | 'diagnostic' | 'page';

export interface LogEntry {
  ts: string; // ISO 时间
  level: LogLevel;
  source: LogSource;
  message: string;
}

const LOG_KEY = 'homework-activity-log';
const MAX_ENTRIES = 200;

export async function appendLog(
  level: LogLevel,
  source: LogSource,
  message: string,
): Promise<void> {
  const raw = await browser.storage.local.get(LOG_KEY);
  const list = (raw[LOG_KEY] as LogEntry[] | undefined) ?? [];
  list.push({ ts: new Date().toISOString(), level, source, message });
  if (list.length > MAX_ENTRIES) {
    list.splice(0, list.length - MAX_ENTRIES);
  }
  await browser.storage.local.set({ [LOG_KEY]: list });
}

export async function loadLog(): Promise<LogEntry[]> {
  const raw = await browser.storage.local.get(LOG_KEY);
  return (raw[LOG_KEY] as LogEntry[] | undefined) ?? [];
}

export async function clearLog(): Promise<void> {
  await browser.storage.local.remove(LOG_KEY);
}

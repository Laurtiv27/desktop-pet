/**
 * 屏幕感知设置的纯校验与文案。
 *
 * 页面用分钟，写入控制器前换成秒（分钟 × 60）。
 * 校验规则与 helper 控制口 `validateScreenContextPatch` 一致，避免设置页放行、控制口再拒绝。
 * 不读文件、不发请求。
 * @module dsh-pet/src/standalone/settings-page/screen-context-settings
 */
import { ROUTE_SEGMENT } from '../../shared/constants.ts';

/** 设置页相对插件前缀的配置路径。callApi 会再拼上 `/dsh-pet-7340`。 */
export const SCREEN_CONTEXT_CONFIG_ROUTE = '/screen-context/config';
/** 设置页相对插件前缀的命令路径。 */
export const SCREEN_CONTEXT_COMMAND_ROUTE = '/screen-context/command';
/** 独立模式上的完整配置路径。 */
export const SCREEN_CONTEXT_CONFIG_PATH = `${ROUTE_SEGMENT}${SCREEN_CONTEXT_CONFIG_ROUTE}`;
/** 独立模式上的完整命令路径。 */
export const SCREEN_CONTEXT_COMMAND_PATH = `${ROUTE_SEGMENT}${SCREEN_CONTEXT_COMMAND_ROUTE}`;

/** 设置页状态行：桌面宠物没在跑。 */
export const SCREEN_CONTEXT_HELPER_OFFLINE = '桌面宠物未在运行';
/** 写操作在 helper 不在时的说明。 */
export const SCREEN_CONTEXT_CONTROL_UNAVAILABLE = '桌面宠物未在运行，屏幕感知无法控制';
/** 还没有可展示的摘要。 */
export const SCREEN_CONTEXT_EMPTY_SUMMARY = '尚无摘要';
/** 间隔输入不合法。 */
export const SCREEN_CONTEXT_INTERVAL_INVALID = '间隔必须是大于 0 的分钟数';
/** 卡片上的固定说明：摘要依赖独立模式的视觉模型。 */
export const SCREEN_CONTEXT_VISION_NOTE = '视觉摘要需要独立模式 AI 已就绪，且模型要能看图。';

/** 状态枚举到设置页的一行中文。未知状态不在这张表里。 */
export const SCREEN_CONTEXT_STATUS_LABELS: Readonly<Record<string, string>> = {
  idle: '尚未采集',
  ok: '正常',
  skipped: '已跳过',
  error: '出错',
  expired: '已过期',
};

/** 一次配置补丁。黑名单可以只带标题或只带进程。 */
export type ScreenContextPatch = {
  enabled?: boolean;
  intervalSec?: number;
  persistSummary?: boolean;
  blacklist?: { titles?: string[]; processes?: string[] };
};

/** 设置页能发给控制器的操作。 */
export type ScreenContextOp = 'enable' | 'disable' | 'patch';

/** 校验通过的命令。patch 必带补丁。 */
export type ScreenContextCommand =
  | { op: Exclude<ScreenContextOp, 'patch'> }
  | { op: 'patch'; patch: ScreenContextPatch };


/**
 * 把设置页的分钟数换成控制器要的秒。
 * @param minutes - 用户填的分钟，必须是大于 0 的有限数字。
 * @returns 通过时 `intervalSec = minutes * 60`。
 */
export function intervalSecFromMinutes(
  minutes: unknown,
): { ok: true; intervalSec: number } | { ok: false; message: string } {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) {
    return { ok: false, message: SCREEN_CONTEXT_INTERVAL_INVALID };
  }
  return { ok: true, intervalSec: minutes * 60 };
}

/**
 * 多行文本收成黑名单。空行丢掉，每行去掉首尾空白。
 * @param text - 文本框内容。
 * @returns 一行一项；没有有效行时为空数组。
 */
export function blacklistLines(text: string): string[] {
  if (typeof text !== 'string' || text.length === 0) return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** 黑名单里的每一项都必须是字符串，不改内容。 */
function validateStringList(
  value: unknown,
  label: string,
): { ok: true; list: string[] } | { ok: false; message: string } {
  if (!Array.isArray(value)) return { ok: false, message: `${label}必须是字符串数组` };
  const list: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return { ok: false, message: `${label}必须是字符串数组` };
    list.push(item);
  }
  return { ok: true, list };
}

/**
 * 校验配置补丁。未知字段忽略；已知字段类型不对就整单拒绝。
 * 规则与 helper `validateScreenContextPatch` 相同。
 * @param input - 请求体。
 * @returns 通过时给出只含合法字段的补丁。
 */
export function validateScreenContextPatch(
  input: unknown,
): { ok: true; patch: ScreenContextPatch } | { ok: false; message: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, message: '屏幕感知配置必须是对象' };
  }
  const obj = input as Record<string, unknown>;
  const patch: ScreenContextPatch = {};
  let count = 0;
  if ('intervalSec' in obj) {
    if (typeof obj.intervalSec !== 'number' || !Number.isFinite(obj.intervalSec) || obj.intervalSec <= 0) {
      return { ok: false, message: '截屏间隔必须是大于 0 的秒数' };
    }
    patch.intervalSec = obj.intervalSec;
    count += 1;
  }
  if ('enabled' in obj) {
    if (typeof obj.enabled !== 'boolean') return { ok: false, message: '开关必须是布尔值' };
    patch.enabled = obj.enabled;
    count += 1;
  }
  if ('persistSummary' in obj) {
    if (typeof obj.persistSummary !== 'boolean') return { ok: false, message: '开关必须是布尔值' };
    patch.persistSummary = obj.persistSummary;
    count += 1;
  }
  if ('blacklist' in obj) {
    if (!obj.blacklist || typeof obj.blacklist !== 'object' || Array.isArray(obj.blacklist)) {
      return { ok: false, message: '黑名单必须是对象' };
    }
    const raw = obj.blacklist as Record<string, unknown>;
    const blacklist: { titles?: string[]; processes?: string[] } = {};
    if ('titles' in raw) {
      const parsed = validateStringList(raw.titles, '标题黑名单');
      if (!parsed.ok) return parsed;
      blacklist.titles = parsed.list;
    }
    if ('processes' in raw) {
      const parsed = validateStringList(raw.processes, '进程黑名单');
      if (!parsed.ok) return parsed;
      blacklist.processes = parsed.list;
    }
    if (!('titles' in blacklist) && !('processes' in blacklist)) {
      return { ok: false, message: '黑名单至少要有标题或进程' };
    }
    patch.blacklist = blacklist;
    count += 1;
  }
  if (count === 0) return { ok: false, message: '没有可保存的屏幕感知设置' };
  return { ok: true, patch };
}

/**
 * 校验屏幕感知命令。enable / disable 不接受补丁。
 * @param input - 请求体，形如 `{ op, patch? }`。
 * @returns 通过时给出可交给控制器的命令。
 */
export function validateScreenContextCommand(
  input: unknown,
): { ok: true; command: ScreenContextCommand } | { ok: false; message: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, message: '屏幕感知命令必须是对象' };
  }
  const obj = input as Record<string, unknown>;
  const op = obj.op;
  if (op === 'patch') {
    const parsed = validateScreenContextPatch(obj.patch);
    if (!parsed.ok) return parsed;
    return { ok: true, command: { op: 'patch', patch: parsed.patch } };
  }
  if (op !== 'enable' && op !== 'disable') {
    return { ok: false, message: '未知的屏幕感知操作' };
  }
  if (obj.patch !== undefined) return { ok: false, message: '该操作不接受配置补丁' };
  return { ok: true, command: { op } };
}

function stateOf(view: { state?: unknown } | null | undefined): Record<string, unknown> {
  const state = view && view.state && typeof view.state === 'object' && !Array.isArray(view.state) ? view.state : {};
  return state as Record<string, unknown>;
}

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 最近一份摘要。没有正文时给占位句，不把状态枚举当成摘要。
 * @param view - 接口应答。
 * @returns 一行中文。
 */
export function screenContextSummaryCopy(view: { state?: unknown } | null | undefined): string {
  const text = trimmed(stateOf(view).text);
  return text || SCREEN_CONTEXT_EMPTY_SUMMARY;
}

/**
 * 状态行。helper 不在时不拿磁盘上的旧状态冒充正在采集。
 * @param view - 接口应答。`helper === false` 表示桌面进程没接上。
 * @returns 一行中文。
 */
export function screenContextStatusCopy(
  view: { helper?: unknown; state?: unknown } | null | undefined,
): string {
  if (!view || view.helper === false) return SCREEN_CONTEXT_HELPER_OFFLINE;
  const status = trimmed(stateOf(view).status);
  return SCREEN_CONTEXT_STATUS_LABELS[status] ?? '未知';
}

/**
 * 错误或跳过说明。没有就空字符串，设置页据此把错误行留空。
 * @param view - 接口应答。
 * @returns 错误、或黑名单跳过说明。
 */
export function screenContextErrorCopy(view: { state?: unknown } | null | undefined): string {
  const state = stateOf(view);
  return trimmed(state.lastError) || trimmed(state.errorMessage) || trimmed(state.skipNote);
}

/**
 * 状态行是否按错误色显示。没接上 helper，或本轮采集报错，都算。
 * 黑名单跳过不算错误。
 * @param view - 接口应答。
 * @returns 需要标红时为 true。
 */
export function screenContextStatusIsError(
  view: { helper?: unknown; state?: unknown } | null | undefined,
): boolean {
  if (!view || view.helper === false) return true;
  const state = stateOf(view);
  if (state.status === 'error') return true;
  return trimmed(state.lastError) !== '' || trimmed(state.errorMessage) !== '';
}

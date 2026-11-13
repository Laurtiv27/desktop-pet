/**
 * 坐姿守护设置的纯校验与文案。
 *
 * 页面脚本、独立模式转发和 helper 控制口共用同一组冷却与灵敏度取值。
 * 冷却只允许 5 / 10 / 30 秒，和坐姿告警的可选冷却一致。
 * 不读文件、不发请求：落盘与调用控制器由 helper 控制口负责。
 * @module dsh-pet/src/standalone/settings-page/posture-settings
 */
import { ROUTE_SEGMENT } from '../../shared/constants.ts';
import { POSTURE_COOLDOWN_CHOICES as COOLDOWN_CHOICES } from '../../shared/posture/defaults.ts';
import type { PostureConfig, Sensitivity } from '../../shared/posture/types.ts';

/** 设置页相对插件前缀的配置路径。callApi 会再拼上 `/dsh-pet-7340`。 */
export const POSTURE_CONFIG_ROUTE = '/posture/config';
/** 设置页相对插件前缀的命令路径。 */
export const POSTURE_COMMAND_ROUTE = '/posture/command';
/** 独立模式上的完整配置路径。 */
export const POSTURE_CONFIG_PATH = `${ROUTE_SEGMENT}${POSTURE_CONFIG_ROUTE}`;
/** 独立模式上的完整命令路径。 */
export const POSTURE_COMMAND_PATH = `${ROUTE_SEGMENT}${POSTURE_COMMAND_ROUTE}`;

/** helper 把监听端口写在这份文件里，设置页经独立模式转发，不直接连这个端口。 */
export const POSTURE_API_FILE = 'posture-api.json';
/** 端口文件里的名字，用来避开同目录下别的 JSON。 */
export const POSTURE_API_NAME = 'dsh-pet-posture-api';

/** 冷却单选，单位秒。 */
export const POSTURE_COOLDOWN_CHOICES = COOLDOWN_CHOICES;

/** 灵敏度单选：值给控制器，文案给设置页。 */
export const POSTURE_SENSITIVITY_CHOICES: readonly { readonly value: Sensitivity; readonly label: string }[] = [
  { value: 'strict', label: '严格' },
  { value: 'standard', label: '标准' },
  { value: 'loose', label: '宽松' },
];

/** 设置页状态行：桌面宠物没在跑。 */
export const POSTURE_HELPER_OFFLINE = '桌面宠物未在运行';
/** 写操作在 helper 不在时的说明。 */
export const POSTURE_CONTROL_UNAVAILABLE = '桌面宠物未在运行，坐姿守护无法控制';

/** 一次配置补丁，只含调用方真正提交的字段。 */
export type PosturePatch = Partial<PostureConfig>;

/** 设置页能发给控制器的操作。 */
export type PostureOp = 'enable' | 'disable' | 'pause' | 'resume' | 'recalibrate' | 'patch';

/** 校验通过的命令。patch 必带补丁，其余操作不带。 */
export type PostureCommand = { op: Exclude<PostureOp, 'patch'> } | { op: 'patch'; patch: PosturePatch };

const COOLDOWN_SET = new Set<number>(POSTURE_COOLDOWN_CHOICES);
const SENSITIVITY_SET = new Set<Sensitivity>(POSTURE_SENSITIVITY_CHOICES.map((item) => item.value));
/** 设置页可改的开关；系统通知已下线，不再接受 toast 补丁。 */
const BOOL_KEYS = ['enabled', 'paused', 'beep', 'petPerform'] as const;
const OPS = new Set<PostureOp>(['enable', 'disable', 'pause', 'resume', 'recalibrate', 'patch']);

/** 冷却按钮上的秒数文案。 */
export function postureCooldownLabel(seconds: number): string {
  return `${seconds} 秒`;
}

/**
 * 校验配置补丁。未知字段忽略；已知字段类型不对就整单拒绝。
 * @param input - 请求体。
 * @returns 通过时给出只含合法字段的补丁。
 */
export function validatePosturePatch(
  input: unknown,
): { ok: true; patch: PosturePatch } | { ok: false; message: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, message: '坐姿配置必须是对象' };
  }
  const obj = input as Record<string, unknown>;
  const patch: PosturePatch = {};
  let count = 0;
  if ('sensitivity' in obj) {
    if (typeof obj.sensitivity !== 'string' || !SENSITIVITY_SET.has(obj.sensitivity as Sensitivity)) {
      return { ok: false, message: '灵敏度只能是严格、标准或宽松' };
    }
    patch.sensitivity = obj.sensitivity as Sensitivity;
    count += 1;
  }
  if ('cooldown' in obj) {
    if (typeof obj.cooldown !== 'number' || !COOLDOWN_SET.has(obj.cooldown)) {
      return { ok: false, message: '冷却只能是 5、10 或 30 秒' };
    }
    patch.cooldown = obj.cooldown;
    count += 1;
  }
  for (const key of BOOL_KEYS) {
    if (!(key in obj)) continue;
    if (typeof obj[key] !== 'boolean') return { ok: false, message: '开关必须是布尔值' };
    patch[key] = obj[key];
    count += 1;
  }
  if (count === 0) return { ok: false, message: '没有可保存的坐姿设置' };
  return { ok: true, patch };
}

/**
 * 校验坐姿命令。enable/disable/pause/resume/recalibrate 不接受补丁。
 * @param input - 请求体，形如 `{ op, patch? }`。
 * @returns 通过时给出可直接交给控制器的命令。
 */
export function validatePostureCommand(
  input: unknown,
): { ok: true; command: PostureCommand } | { ok: false; message: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, message: '坐姿命令必须是对象' };
  }
  const obj = input as Record<string, unknown>;
  if (typeof obj.op !== 'string' || !OPS.has(obj.op as PostureOp)) {
    return { ok: false, message: '未知的坐姿操作' };
  }
  const op = obj.op as PostureOp;
  if (op === 'patch') {
    const parsed = validatePosturePatch(obj.patch);
    if (!parsed.ok) return parsed;
    return { ok: true, command: { op, patch: parsed.patch } };
  }
  if (obj.patch !== undefined) return { ok: false, message: '该操作不接受配置补丁' };
  return { ok: true, command: { op } };
}

/**
 * 状态行文案：helper 不在时不拿磁盘上的旧状态冒充正在检测。
 * @param view - 接口应答。`helper === false` 表示桌面进程没接上。
 * @returns 一行中文。
 */
export function postureStatusCopy(view: { helper?: unknown; runtime?: unknown } | null | undefined): string {
  if (!view || view.helper === false) return POSTURE_HELPER_OFFLINE;
  const runtime = view.runtime && typeof view.runtime === 'object' ? (view.runtime as Record<string, unknown>) : {};
  const status = typeof runtime.status === 'string' && runtime.status.trim() ? runtime.status.trim() : '未知';
  const error = typeof runtime.error === 'string' ? runtime.error.trim() : '';
  return error ? `${status}（${error}）` : status;
}

/**
 * 状态行是否按错误色显示。没接上 helper，或检测器报了 error，都算。
 * @param view - 接口应答。
 * @returns 需要标红时为 true。
 */
export function postureStatusIsError(view: { helper?: unknown; runtime?: unknown } | null | undefined): boolean {
  if (!view || view.helper === false) return true;
  const runtime = view.runtime && typeof view.runtime === 'object' ? (view.runtime as Record<string, unknown>) : {};
  return typeof runtime.error === 'string' && runtime.error.trim() !== '';
}

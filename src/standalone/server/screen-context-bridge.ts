/**
 * 把设置页的屏幕感知请求转到 helper 的本机控制口。
 *
 * 与坐姿共用 `$DSH_HOME/dsh-pet/posture-api.json` 里的端口和令牌，只连 127.0.0.1。
 * helper 不在时，读配置和上一份摘要可以回磁盘；写操作必须失败。
 * @module dsh-pet/src/standalone/server/screen-context-bridge
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { dshHomeDir } from '../../host/helper-process.ts';
import { loadScreenContextConfig } from '../../shared/screen-context/config.ts';
import type { ScreenContextConfig } from '../../shared/screen-context/types.ts';
import { parsePostureApiFile, type PostureApiRecord } from './posture-bridge.ts';
import { POSTURE_API_FILE } from '../settings-page/posture-settings.ts';
import {
  SCREEN_CONTEXT_CONTROL_UNAVAILABLE,
  SCREEN_CONTEXT_HELPER_OFFLINE,
} from '../settings-page/screen-context-settings.ts';

/** 转发所需的读盘与请求能力，测试可以整份换掉。 */
export interface ScreenContextRelayDeps {
  /** 读坐姿控制口的端口文件；没有或坏了就返回 null。 */
  readRecord(): PostureApiRecord | null;
  /** helper 不在时给设置页看的上一份配置。 */
  readConfig(): ScreenContextConfig;
  /** helper 不在时给设置页看的上一份摘要；读不到返回 null。 */
  readState(): unknown;
  /** 打到 helper 的请求。只会被叫到 `http://127.0.0.1:<port>/...`。 */
  fetchImpl(
    url: string,
    init: {
      method: string;
      headers: Record<string, string>;
      body?: string;
      redirect: 'error';
      signal: AbortSignal;
    },
  ): Promise<{ status: number; text(): Promise<string> }>;
}

/** 一次转发的输入。 */
export interface ScreenContextRelayInput extends ScreenContextRelayDeps {
  /** 这次用的端口记录；调用方每次现读。 */
  record: PostureApiRecord | null;
  /** 只转发 GET 与 POST。 */
  method: 'GET' | 'POST';
  /** helper 上的路径，如 `/screen-context/config`。 */
  upstreamPath: string;
  /** POST 体；GET 不传。 */
  body?: unknown;
}

const KNOWN_STATUS = new Set(['ok', 'skipped', 'error', 'expired', 'idle']);

/**
 * 把状态收成设置页能直接显示的对象。
 * 磁盘上的摘要文件只有 text 和 updatedAt，有正文就算上一份正常摘要。
 * @param input - 控制口 state 或磁盘 JSON。
 * @returns 缺字段用空值，不把坏 JSON 抛出去。
 */
export function normalizeScreenContextState(input: unknown): {
  status: string;
  text: string;
  updatedAt: number;
  errorMessage: string;
  lastError: string;
  skipNote: string;
} {
  const obj = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const text = typeof obj.text === 'string' ? obj.text : '';
  const updatedAt = typeof obj.updatedAt === 'number' && Number.isFinite(obj.updatedAt) ? obj.updatedAt : 0;
  const given = typeof obj.status === 'string' ? obj.status : '';
  const status = KNOWN_STATUS.has(given) ? given : text.trim() !== '' && updatedAt > 0 ? 'ok' : 'idle';
  return {
    status,
    text,
    updatedAt,
    errorMessage: typeof obj.errorMessage === 'string' ? obj.errorMessage : '',
    lastError: typeof obj.lastError === 'string' ? obj.lastError : '',
    skipNote: typeof obj.skipNote === 'string' ? obj.skipNote : '',
  };
}

/** helper 没接上时的读应答。 */
function offlineRead(deps: ScreenContextRelayDeps): { status: number; body: Record<string, unknown> } {
  return {
    status: 200,
    body: {
      ok: true,
      helper: false,
      message: SCREEN_CONTEXT_HELPER_OFFLINE,
      config: deps.readConfig(),
      state: normalizeScreenContextState(deps.readState()),
    },
  };
}

/** helper 没接上时的写应答。 */
function offlineWrite(): { status: number; body: Record<string, unknown> } {
  return {
    status: 503,
    body: { ok: false, helper: false, message: SCREEN_CONTEXT_CONTROL_UNAVAILABLE },
  };
}

/**
 * 把一次设置页请求转到 helper 的 `/screen-context/*`。
 * 令牌头与坐姿控制口相同。连不上时读走磁盘、写返回 503。
 * @param input - 端口记录、路径与读写替身。
 * @returns HTTP 状态与 JSON 体。
 */
export async function relayScreenContext(
  input: ScreenContextRelayInput,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!input.record) return input.method === 'GET' ? offlineRead(input) : offlineWrite();
  let response: { status: number; text(): Promise<string> };
  try {
    response = await input.fetchImpl(`http://127.0.0.1:${input.record.port}${input.upstreamPath}`, {
      method: input.method,
      redirect: 'error',
      signal: AbortSignal.timeout(4000),
      headers: {
        'X-DSH-Posture-Token': input.record.token,
        ...(input.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: input.body !== undefined ? JSON.stringify(input.body) : undefined,
    });
  } catch {
    return input.method === 'GET' ? offlineRead(input) : offlineWrite();
  }
  if (response.status !== 200 && response.status !== 400) {
    return input.method === 'GET' ? offlineRead(input) : offlineWrite();
  }
  let parsed: unknown;
  try {
    const text = await response.text();
    if (text.length > 65536) return { status: 502, body: { ok: false, message: '屏幕感知服务应答异常' } };
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { status: 502, body: { ok: false, message: '屏幕感知服务应答异常' } };
  }
  const body = parsed as Record<string, unknown>;
  if (response.status === 200) body.helper = true;
  return { status: response.status, body };
}

/** 用 `$DSH_HOME/dsh-pet` 下的端口文件、配置和摘要接上真实 helper。 */
export function createFileScreenContextBridge(home = dshHomeDir()): ScreenContextRelayDeps {
  const root = join(home, 'dsh-pet');
  return {
    readRecord() {
      try {
        return parsePostureApiFile(readFileSync(join(root, POSTURE_API_FILE), 'utf8'));
      } catch {
        return null;
      }
    },
    readConfig() {
      const configPath = join(root, 'screen-context.json');
      return loadScreenContextConfig(() => readFileSync(configPath, 'utf8'), configPath);
    },
    readState() {
      try {
        return JSON.parse(readFileSync(join(root, 'screen-context-state.json'), 'utf8')) as unknown;
      } catch {
        return null;
      }
    },
    fetchImpl: (url, init) => fetch(url, init),
  };
}

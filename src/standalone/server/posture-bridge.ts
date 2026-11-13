/**
 * 把设置页的坐姿请求转到 helper 的本机控制口。
 *
 * 设置页 CSP 只允许连接自身来源，不能直接打 helper 的随机端口。
 * 端口和令牌写在 `$DSH_HOME/dsh-pet/posture-api.json`；这里只连 127.0.0.1，不采用文件里的主机名。
 * helper 不在时，读配置可以回磁盘上的上一份，写操作必须失败，避免只改 JSON 却没有人拉摄像头。
 * @module dsh-pet/src/standalone/server/posture-bridge
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { dshHomeDir } from '../../host/helper-process.ts';
import { loadPostureConfig } from '../../shared/posture/config.ts';
import type { PostureConfig } from '../../shared/posture/types.ts';
import {
  POSTURE_API_FILE,
  POSTURE_API_NAME,
  POSTURE_CONTROL_UNAVAILABLE,
  POSTURE_HELPER_OFFLINE,
} from '../settings-page/posture-settings.ts';

/** helper 控制口的位置。令牌只用于本机转发，不回给浏览器。 */
export interface PostureApiRecord {
  /** 回环端口。 */
  port: number;
  /** 与 helper 约定的请求头令牌。 */
  token: string;
}

/** 转发所需的读盘与请求能力，测试可以整份换掉。 */
export interface PostureRelayDeps {
  /** 读端口文件；没有或坏了就返回 null。 */
  readRecord(): PostureApiRecord | null;
  /** helper 不在时给设置页看的上一份配置。 */
  readConfig(): PostureConfig;
  /** helper 不在时给设置页看的上一份状态；读不到返回 null。 */
  readStatus(): unknown;
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
export interface PostureRelayInput extends PostureRelayDeps {
  /** 这次用的端口记录；调用方每次现读，helper 后启动也能接上。 */
  record: PostureApiRecord | null;
  /** 只转发 GET 与 POST。 */
  method: 'GET' | 'POST';
  /** helper 上的路径，如 `/posture/config`。 */
  upstreamPath: string;
  /** POST 体；GET 不传。 */
  body?: unknown;
}

/**
 * 解析 helper 写下的端口文件。
 * @param text - 文件正文。
 * @returns 端口与令牌；形状不对返回 null。
 */
export function parsePostureApiFile(text: string): PostureApiRecord | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || parsed.name !== POSTURE_API_NAME) return null;
    const port = parsed.port;
    const token = parsed.token;
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) return null;
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    return { port, token };
  } catch {
    return null;
  }
}

/** 把状态文件收成设置页能直接显示的对象。缺字段用空值，不把坏 JSON 抛出去。 */
export function normalizePostureRuntime(input: unknown): {
  status: string;
  error: string;
  running: boolean;
  enabled: boolean;
  paused: boolean;
} {
  const obj = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  return {
    status: typeof obj.status === 'string' && obj.status.trim() ? obj.status : '未知',
    error: typeof obj.error === 'string' ? obj.error : '',
    running: obj.running === true,
    enabled: obj.enabled === true,
    paused: obj.paused === true,
  };
}

/** helper 没接上时的读应答：配置来自磁盘，并标明现在控不了。 */
function offlineRead(deps: PostureRelayDeps): { status: number; body: Record<string, unknown> } {
  return {
    status: 200,
    body: {
      ok: true,
      helper: false,
      message: POSTURE_HELPER_OFFLINE,
      config: deps.readConfig(),
      runtime: normalizePostureRuntime(deps.readStatus()),
    },
  };
}

/** helper 没接上时的写应答。 */
function offlineWrite(): { status: number; body: Record<string, unknown> } {
  return {
    status: 503,
    body: { ok: false, helper: false, message: POSTURE_CONTROL_UNAVAILABLE },
  };
}

/**
 * 把一次设置页请求转到 helper。连不上时读走磁盘、写返回 503。
 * @param input - 端口记录、路径与读写替身。
 * @returns HTTP 状态与 JSON 体。
 */
export async function relayPosture(
  input: PostureRelayInput,
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
    if (text.length > 65536) return { status: 502, body: { ok: false, message: '坐姿服务应答异常' } };
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { status: 502, body: { ok: false, message: '坐姿服务应答异常' } };
  }
  const body = parsed as Record<string, unknown>;
  if (response.status === 200) body.helper = true;
  return { status: response.status, body };
}

/** 用 `$DSH_HOME/dsh-pet` 下的三份 JSON 接上真实 helper。 */
export function createFilePostureBridge(home = dshHomeDir()): PostureRelayDeps {
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
      const configPath = join(root, 'posture-config.json');
      return loadPostureConfig(() => readFileSync(configPath, 'utf8'), configPath);
    },
    readStatus() {
      try {
        return JSON.parse(readFileSync(join(root, 'posture-status.json'), 'utf8')) as unknown;
      } catch {
        return null;
      }
    },
    fetchImpl: (url, init) => fetch(url, init),
  };
}

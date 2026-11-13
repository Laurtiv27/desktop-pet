/**
 * 从 helper 控制口读取屏幕摘要快照，供碎碎念与聊天注入。
 *
 * 独立模式里 helper 是另一个 Electron，快照不在宿主进程内。
 * 端口和令牌与坐姿控制口同一份 `posture-api.json`；GET `/screen-context/config` 同时带回 config 与 state。
 * 读不到就返回 null，调用方保持原 prompt。
 * @module dsh-pet/src/host/screen-context-inject
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parsePostureApiFile } from '../standalone/server/posture-bridge.ts';
import { POSTURE_API_FILE } from '../standalone/settings-page/posture-settings.ts';
import type { ScreenContextState, ScreenContextStatus } from '../shared/screen-context/types.ts';
import { dshHomeDir } from './helper-process.ts';

/** 注入所需的两样东西：摘要状态，以及过期计算用的间隔秒数。 */
export interface ScreenContextForInject {
  readonly state: ScreenContextState;
  readonly intervalSec: number;
}

/** 控制口读法，测试可以整份换掉。 */
export interface ScreenContextInjectDeps {
  readRecord(): { port: number; token: string } | null;
  fetchImpl(
    url: string,
    init: {
      method: string;
      headers: Record<string, string>;
      redirect: 'error';
      signal: AbortSignal;
    },
  ): Promise<{ status: number; text(): Promise<string> }>;
}

const STATUSES = new Set<ScreenContextStatus>(['ok', 'skipped', 'error', 'expired', 'idle']);

/** 控制口读超时：helper 不在时应尽快放弃，不能把碎碎念或聊天拖住。 */
const READ_TIMEOUT_MS = 1500;

/** 应答正文上限，与坐姿转发一致，避免把异常大包拼进提示词。 */
const MAX_BODY_CHARS = 65536;

/** 从 GET /screen-context/config 的 JSON 取出快照。形状不对返回 null。 */
export function parseScreenContextConfigBody(body: unknown): ScreenContextForInject | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const rec = body as Record<string, unknown>;
  if (rec.ok !== true) return null;
  const config = rec.config;
  const rawState = rec.state;
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) return null;
  const intervalSec = (config as { intervalSec?: unknown }).intervalSec;
  if (typeof intervalSec !== 'number' || !Number.isFinite(intervalSec) || intervalSec <= 0) return null;
  const st = rawState as Record<string, unknown>;
  const status = st.status;
  if (typeof status !== 'string' || !STATUSES.has(status as ScreenContextStatus)) return null;
  if (typeof st.text !== 'string') return null;
  if (typeof st.updatedAt !== 'number' || !Number.isFinite(st.updatedAt)) return null;
  const state: ScreenContextState = {
    status: status as ScreenContextStatus,
    text: st.text,
    updatedAt: st.updatedAt,
  };
  if (typeof st.errorMessage === 'string') state.errorMessage = st.errorMessage;
  return { state, intervalSec };
}

/** 用 `$DSH_HOME/dsh-pet/posture-api.json` 接上真实 helper。 */
function createFileScreenContextReader(home = dshHomeDir()): ScreenContextInjectDeps {
  const file = join(home, 'dsh-pet', POSTURE_API_FILE);
  return {
    readRecord() {
      try {
        return parsePostureApiFile(readFileSync(file, 'utf8'));
      } catch {
        return null;
      }
    },
    fetchImpl: (url, init) => fetch(url, init),
  };
}

/**
 * 读当前屏幕摘要快照。
 * @param deps - 缺省读本机 helper 控制口；测试传入替身。
 * @returns `{ state, intervalSec }`；控制口不可用或正文不合格时为 null。
 */
export async function getScreenContextForInject(
  deps?: ScreenContextInjectDeps,
): Promise<ScreenContextForInject | null> {
  try {
    const reader = deps ?? createFileScreenContextReader();
    const record = reader.readRecord();
    if (!record || !Number.isInteger(record.port) || record.port < 1 || record.port > 65535) return null;
    if (typeof record.token !== 'string' || record.token.length === 0) return null;
    const response = await reader.fetchImpl(`http://127.0.0.1:${record.port}/screen-context/config`, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      headers: { 'X-DSH-Posture-Token': record.token },
    });
    if (response.status !== 200) return null;
    const text = await response.text();
    if (text.length > MAX_BODY_CHARS) return null;
    return parseScreenContextConfigBody(JSON.parse(text));
  } catch {
    return null;
  }
}

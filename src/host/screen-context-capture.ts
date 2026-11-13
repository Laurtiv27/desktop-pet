/**
 * 向 helper 按需要一帧屏幕（碎碎念触发时）。
 *
 * 不跑视觉摘要；黑名单跳过或失败时返回 null，碎碎念仍可纯文本生成。
 * @module dsh-pet/src/host/screen-context-capture
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parsePostureApiFile } from '../standalone/server/posture-bridge.ts';
import { POSTURE_API_FILE } from '../standalone/settings-page/posture-settings.ts';
import { dshHomeDir } from './helper-process.ts';

/** 截屏结果：内存 JPEG base64。 */
export type ScreenCaptureShot = {
  mediaType: 'image/jpeg' | string;
  data: string;
};

export type ScreenCaptureDeps = {
  readRecord(): { port: number; token: string } | null;
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
};

const CAPTURE_TIMEOUT_MS = 8000;
/** 截屏 JSON 可比摘要大很多（含 base64）。 */
const MAX_BODY_CHARS = 12_000_000;

function createFileReader(home = dshHomeDir()): ScreenCaptureDeps {
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
 * 解析 capture 命令应答。形状不对或黑名单/失败 → null。
 */
export function parseScreenCaptureBody(body: unknown): ScreenCaptureShot | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const capture = (body as { capture?: unknown }).capture;
  if (!capture || typeof capture !== 'object' || Array.isArray(capture)) return null;
  const rec = capture as Record<string, unknown>;
  if (rec.ok !== true || rec.skipped === true) return null;
  if (typeof rec.data !== 'string' || !rec.data) return null;
  const mediaType = typeof rec.mediaType === 'string' && rec.mediaType ? rec.mediaType : 'image/jpeg';
  return { mediaType, data: rec.data };
}

/**
 * 向 helper 发 `op: capture`。未启用 / 黑名单 / 失败 → null。
 */
export async function captureScreenForWhisper(deps?: ScreenCaptureDeps): Promise<ScreenCaptureShot | null> {
  try {
    const reader = deps ?? createFileReader();
    const record = reader.readRecord();
    if (!record || !Number.isInteger(record.port) || record.port < 1 || record.port > 65535) return null;
    if (typeof record.token !== 'string' || record.token.length === 0) return null;
    const response = await reader.fetchImpl(`http://127.0.0.1:${record.port}/screen-context/command`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(CAPTURE_TIMEOUT_MS),
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'X-DSH-Posture-Token': record.token,
      },
      body: JSON.stringify({ op: 'capture' }),
    });
    if (response.status !== 200) return null;
    const text = await response.text();
    if (text.length > MAX_BODY_CHARS) return null;
    return parseScreenCaptureBody(JSON.parse(text));
  } catch {
    return null;
  }
}

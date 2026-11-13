/**
 * 屏幕感知设置的校验、文案，以及设置页到 helper 控制口的转发。
 *
 * 不启 Electron、不截屏。转发用注入的 fetch。
 * 跑法：node --experimental-strip-types --import ./scripts/test-register.mjs --test src/standalone/settings-page/screen-context-settings.test.ts
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { DEFAULT_SCREEN_CONTEXT_CONFIG } from '../../shared/screen-context/config.ts';
import { screenContextHandler } from '../server/handlers.ts';
import {
  normalizeScreenContextState,
  relayScreenContext,
  type ScreenContextRelayDeps,
} from '../server/screen-context-bridge.ts';
import { settingsScript } from '../settings-page.ts';
import { settingsPage } from './chrome.ts';
import { screenContextScript } from './script/screen-context.ts';
import {
  SCREEN_CONTEXT_COMMAND_PATH,
  SCREEN_CONTEXT_CONFIG_PATH,
  SCREEN_CONTEXT_CONTROL_UNAVAILABLE,
  SCREEN_CONTEXT_EMPTY_SUMMARY,
  SCREEN_CONTEXT_HELPER_OFFLINE,
  SCREEN_CONTEXT_INTERVAL_INVALID,
  SCREEN_CONTEXT_VISION_NOTE,
  blacklistLines,
  intervalSecFromMinutes,
  screenContextErrorCopy,
  screenContextStatusCopy,
  screenContextStatusIsError,
  screenContextSummaryCopy,
  validateScreenContextCommand,
  validateScreenContextPatch,
} from './screen-context-settings.ts';

const require = createRequire(import.meta.url);
const helperApi = require('../../../runtime/electron-helper/main/screen-context.js') as {
  validateScreenContextPatch: (input: unknown) => { ok: boolean; message?: string; patch?: unknown };
  validateScreenContextCommand: (input: unknown) => { ok: boolean; message?: string; command?: unknown };
};

const token = 'b'.repeat(43);

function deps(
  fetchImpl: ScreenContextRelayDeps['fetchImpl'],
  record: { port: number; token: string } | null = null,
): ScreenContextRelayDeps {
  return {
    readRecord: () => record,
    readConfig: () => ({ ...DEFAULT_SCREEN_CONTEXT_CONFIG, enabled: true, intervalSec: 120 }),
    readState: () => ({ text: '磁盘上的旧摘要', updatedAt: 50 }),
    fetchImpl,
  };
}

function miniRes(): { status: number; body: string; writeHead(status: number): void; end(payload: string): void; json(): Record<string, unknown> } {
  return {
    status: 0,
    body: '',
    writeHead(status) {
      this.status = status;
    },
    end(payload) {
      this.body = payload;
    },
    json() {
      return JSON.parse(this.body) as Record<string, unknown>;
    },
  };
}

function asReq(method: string, url: string, body?: unknown): IncomingMessage {
  const raw = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
  const stream = Readable.from([raw]);
  return Object.assign(stream, {
    method,
    url,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
  }) as unknown as IncomingMessage;
}

test('设置页路径、分钟换算和黑名单分行', () => {
  assert.equal(SCREEN_CONTEXT_CONFIG_PATH, '/dsh-pet-7340/screen-context/config');
  assert.equal(SCREEN_CONTEXT_COMMAND_PATH, '/dsh-pet-7340/screen-context/command');
  assert.deepEqual(intervalSecFromMinutes(5), { ok: true, intervalSec: 300 });
  assert.deepEqual(intervalSecFromMinutes(1.5), { ok: true, intervalSec: 90 });
  assert.deepEqual(intervalSecFromMinutes(0), { ok: false, message: SCREEN_CONTEXT_INTERVAL_INVALID });
  assert.deepEqual(intervalSecFromMinutes(-2), { ok: false, message: SCREEN_CONTEXT_INTERVAL_INVALID });
  assert.equal(intervalSecFromMinutes('5').ok, false);
  assert.deepEqual(blacklistLines(' 密码 \r\n\nKeePass\n'), ['密码', 'KeePass']);
  assert.deepEqual(blacklistLines(''), []);
});

test('校验与 helper 控制口一致', () => {
  const samples = [
    { intervalSec: 300 },
    { intervalSec: 0 },
    { intervalSec: -1 },
    { enabled: true },
    { enabled: 'yes' },
    { persistSummary: false },
    { blacklist: { titles: ['银行'], processes: ['KeePass'] } },
    { blacklist: { titles: '银行' } },
    { blacklist: {} },
    { blacklist: null },
    {},
    null,
    { extra: 1 },
  ];
  for (const sample of samples) {
    const ts = validateScreenContextPatch(sample);
    const js = helperApi.validateScreenContextPatch(sample);
    assert.equal(js.ok, ts.ok, JSON.stringify(sample));
    assert.equal(js.message, ts.ok ? undefined : ts.message);
    if (ts.ok) assert.deepEqual(js.patch, ts.patch);
  }
  const commands = [
    { op: 'enable' },
    { op: 'disable' },
    { op: 'patch', patch: { intervalSec: 60, enabled: false } },
    { op: 'patch', patch: { intervalSec: 0 } },
    { op: 'enable', patch: { enabled: true } },
    { op: 'nope' },
    null,
  ];
  for (const sample of commands) {
    const ts = validateScreenContextCommand(sample);
    const js = helperApi.validateScreenContextCommand(sample);
    assert.equal(js.ok, ts.ok, JSON.stringify(sample));
    assert.equal(js.message, ts.ok ? undefined : ts.message);
    if (ts.ok) assert.deepEqual(js.command, ts.command);
  }
});

test('只读文案给出摘要、状态和错误', () => {
  const ok = { helper: true, state: { status: 'ok', text: ' 在写代码 ', updatedAt: 1 } };
  assert.equal(screenContextSummaryCopy(ok), '在写代码');
  assert.equal(screenContextStatusCopy(ok), '正常');
  assert.equal(screenContextErrorCopy(ok), '');
  assert.equal(screenContextStatusIsError(ok), false);

  const failed = {
    helper: true,
    state: { status: 'error', text: '旧摘要', errorMessage: '模型不支持看图', lastError: '模型不支持看图' },
  };
  assert.equal(screenContextSummaryCopy(failed), '旧摘要');
  assert.equal(screenContextStatusCopy(failed), '出错');
  assert.equal(screenContextErrorCopy(failed), '模型不支持看图');
  assert.equal(screenContextStatusIsError(failed), true);

  const skipped = { helper: true, state: { status: 'skipped', text: '', skipNote: '本轮因黑名单跳过截屏' } };
  assert.equal(screenContextSummaryCopy(skipped), SCREEN_CONTEXT_EMPTY_SUMMARY);
  assert.equal(screenContextStatusCopy(skipped), '已跳过');
  assert.equal(screenContextErrorCopy(skipped), '本轮因黑名单跳过截屏');
  assert.equal(screenContextStatusIsError(skipped), false);

  const offline = { helper: false, state: { status: 'ok', text: '旧摘要' } };
  assert.equal(screenContextStatusCopy(offline), SCREEN_CONTEXT_HELPER_OFFLINE);
  assert.equal(screenContextStatusIsError(offline), true);
  assert.equal(screenContextSummaryCopy(offline), '旧摘要');
  assert.equal(screenContextStatusCopy({ helper: true, state: {} }), '未知');
});

test('磁盘状态缺 status 时，有摘要就算正常', () => {
  assert.deepEqual(normalizeScreenContextState({ text: '磁盘上的旧摘要', updatedAt: 50 }), {
    status: 'ok',
    text: '磁盘上的旧摘要',
    updatedAt: 50,
    errorMessage: '',
    lastError: '',
    skipNote: '',
  });
  assert.equal(normalizeScreenContextState(null).status, 'idle');
});

test('转发走坐姿控制口的端口和令牌，helper 不在时读磁盘、写失败', async () => {
  let called = false;
  const offline = deps(() => {
    called = true;
    throw new Error('不应发出');
  });
  const read = await relayScreenContext({
    ...offline,
    record: null,
    method: 'GET',
    upstreamPath: '/screen-context/config',
  });
  assert.equal(read.status, 200);
  assert.equal(read.body.helper, false);
  assert.equal((read.body.config as { intervalSec: number }).intervalSec, 120);
  assert.equal((read.body.state as { text: string }).text, '磁盘上的旧摘要');
  assert.equal((read.body.state as { status: string }).status, 'ok');
  const write = await relayScreenContext({
    ...offline,
    record: null,
    method: 'POST',
    upstreamPath: '/screen-context/command',
    body: { op: 'enable' },
  });
  assert.equal(write.status, 503);
  assert.equal(write.body.message, SCREEN_CONTEXT_CONTROL_UNAVAILABLE);
  assert.equal(called, false);

  const forwarded = await relayScreenContext({
    ...deps(async (url, init) => {
      assert.equal(url, 'http://127.0.0.1:43123/screen-context/command');
      assert.equal(init.headers['X-DSH-Posture-Token'], token);
      assert.equal(init.body, JSON.stringify({ op: 'patch', patch: { intervalSec: 300 } }));
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            ok: true,
            config: DEFAULT_SCREEN_CONTEXT_CONFIG,
            state: { status: 'idle', text: '', updatedAt: 0 },
          }),
      };
    }),
    record: { port: 43123, token },
    method: 'POST',
    upstreamPath: '/screen-context/command',
    body: { op: 'patch', patch: { intervalSec: 300 } },
  });
  assert.equal(forwarded.status, 200);
  assert.equal(forwarded.body.helper, true);
});

test('设置页处理器把非法间隔挡在转发之前', async () => {
  let called = false;
  const handler = screenContextHandler(
    deps(() => {
      called = true;
      throw new Error('不应发出');
    }),
  );
  const res = miniRes();
  await handler(asReq('POST', SCREEN_CONTEXT_CONFIG_PATH, { intervalSec: 0 }), res as unknown as ServerResponse);
  assert.equal(res.status, 400);
  assert.match(String(res.json().message), /大于 0 的秒数/);
  assert.equal(called, false);

  const read = miniRes();
  await handler(asReq('GET', SCREEN_CONTEXT_CONFIG_PATH), read as unknown as ServerResponse);
  assert.equal(read.status, 200);
  assert.equal(read.json().helper, false);
  assert.equal(called, false);
});

test('设置页有屏幕感知卡片，脚本提交黑名单且无间隔', () => {
  assert.match(settingsPage, /屏幕感知/);
  assert.match(settingsPage, /id="screen-context-enabled"/);
  assert.equal(settingsPage.includes('screen-context-interval'), false);
  assert.match(settingsPage, /碎碎念触发时/);
  assert.match(settingsPage, /标题黑名单/);
  assert.match(settingsPage, /进程黑名单/);
  assert.match(settingsPage, /id="screen-context-summary"/);
  assert.match(settingsPage, /id="screen-context-status"/);
  assert.match(settingsPage, /id="screen-context-error"/);
  assert.match(settingsPage, new RegExp(SCREEN_CONTEXT_VISION_NOTE));
  assert.equal(screenContextScript().includes('* 60'), false);
  assert.match(screenContextScript(), /screen-context\/config/);
  assert.match(screenContextScript(), /screen-context\/command/);
  assert.match(screenContextScript(), /blacklist/);
  assert.match(screenContextScript(), new RegExp(SCREEN_CONTEXT_HELPER_OFFLINE));
  assert.match(screenContextScript(), new RegExp(SCREEN_CONTEXT_EMPTY_SUMMARY));
  assert.match(settingsScript, /loadScreenContext\(\)/);
});

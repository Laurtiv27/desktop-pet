/**
 * 坐姿设置的校验、文案，以及设置页到 helper 控制口的转发。
 *
 * 不启 Electron、不开摄像头。控制口用假控制器打本机回环。
 * 跑法：node --experimental-strip-types --import ./scripts/test-register.mjs --test src/standalone/settings-page/posture-settings.test.ts
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { DEFAULT_POSTURE_CONFIG } from '../../shared/posture/config.ts';
import { postureHandler } from '../server/handlers.ts';
import { parsePostureApiFile, relayPosture, type PostureRelayDeps } from '../server/posture-bridge.ts';
import { settingsPage } from './chrome.ts';
import { postureScript } from './script/posture.ts';
import {
  POSTURE_API_FILE,
  POSTURE_API_NAME,
  POSTURE_COOLDOWN_CHOICES,
  POSTURE_COMMAND_PATH,
  POSTURE_CONFIG_PATH,
  POSTURE_CONTROL_UNAVAILABLE,
  POSTURE_HELPER_OFFLINE,
  postureCooldownLabel,
  postureStatusCopy,
  postureStatusIsError,
  validatePostureCommand,
  validatePosturePatch,
} from './posture-settings.ts';

const require = createRequire(import.meta.url);
const helperApi = require('../../../runtime/electron-helper/main/posture-api.js') as {
  POSTURE_API_FILE: string;
  POSTURE_API_NAME: string;
  POSTURE_CONTROL_UNAVAILABLE: string;
  createPostureApi: (deps: { controller: FakeController; apiPath: string; token?: string }) => {
    start: () => Promise<number>;
    stop: () => void;
    token: string;
    address: () => { port: number; token: string } | null;
  };
  callPostureEndpoint: (deps: {
    address: { port: number; token: string } | null;
    method: string;
    path: string;
    body?: unknown;
    fetchImpl?: (
      url: string,
      init: { method: string; headers: Record<string, string>; body?: string },
    ) => Promise<{
      text: () => Promise<string>;
    }>;
  }) => Promise<{ ok?: boolean; helper?: boolean; message?: string; config?: { paused?: boolean } }>;
  handlePostureRequest: (
    deps: { controller: FakeController; token: string },
    req: EventEmitter,
    res: MiniRes,
  ) => Promise<void>;
  validatePosturePatch: (input: unknown) => { ok: boolean; message?: string; patch?: unknown };
  validatePostureCommand: (input: unknown) => { ok: boolean; message?: string; command?: unknown };
  applyPostureOp: (controller: FakeController, command: { op: string; patch?: unknown }) => void;
};

interface FakeController {
  calls: unknown[];
  setEnabled(value: boolean): void;
  setPaused(value: boolean): void;
  recalibrate(): void;
  updateConfig(patch: unknown): void;
  getConfig(): typeof DEFAULT_POSTURE_CONFIG;
  getRuntime(): { status: string; error: string; running: boolean; enabled: boolean; paused: boolean };
}

interface MiniRes {
  status: number;
  body: string;
  writableEnded: boolean;
  writeHead(status: number): void;
  end(payload: string): void;
  json(): Record<string, unknown>;
}

function fakeController(): FakeController {
  const calls: unknown[] = [];
  return {
    calls,
    setEnabled(value) {
      calls.push(['setEnabled', value]);
    },
    setPaused(value) {
      calls.push(['setPaused', value]);
    },
    recalibrate() {
      calls.push(['recalibrate']);
    },
    updateConfig(patch) {
      calls.push(['updateConfig', patch]);
    },
    getConfig: () => ({ ...DEFAULT_POSTURE_CONFIG }),
    getRuntime: () => ({ status: '未启用', error: '', running: false, enabled: false, paused: false }),
  };
}

function miniRes(): MiniRes {
  const res: MiniRes = {
    status: 0,
    body: '',
    writableEnded: false,
    writeHead(status) {
      this.status = status;
    },
    end(payload) {
      this.body = payload;
      this.writableEnded = true;
    },
    json() {
      return JSON.parse(this.body) as Record<string, unknown>;
    },
  };
  return res;
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

const token = 'a'.repeat(43);

function deps(
  fetchImpl: PostureRelayDeps['fetchImpl'],
  record: { port: number; token: string } | null = null,
): PostureRelayDeps {
  return {
    readRecord: () => record,
    readConfig: () => ({ ...DEFAULT_POSTURE_CONFIG, enabled: true, cooldown: 30 }),
    readStatus: () => ({ status: '坐姿前倾', error: '摄像头被占用', running: false, enabled: true, paused: false }),
    fetchImpl,
  };
}

test('冷却只有三档，文案带秒，设置页无系统通知', () => {
  assert.deepEqual(POSTURE_COOLDOWN_CHOICES, [5, 10, 30]);
  assert.equal(postureCooldownLabel(10), '10 秒');
  assert.equal(POSTURE_CONFIG_PATH, '/dsh-pet-7340/posture/config');
  assert.equal(POSTURE_COMMAND_PATH, '/dsh-pet-7340/posture/command');
  assert.match(settingsPage, /坐姿守护/);
  assert.match(settingsPage, /重新校准/);
  assert.match(settingsPage, /严格/);
  assert.match(settingsPage, /5 秒/);
  assert.match(settingsPage, /30 秒/);
  assert.doesNotMatch(settingsPage, /系统通知/);
  assert.match(postureScript(), /recalibrate/);
  assert.match(postureScript(), new RegExp(POSTURE_HELPER_OFFLINE));
});

test('校验拒绝冷却和灵敏度之外的值，并与 helper 副本一致', () => {
  const samples = [
    { cooldown: 30 },
    { cooldown: 5 },
    { cooldown: 45 },
    { sensitivity: 'loose' },
    { sensitivity: 'high' },
    { beep: true },
    { beep: 'yes' },
    { toast: true },
    {},
    null,
    { enabled: false, extra: 1 },
  ];
  for (const sample of samples) {
    const ts = validatePosturePatch(sample);
    const js = helperApi.validatePosturePatch(sample);
    assert.equal(js.ok, ts.ok, JSON.stringify(sample));
    assert.equal(js.message, ts.ok ? undefined : ts.message);
    if (ts.ok) assert.deepEqual(js.patch, ts.patch);
  }
  const commands = [
    { op: 'enable' },
    { op: 'pause' },
    { op: 'recalibrate' },
    { op: 'patch', patch: { cooldown: 5, sensitivity: 'strict' } },
    { op: 'patch', patch: { cooldown: 10 } },
    { op: 'patch', patch: { cooldown: 300 } },
    { op: 'enable', patch: { beep: true } },
    { op: 'nope' },
    null,
  ];
  for (const sample of commands) {
    const ts = validatePostureCommand(sample);
    const js = helperApi.validatePostureCommand(sample);
    assert.equal(js.ok, ts.ok, JSON.stringify(sample));
    assert.equal(js.message, ts.ok ? undefined : ts.message);
    if (ts.ok) assert.deepEqual(js.command, ts.command);
  }
  assert.equal(helperApi.POSTURE_API_FILE, POSTURE_API_FILE);
  assert.equal(helperApi.POSTURE_API_NAME, POSTURE_API_NAME);
});

test('状态行显示检测状态和错误，helper 不在时不冒充正在检测', () => {
  assert.equal(postureStatusCopy({ helper: true, runtime: { status: '坐姿前倾', error: '' } }), '坐姿前倾');
  assert.equal(
    postureStatusCopy({ helper: true, runtime: { status: '坐姿前倾', error: '摄像头被占用' } }),
    '坐姿前倾（摄像头被占用）',
  );
  assert.equal(postureStatusIsError({ helper: true, runtime: { status: '坐姿前倾', error: '摄像头被占用' } }), true);
  assert.equal(
    postureStatusCopy({ helper: false, runtime: { status: '坐姿前倾', error: '' } }),
    POSTURE_HELPER_OFFLINE,
  );
  assert.equal(postureStatusIsError({ helper: false, runtime: { status: '监控中', error: '' } }), true);
  assert.equal(postureStatusCopy({ helper: true, runtime: {} }), '未知');
});

test('端口文件只接受回环端口和定长令牌', () => {
  assert.deepEqual(parsePostureApiFile(JSON.stringify({ name: POSTURE_API_NAME, port: 43123, token })), {
    port: 43123,
    token,
  });
  assert.equal(parsePostureApiFile(JSON.stringify({ name: 'other', port: 1, token })), null);
  assert.equal(parsePostureApiFile(JSON.stringify({ name: POSTURE_API_NAME, port: 0, token })), null);
  assert.equal(parsePostureApiFile(JSON.stringify({ name: POSTURE_API_NAME, port: 43123, token: 'short' })), null);
  assert.equal(parsePostureApiFile('{'), null);
});

test('helper 不在时读磁盘、写操作失败，且不会去连别的主机', async () => {
  let called = false;
  const offline = deps(() => {
    called = true;
    throw new Error('不应发出');
  });
  const read = await relayPosture({ ...offline, record: null, method: 'GET', upstreamPath: '/posture/config' });
  assert.equal(read.status, 200);
  assert.equal(read.body.helper, false);
  assert.equal((read.body.config as { cooldown: number }).cooldown, 30);
  assert.equal((read.body.runtime as { error: string }).error, '摄像头被占用');
  const write = await relayPosture({
    ...offline,
    record: null,
    method: 'POST',
    upstreamPath: '/posture/command',
    body: { op: 'enable' },
  });
  assert.equal(write.status, 503);
  assert.equal(write.body.message, POSTURE_CONTROL_UNAVAILABLE);
  assert.equal(called, false);

  const forwarded = await relayPosture({
    ...deps(async (url, init) => {
      assert.equal(url, 'http://127.0.0.1:43123/posture/command');
      assert.equal(init.headers['X-DSH-Posture-Token'], token);
      assert.equal(init.body, JSON.stringify({ op: 'enable' }));
      return {
        status: 200,
        text: async () =>
          JSON.stringify({ ok: true, config: DEFAULT_POSTURE_CONFIG, runtime: { status: '监控中', error: '' } }),
      };
    }),
    record: { port: 43123, token },
    method: 'POST',
    upstreamPath: '/posture/command',
    body: { op: 'enable' },
  });
  assert.equal(forwarded.status, 200);
  assert.equal(forwarded.body.helper, true);
  assert.equal((forwarded.body.runtime as { status: string }).status, '监控中');
});

test('设置页处理器把非法冷却挡在转发之前', async () => {
  let called = false;
  const handler = postureHandler(
    deps(() => {
      called = true;
      throw new Error('不应发出');
    }),
  );
  const res = miniRes();
  await handler(asReq('POST', POSTURE_CONFIG_PATH, { cooldown: 45 }), res as unknown as ServerResponse);
  assert.equal(res.status, 400);
  assert.match(String(res.json().message), /5、10 或 30/);
  assert.equal(called, false);

  const read = miniRes();
  await handler(asReq('GET', POSTURE_CONFIG_PATH), read as unknown as ServerResponse);
  assert.equal(read.status, 200);
  assert.equal(read.json().helper, false);
  assert.equal(called, false);
});

test('命令会打到控制器上对应的方法', () => {
  const controller = fakeController();
  helperApi.applyPostureOp(controller, { op: 'enable' });
  helperApi.applyPostureOp(controller, { op: 'disable' });
  helperApi.applyPostureOp(controller, { op: 'pause' });
  helperApi.applyPostureOp(controller, { op: 'resume' });
  helperApi.applyPostureOp(controller, { op: 'recalibrate' });
  helperApi.applyPostureOp(controller, { op: 'patch', patch: { cooldown: 10, beep: false } });
  assert.deepEqual(controller.calls, [
    ['setEnabled', true],
    ['setEnabled', false],
    ['setPaused', true],
    ['setPaused', false],
    ['recalibrate'],
    ['updateConfig', { cooldown: 10, beep: false }],
  ]);
});

test('控制口拒绝坏令牌，接受 enable 并写下端口文件', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'posture-api-'));
  const controller = fakeController();
  const api = helperApi.createPostureApi({ controller, apiPath: join(dir, POSTURE_API_FILE) });
  try {
    const port = await api.start();
    const record = parsePostureApiFile(readFileSync(join(dir, POSTURE_API_FILE), 'utf8'));
    assert.equal(record?.port, port);
    const denied = await fetch(`http://127.0.0.1:${port}/posture/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dsh-posture-token': 'nope' },
      body: JSON.stringify({ op: 'enable' }),
    });
    assert.equal(denied.status, 403);
    assert.deepEqual(controller.calls, []);
    const accepted = await fetch(`http://127.0.0.1:${port}/posture/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dsh-posture-token': api.token },
      body: JSON.stringify({ op: 'enable' }),
    });
    assert.equal(accepted.status, 200);
    const payload = (await accepted.json()) as { ok: boolean; helper: boolean; config: { enabled: boolean } };
    assert.equal(payload.ok, true);
    assert.equal(payload.helper, true);
    assert.equal(payload.config.enabled, false);
    assert.deepEqual(controller.calls, [['setEnabled', true]]);
    const bad = await fetch(`http://127.0.0.1:${port}/posture/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dsh-posture-token': api.token },
      body: JSON.stringify({ cooldown: 15 }),
    });
    assert.equal(bad.status, 400);
    assert.deepEqual(controller.calls, [['setEnabled', true]]);
  } finally {
    api.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('直接调用控制口处理函数时，非回环地址进不来', async () => {
  const controller = fakeController();
  const req = new EventEmitter();
  Object.assign(req, {
    method: 'GET',
    url: '/posture/config',
    headers: { 'x-dsh-posture-token': token },
    socket: { remoteAddress: '10.1.1.1' },
  });
  const res = miniRes();
  await helperApi.handlePostureRequest({ controller, token }, req, res);
  assert.equal(res.status, 403);
  assert.deepEqual(controller.calls, []);
});

test('菜单转发只打控制口 /posture/command，不直接调控制器', async () => {
  const seen: Array<{ url: string; method: string; token: string; body?: string }> = [];
  const result = await helperApi.callPostureEndpoint({
    address: { port: 9, token },
    method: 'POST',
    path: '/posture/command',
    body: { op: 'enable' },
    fetchImpl: (url, init) => {
      seen.push({ url, method: init.method, token: init.headers['x-dsh-posture-token'], body: init.body });
      return Promise.resolve({ text: () => Promise.resolve(JSON.stringify({ ok: true, config: { enabled: true } })) });
    },
  });
  assert.deepEqual(seen, [
    {
      url: 'http://127.0.0.1:9/posture/command',
      method: 'POST',
      token,
      body: JSON.stringify({ op: 'enable' }),
    },
  ]);
  assert.equal(result.ok, true);
  const offline = await helperApi.callPostureEndpoint({
    address: null,
    method: 'POST',
    path: '/posture/command',
    body: { op: 'pause' },
  });
  assert.equal(offline.ok, false);
  assert.equal(offline.message, POSTURE_CONTROL_UNAVAILABLE);
  assert.equal(helperApi.POSTURE_CONTROL_UNAVAILABLE, POSTURE_CONTROL_UNAVAILABLE);
});

test('菜单经控制口发出的 pause 会落到 setPaused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'posture-menu-'));
  const controller = fakeController();
  const api = helperApi.createPostureApi({ controller, apiPath: join(dir, POSTURE_API_FILE), token });
  try {
    await api.start();
    const paused = await helperApi.callPostureEndpoint({
      address: api.address(),
      method: 'POST',
      path: '/posture/command',
      body: { op: 'pause' },
    });
    assert.equal(paused.ok, true);
    assert.deepEqual(controller.calls, [['setPaused', true]]);
    controller.calls.length = 0;
    const again = await helperApi.callPostureEndpoint({
      address: api.address(),
      method: 'POST',
      path: '/posture/command',
      body: { op: 'recalibrate' },
    });
    assert.equal(again.ok, true);
    assert.deepEqual(controller.calls, [['recalibrate']]);
  } finally {
    api.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('右键菜单的坐姿项走 petBridge，再由主进程 POST /posture/command', () => {
  const root = fileURLToPath(new URL('../../../runtime/electron-helper/', import.meta.url));
  const menu = readFileSync(join(root, 'sprite/menu.js'), 'utf8');
  const ipc = readFileSync(join(root, 'main/ipc.js'), 'utf8');
  const preload = readFileSync(join(root, 'preload.js'), 'utf8');
  const actionAt = menu.indexOf("leaf.action === 'posture-command'");
  const sleepAt = menu.indexOf('isSleepAllowedAction');
  assert.ok(actionAt > 0 && sleepAt > actionAt, '坐姿项要在睡觉闸门之前放行');
  assert.match(menu, /label: '坐姿守护'/);
  assert.match(menu, /启用/);
  assert.match(menu, /关闭/);
  assert.match(menu, /暂停/);
  assert.match(menu, /继续/);
  assert.match(menu, /重新校准/);
  assert.match(menu, /postureCommand\(\{ op \}\)/);
  assert.doesNotMatch(menu, /setEnabled|setPaused|\.recalibrate\(/);
  assert.match(preload, /invoke\('pet:posture-command'/);
  assert.match(ipc, /path: '\/posture\/command'/);
  assert.match(ipc, /callPostureEndpoint/);
  assert.doesNotMatch(ipc, /setEnabled|setPaused|applyPostureOp|\.recalibrate\(/);
});

test('右键打开菜单前会等待坐姿配置刷新再建树', () => {
  const root = fileURLToPath(new URL('../../../runtime/electron-helper/', import.meta.url));
  const menu = readFileSync(join(root, 'sprite/menu.js'), 'utf8');
  const onCtxStart = menu.indexOf('async onContextMenu(e)');
  const awaitRefresh = menu.indexOf('await this.refreshPostureConfig()');
  const branchCall = menu.indexOf('tools.push(this.postureMenuBranch())');
  assert.ok(onCtxStart >= 0, 'onContextMenu 应为 async');
  assert.ok(awaitRefresh > onCtxStart && branchCall > awaitRefresh, '应先 await 刷新再 postureMenuBranch');
  assert.match(menu, /refreshPostureConfig\(\)\s*\{[\s\S]*return window\.petBridge/);
});

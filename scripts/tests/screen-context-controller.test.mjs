/**
 * 屏幕感知按需截屏：黑名单跳过、截屏成功、忙则拒绝；控制口复用坐姿端口。
 * 跑法：node --test scripts/tests/screen-context-controller.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  SCREEN_CONTEXT_SKIP_NOTE,
  createScreenContextController,
  createScreenContextStore,
  createScreenSummarizer,
} = require('../../runtime/electron-helper/main/screen-context.js');
const { captureScreenJpeg } = require('../../runtime/electron-helper/main/capture-screen.js');
const { createPostureApi } = require('../../runtime/electron-helper/main/posture-api.js');

const NOW = 1_700_000_000_000;

function harness(overrides = {}) {
  const calls = { capture: 0, list: 0 };
  const world = { windows: [{ title: '记事本', processName: 'notepad' }] };
  const saved = [];
  const store = createScreenContextStore({ persistSummary: false });
  const controller = createScreenContextController({
    captureScreen: async () => {
      calls.capture += 1;
      return { mediaType: 'image/jpeg', data: 'jpeg-bytes' };
    },
    listWindows: async () => {
      calls.list += 1;
      return world.windows;
    },
    loadConfig: () => ({
      enabled: true,
      intervalSec: 300,
      persistSummary: false,
      blacklist: { titles: ['密码'], processes: ['KeePass'] },
    }),
    saveConfig: (cfg) => {
      saved.push(cfg);
    },
    now: () => NOW,
    log: () => {},
    store,
    ...overrides,
  });
  controller.startFromConfig();
  return { controller, store, calls, world, saved };
}

test('黑名单命中则跳过截屏，并保留旧提示', async () => {
  const { store, calls, world, controller } = harness();
  store.setOk('旧提示', 10);
  world.windows = [{ title: '请输入密码', processName: 'chrome' }];
  const shot = await controller.captureForWhisper();
  assert.equal(calls.capture, 0);
  assert.equal(calls.list, 1);
  assert.equal(shot.ok, true);
  assert.equal(shot.skipped, true);
  const snap = store.get();
  assert.equal(snap.status, 'skipped');
  assert.equal(snap.text, '旧提示');
  assert.equal(snap.skipNote, SCREEN_CONTEXT_SKIP_NOTE);
});

test('截屏成功返回 JPEG，并写入看屏提示', async () => {
  const { store, calls, controller } = harness();
  const shot = await controller.captureForWhisper();
  assert.equal(calls.capture, 1);
  assert.equal(shot.ok, true);
  assert.equal(shot.skipped, false);
  assert.equal(shot.mediaType, 'image/jpeg');
  assert.equal(shot.data, 'jpeg-bytes');
  assert.equal(store.get().status, 'ok');
  assert.match(store.get().text, /碎碎念/);
  assert.equal(store.get().updatedAt, NOW);
  assert.equal(controller.getState().busy, false);
});

test('上一轮未完成时拒绝新截屏', async () => {
  let release;
  let captures = 0;
  let hold = true;
  const { store, controller } = harness({
    captureScreen: () => {
      captures += 1;
      if (!hold) return Promise.resolve({ mediaType: 'image/jpeg', data: 'frame' });
      return new Promise((resolve) => {
        release = () => resolve({ mediaType: 'image/jpeg', data: 'frame' });
      });
    },
  });
  store.setOk('保持', 1);
  const first = controller.captureForWhisper();
  const second = await controller.captureForWhisper();
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'busy');
  assert.equal(captures, 1);
  assert.equal(controller.getState().busy, true);
  hold = false;
  release();
  const done = await first;
  assert.equal(done.ok, true);
  assert.equal(done.data, 'frame');
  assert.equal(controller.getState().busy, false);
});

test('屏幕感知路由挂在坐姿控制口上，capture 带回图', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'screen-context-api-'));
  const token = 'screen-context-token-32b';
  const { controller, saved } = harness({
    loadConfig: () => ({
      enabled: false,
      intervalSec: 300,
      persistSummary: false,
      blacklist: { titles: ['密码'], processes: [] },
    }),
  });
  const api = createPostureApi({
    controller: {
      getConfig: () => ({ enabled: false }),
      getRuntime: () => ({ posture: true }),
    },
    screenContext: controller,
    apiPath: join(dir, 'posture-api.json'),
    token,
    log: () => {},
  });
  try {
    const port = await api.start();
    const headers = { 'x-dsh-posture-token': token };
    const enabled = await fetch(`http://127.0.0.1:${port}/screen-context/command`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'enable' }),
    });
    assert.equal(enabled.status, 200);
    assert.equal((await enabled.json()).config.enabled, true);
    assert.equal(saved.at(-1).enabled, true);

    const captured = await fetch(`http://127.0.0.1:${port}/screen-context/command`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'capture' }),
    });
    assert.equal(captured.status, 200);
    const body = await captured.json();
    assert.equal(body.ok, true);
    assert.equal(body.capture.ok, true);
    assert.equal(body.capture.data, 'jpeg-bytes');
  } finally {
    api.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('captureScreenJpeg 选中对应屏幕并编码 JPEG', async () => {
  const seen = [];
  const display = { id: 2, scaleFactor: 2, size: { width: 800, height: 600 } };
  const shot = await captureScreenJpeg(display, {
    async getSources(opts) {
      seen.push(opts);
      return [
        { display_id: '1', thumbnail: { isEmpty: () => false } },
        {
          display_id: '2',
          thumbnail: {
            isEmpty: () => false,
            getSize: () => ({ width: 1600, height: 1200 }),
            toJPEG: (quality) => Buffer.from('q' + quality),
          },
        },
      ];
    },
  });
  assert.deepEqual(seen[0].thumbnailSize, { width: 1600, height: 1200 });
  assert.equal(shot.mediaType, 'image/jpeg');
  assert.equal(Buffer.from(shot.data, 'base64').toString(), 'q85');
});

test('旧摘要回调仍可单测（helper 主路径已不再调用）', async () => {
  const jpeg = Buffer.from('jpeg-bytes').toString('base64');
  const summarizeScreen = createScreenSummarizer({
    petRoute: '/dsh-pet-7340',
    hostRequest: async (method, url, body) => {
      assert.equal(method, 'POST');
      assert.equal(url, '/dsh-pet-7340/screen-context/summarize');
      assert.deepEqual(JSON.parse(body), { mediaType: 'image/jpeg', data: jpeg });
      return { status: 200, body: JSON.stringify({ ok: true, text: '正在看代码' }) };
    },
  });
  assert.deepEqual(await summarizeScreen({ mediaType: 'image/jpeg', data: jpeg }), {
    ok: true,
    text: '正在看代码',
  });
});

/**
 * createPostureController 的假窗口测试。不启 Electron、不开摄像头。
 *
 * 注入假 BrowserWindow / ipcMain / petClient，配置与状态落在临时目录。
 * 在离计时注入 now（秒），避免真等 10 秒。
 * 跑法：node --test scripts/tests/posture-window.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const {
  createPostureController,
  createPostureConfigStore,
  createPetRouteClient,
} = require('../../runtime/electron-helper/main/posture-window.js');

const indexHtml = fileURLToPath(new URL('../../runtime/electron-helper/posture/index.html', import.meta.url));
const animMapPath = fileURLToPath(new URL('../../src/shared/posture/anim-map.json', import.meta.url));
const dirs = [];

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createFakeBrowserWindow() {
  function BrowserWindow(options) {
    const wcListeners = new Map();
    this.options = options;
    this.loadFileCalls = [];
    this.destroyCount = 0;
    this.destroyed = false;
    this.webContents = {
      sent: [],
      setBackgroundThrottling() {},
      send(channel, payload) {
        this.sent.push({ channel, payload });
      },
      on(name, fn) {
        const list = wcListeners.get(name) ?? [];
        list.push(fn);
        wcListeners.set(name, list);
      },
      emit(name, ...args) {
        for (const fn of wcListeners.get(name) ?? []) fn(...args);
      },
    };
    this.loadFile = (file) => {
      this.loadFileCalls.push(file);
      return Promise.resolve();
    };
    this.on = () => {};
    this.isDestroyed = () => this.destroyed;
    this.destroy = () => {
      this.destroyed = true;
      this.destroyCount += 1;
    };
    BrowserWindow.instances.push(this);
  }
  BrowserWindow.instances = [];
  return BrowserWindow;
}

function createFakeIpc() {
  const handlers = new Map();
  return {
    on(channel, fn) {
      const list = handlers.get(channel) ?? [];
      list.push(fn);
      handlers.set(channel, list);
    },
    emit(channel, event, payload) {
      for (const fn of handlers.get(channel) ?? []) fn(event, payload);
    },
  };
}

function harness(partial, extras = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-posture-'));
  dirs.push(dir);
  const face = join(dir, 'face.task');
  const pose = join(dir, 'pose.task');
  writeFileSync(face, '');
  writeFileSync(pose, '');
  const store = createPostureConfigStore({ configPath: join(dir, 'posture-config.json') });
  store.save(partial);
  const BrowserWindow = createFakeBrowserWindow();
  const ipcMain = createFakeIpc();
  const calls = [];
  const toasts = [];
  const beeps = [];
  const notes = [];
  class Notification {
    constructor(opts) {
      this.opts = opts;
      this.shown = false;
      notes.push(this);
    }
    show() {
      this.shown = true;
    }
  }
  const petClient = {
    async request(method, rest, query, body) {
      calls.push({ method, rest, query, body });
      if (rest === 'config') {
        return { ok: true, json: { main: { pets: [{ id: 'main', display: 'desktop' }] } } };
      }
      if (rest === 'lock') return { ok: true, json: { ok: true, lockId: 'lock-1' } };
      return { ok: true, json: { ok: true } };
    },
  };
  const ctrl = createPostureController({
    BrowserWindow,
    ipcMain,
    pathToPreload: join(dir, 'preload.js'),
    pathToIndex: indexHtml,
    modelPaths: { face, pose, wasm: join(dir, 'wasm'), vision: join(dir, 'vision_bundle.js') },
    animMapPath,
    loadConfig: () => store.load(),
    saveConfig: (cfg) => store.save(cfg),
    statusPath: join(dir, 'posture-status.json'),
    petClient,
    notifyToast(title, body) {
      const note = new Notification({
        title: title ? String(title) : '坐姿提醒',
        body: body ? String(body) : '',
        silent: true,
      });
      note.show();
      toasts.push({ title, body });
    },
    beep() {
      beeps.push(1);
    },
    log() {},
    now: extras.now,
  });
  return {
    ctrl,
    BrowserWindow,
    ipcMain,
    calls,
    toasts,
    beeps,
    notes,
    face,
    pose,
    win() {
      return BrowserWindow.instances.at(-1);
    },
    event() {
      return { sender: this.win().webContents };
    },
    finishLoad() {
      this.win().webContents.emit('did-finish-load');
    },
  };
}

test('enabled 为真创建 640×480 隐藏窗并 loadFile，为假则 destroy', () => {
  const off = harness({ enabled: false });
  off.ctrl.startFromConfig();
  assert.equal(off.BrowserWindow.instances.length, 0);

  const h = harness({ enabled: true });
  h.ctrl.startFromConfig();
  const win = h.win();
  assert.equal(win.options.show, false);
  assert.equal(win.options.width, 640);
  assert.equal(win.options.height, 480);
  assert.match(win.loadFileCalls[0], /posture[\\/]index\.html$/);
  assert.equal(win.isDestroyed(), false);

  h.ctrl.setEnabled(false);
  assert.equal(win.isDestroyed(), true);
  assert.equal(win.destroyCount, 1);
});

test('did-finish-load 的 init 带模型与阈值，不含 allowMock', () => {
  const h = harness({ enabled: true });
  h.ctrl.startFromConfig();
  h.finishLoad();
  const init = h.win().webContents.sent.find((item) => item.channel === 'posture:init');
  assert.ok(init);
  const payload = init.payload;
  assert.equal(payload.faceModelPath, pathToFileURL(h.face).href);
  assert.equal(payload.poseModelPath, pathToFileURL(h.pose).href);
  assert.equal(typeof payload.thresholds, 'object');
  assert.equal(payload.thresholds.POSTURE_HOLD_SEC, 8);
  assert.equal('allowMock' in payload, false);
});

test('petPerform 为真时演出顺序是 lock → broadcast → anim', async () => {
  const h = harness({ enabled: true, petPerform: true });
  h.ctrl.startFromConfig();
  h.finishLoad();
  h.ipcMain.emit('posture:event', h.event(), { type: 'slouch', message: '坐直一点' });
  await settle();
  const perform = h.calls.filter((call) => ['lock', 'broadcast', 'anim', 'lock/release'].includes(call.rest));
  assert.deepEqual(
    perform.map((call) => call.rest),
    ['lock', 'broadcast', 'anim', 'lock/release'],
  );
  assert.equal(perform[2].body.name.length > 0, true);
  assert.equal(h.toasts.length, 0);
});

test('petPerform 为假时不点播，并尝试 toast', async () => {
  const h = harness({ enabled: true, petPerform: false, toast: true, beep: true });
  h.ctrl.startFromConfig();
  h.finishLoad();
  h.ipcMain.emit('posture:event', h.event(), { type: 'slouch', message: '坐直一点' });
  await settle();
  assert.equal(
    h.calls.some((call) => call.rest === 'anim'),
    false,
  );
  assert.equal(h.notes.length, 1);
  assert.equal(h.notes[0].shown, true);
  assert.equal(h.notes[0].opts.title, '坐姿提醒');
  assert.equal(h.toasts[0].body, '坐直一点');
  assert.equal(h.beeps.length, 1);
});

test('离开满 10 秒睡、回来醒；petPerform 为假时两者都不发', async () => {
  let t = 1000;
  const h = harness({ enabled: true, petPerform: true }, { now: () => t });
  h.ctrl.startFromConfig();
  h.ipcMain.emit('posture:face', h.event(), false);
  await settle();
  assert.equal(
    h.calls.some((call) => call.rest === 'sleep'),
    false,
  );

  t = 1010;
  h.ipcMain.emit('posture:face', h.event(), false);
  await settle();
  assert.equal(h.calls.filter((call) => call.rest === 'sleep').length, 1);

  t = 1011;
  h.ipcMain.emit('posture:face', h.event(), true);
  await settle();
  assert.equal(h.calls.filter((call) => call.rest === 'wake').length, 1);

  let off = 0;
  const quiet = harness({ enabled: true, petPerform: false }, { now: () => off });
  quiet.ctrl.startFromConfig();
  off = 30;
  quiet.ipcMain.emit('posture:face', quiet.event(), false);
  await settle();
  off = 31;
  quiet.ipcMain.emit('posture:face', quiet.event(), true);
  await settle();
  assert.equal(
    quiet.calls.some((call) => call.rest === 'sleep' || call.rest === 'wake'),
    false,
  );
});

test('PetRouteClient 把 HTTP 200 且 ok:false 折成失败', async () => {
  const seen = [];
  const client = createPetRouteClient({
    petRoute: '/dsh-pet',
    async hostRequest(method, url, body) {
      seen.push({ method, url, body });
      if (url.includes('/anim')) return { status: 200, body: JSON.stringify({ ok: false }) };
      return { status: 200, body: JSON.stringify({ ok: true, lockId: 'lock-1' }) };
    },
  });
  const failed = await client.request('POST', 'anim', { pet: 'main' }, { name: '被吓一跳' });
  assert.equal(failed.ok, false);
  assert.equal(failed.json.ok, false);
  assert.equal(seen[0].url, '/dsh-pet/anim?pet=main');
  const passed = await client.request('POST', 'lock', { pet: 'main' }, { ttl: 8000 });
  assert.equal(passed.ok, true);
});

test('打包路径指向 posture/vendor，不再指向 node_modules 或 src 动画表', () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const main = readFileSync(join(root, 'runtime', 'electron-helper', 'main.js'), 'utf8');
  const html = readFileSync(indexHtml, 'utf8');
  const detector = readFileSync(join(root, 'runtime', 'electron-helper', 'posture', 'detector.js'), 'utf8');
  assert.match(main, /postureVendor/);
  assert.match(main, /vision_bundle\.js/);
  assert.match(main, /anim-map\.json/);
  assert.doesNotMatch(main, /node_modules/);
  assert.doesNotMatch(main, /shared['"]\s*,\s*['"]posture['"]\s*,\s*['"]anim-map\.json/);
  assert.match(html, /vendor\/vision_bundle\.js/);
  assert.doesNotMatch(html, /node_modules/);
  assert.match(detector, /vendor\/wasm/);
  assert.doesNotMatch(detector, /node_modules\/@mediapipe/);
  for (const rel of [
    'runtime/electron-helper/posture/vendor/vision_bundle.js',
    'runtime/electron-helper/posture/vendor/anim-map.json',
    'runtime/electron-helper/posture/vendor/wasm/vision_wasm_internal.js',
    'runtime/electron-helper/posture/vendor/wasm/vision_wasm_internal.wasm',
    'runtime/electron-helper/posture/vendor/wasm/vision_wasm_module_internal.js',
    'runtime/electron-helper/posture/vendor/wasm/vision_wasm_module_internal.wasm',
  ]) {
    assert.equal(statSync(join(root, rel)).size > 0, true, rel);
  }
});

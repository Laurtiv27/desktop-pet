/**
 * 骨骼宠 BehaviorRunner：validate+plan+canInterrupt 后执行 steps；
 * arrive 走 startSpeedMoveDrive；clip-end / duration 由 runner 定时器收尾（stub 无 video ended）。
 * 漫游仅 spine；webm 空闲链保持 rollKind。
 * 跑法：node --test scripts/tests/behavior-runner.test.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const sharedPath = join(root, 'runtime/electron-helper/shared-core.js');
const motionPath = join(root, 'runtime/electron-helper/sprite/motion.js');
const runnerPath = join(root, 'runtime/electron-helper/sprite/behavior-runner.js');
const playbackPath = join(root, 'runtime/electron-helper/sprite/playback.js');
const inputPath = join(root, 'runtime/electron-helper/sprite/input.js');
const menuPath = join(root, 'runtime/electron-helper/sprite/menu.js');
const indexHtmlPath = join(root, 'runtime/electron-helper/index.html');
const prepackPath = join(root, 'scripts/prepack-check.js');

function loadShared() {
  const sandbox = { console, window: {} };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(sharedPath, 'utf8'), sandbox, { filename: sharedPath });
  return sandbox.PetShared;
}

function loadHarness(opts = {}) {
  const S = loadShared();
  class Sprite {}
  let now = 0;
  let raf = null;
  const timers = [];
  let nextTimerId = 1;
  const setTimeoutFn = (fn, ms) => {
    const id = nextTimerId++;
    timers.push({ id, fn, at: now + (Number(ms) || 0) });
    return id;
  };
  const clearTimeoutFn = (id) => {
    const i = timers.findIndex((t) => t.id === id);
    if (i >= 0) timers.splice(i, 1);
  };
  const sandbox = {
    PetSprite: Sprite,
    S,
    VIEW: { w: 1920, h: 1080, x: 0, y: 0 },
    AREAS: [{ x: 0, y: 0, width: 1920, height: 1080 }],
    console,
    performance: { now: () => now },
    requestAnimationFrame: (fn) => {
      raf = fn;
      return 1;
    },
    cancelAnimationFrame: () => {
      raf = null;
    },
    window: {
      setTimeout: setTimeoutFn,
      clearTimeout: clearTimeoutFn,
    },
  };
  sandbox.window.PetShared = S;
  sandbox.setTimeout = setTimeoutFn;
  sandbox.clearTimeout = clearTimeoutFn;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(motionPath, 'utf8'), sandbox, { filename: motionPath });
  vm.runInContext(readFileSync(runnerPath, 'utf8'), sandbox, { filename: runnerPath });

  const plays = [];
  const sprite = new Sprite();
  Object.assign(sprite, {
    presentationKind: 'spine',
    presentation: {
      play(clip, options) {
        plays.push({ clip, loop: !!(options && options.loop) });
      },
      setFacing() {},
    },
    pet: {
      id: 'spine-a',
      presentation: 'spine',
      fixedEnabled: false,
      spine: {
        root: 'heroes/cat',
        meta: {
          clips: { idle: 'Idle', walk: 'Walk' },
          walkSpeedPx: 120,
          defaultSkin: 'default',
        },
      },
    },
    animations: { idle: ['Idle'], turn: [], drag: [], clicks: [], moves: { default: {}, actions: [] } },
    frozen: false,
    sleeping: false,
    dragState: { active: false, dragging: false },
    facing: 'left',
    halfW: 80,
    halfH: 90,
    pos: { x: 0, y: 200 },
    customPos: null,
    moveRef: null,
    moveToken: 0,
    pendingMove: null,
    sendBounds(x, y) {
      this.pos = { x, y };
    },
  });

  const runner = sandbox.createBehaviorRunner(sprite, {
    random: opts.random || (() => 0.5),
    roamMinMs: opts.roamMinMs ?? 8000,
    roamMaxMs: opts.roamMaxMs ?? 15000,
    clipEndMs: opts.clipEndMs ?? 1500,
  });
  sprite.behaviorRunner = runner;

  function flushTimers(ms) {
    now += ms;
    let guard = 0;
    while (guard++ < 50) {
      const due = timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at);
      if (!due.length) break;
      for (const t of due) {
        const i = timers.findIndex((x) => x.id === t.id);
        if (i >= 0) timers.splice(i, 1);
        t.fn();
      }
    }
  }

  function tickRaf(ms) {
    now += ms;
    const fn = raf;
    if (fn) fn();
  }

  return { sprite, runner, plays, sandbox, flushTimers, tickRaf, get raf() { return raf; } };
}

describe('createBehaviorRunner.submitIntent', () => {
  test('远距离 goal 先播 Walk 并启动 startSpeedMoveDrive', () => {
    const { sprite, runner, plays } = loadHarness();
    const ok = runner.submitIntent({
      source: 'roam',
      goal: { xRatio: 0.8, yRatio: 0.5 },
      sequence: [{ clip: 'idle', until: 'duration', durationMs: 40 }],
    });
    assert.equal(ok, true);
    assert.ok(runner.currentPlan);
    assert.equal(runner.currentPriority, 10);
    assert.equal(plays[0].clip, 'Walk');
    assert.equal(plays[0].loop, true);
    assert.ok(sprite.moveRef !== null, 'arrive 步应启动速度位移');
  });

  test('到达后切 idle，duration 定时器结束计划（不依赖 video ended）', () => {
    const { sprite, runner, plays, tickRaf, flushTimers } = loadHarness();
    sprite.pet.spine.meta.walkSpeedPx = 20000;
    runner.submitIntent({
      source: 'roam',
      goal: { xRatio: 0.8, yRatio: 0.5 },
      sequence: [{ clip: 'idle', until: 'duration', durationMs: 40 }],
    });
    for (let i = 0; i < 80 && sprite.moveRef !== null; i++) tickRaf(200);
    assert.equal(sprite.moveRef, null);
    assert.equal(plays.at(-1).clip, 'Idle');
    assert.ok(runner.currentPlan, 'idle duration 尚未到期时计划仍在');
    flushTimers(40);
    assert.equal(runner.currentPlan, null);
    assert.equal(runner.currentPriority, 0);
  });

  test('clip-end 由 runner 定时器收尾', () => {
    const { runner, plays, flushTimers } = loadHarness({ clipEndMs: 25 });
    const ok = runner.submitIntent({
      source: 'menu',
      sequence: [{ clip: 'idle', until: 'clip-end' }],
    });
    assert.equal(ok, true);
    assert.equal(plays[0].clip, 'Idle');
    assert.ok(runner.currentPlan);
    flushTimers(25);
    assert.equal(runner.currentPlan, null);
  });

  test('同优先级 roam 不能打断正在执行的 roam', () => {
    const { runner } = loadHarness();
    assert.equal(
      runner.submitIntent({
        source: 'roam',
        sequence: [{ clip: 'idle', until: 'duration', durationMs: 4000 }],
      }),
      true,
    );
    const token = runner.token;
    assert.equal(
      runner.submitIntent({
        source: 'roam',
        sequence: [{ clip: 'idle', until: 'duration', durationMs: 10 }],
      }),
      false,
    );
    assert.equal(runner.token, token);
    assert.ok(runner.currentPlan);
  });

  test("cancelPlan('user') 清计划并停位移", () => {
    const { sprite, runner } = loadHarness();
    runner.submitIntent({
      source: 'roam',
      goal: { xRatio: 0.9, yRatio: 0.5 },
      sequence: [{ clip: 'idle', until: 'duration', durationMs: 4000 }],
    });
    assert.ok(sprite.moveRef !== null);
    runner.cancelPlan('user');
    assert.equal(runner.currentPlan, null);
    assert.equal(runner.currentPriority, 0);
    assert.equal(sprite.moveRef, null);
  });

  test('arrive 进行中仅 stopMove 不能提交 roam，cancelPlan 后可提交', () => {
    const { sprite, runner } = loadHarness();
    assert.equal(
      runner.submitIntent({
        source: 'roam',
        goal: { xRatio: 0.9, yRatio: 0.5 },
        sequence: [{ clip: 'idle', until: 'duration', durationMs: 4000 }],
      }),
      true,
    );
    assert.ok(sprite.moveRef !== null);
    sprite.stopMove();
    assert.equal(sprite.moveRef, null);
    assert.ok(runner.currentPlan, 'stopMove 不得清计划（playIdle 依赖此顺序）');
    assert.equal(runner.currentPriority, 10);
    assert.equal(
      runner.submitIntent({
        source: 'roam',
        goal: { xRatio: 0.2, yRatio: 0.5 },
        sequence: [{ clip: 'idle', until: 'duration', durationMs: 10 }],
      }),
      false,
    );
    runner.cancelPlan('user');
    assert.equal(runner.currentPlan, null);
    assert.equal(runner.currentPriority, 0);
    assert.equal(
      runner.submitIntent({
        source: 'roam',
        goal: { xRatio: 0.2, yRatio: 0.5 },
        sequence: [{ clip: 'idle', until: 'duration', durationMs: 10 }],
      }),
      true,
    );
  });

  test('缺少 clips.walk 且 goal 远时 submitIntent 失败且不启动位移', () => {
    const { sprite, runner, plays } = loadHarness();
    sprite.pet.spine.meta.clips = { idle: 'Idle' };
    const ok = runner.submitIntent({
      source: 'roam',
      goal: { xRatio: 0.9, yRatio: 0.5 },
      sequence: [{ clip: 'idle', until: 'duration', durationMs: 40 }],
    });
    assert.equal(ok, false);
    assert.equal(runner.currentPlan, null);
    assert.equal(sprite.moveRef, null);
    assert.equal(plays.length, 0);
  });
});

describe('规则漫游', () => {
  test('startRoam 提交带随机 goal 与 idle duration 的 Intent', () => {
    const { runner, plays } = loadHarness({ random: () => 0.5 });
    runner.startRoam();
    assert.ok(runner.currentPlan);
    assert.equal(runner.currentPlan.source, 'roam');
    const arrive = runner.currentPlan.steps.find((s) => s.until === 'arrive');
    assert.ok(arrive, '应插入走路到达步');
    assert.ok(arrive.goal.xRatio > 0.1 && arrive.goal.xRatio < 0.9);
    assert.ok(arrive.goal.yRatio > 0.1 && arrive.goal.yRatio < 0.9);
    const idle = runner.currentPlan.steps.find((s) => s.until === 'duration');
    assert.equal(idle.clip, 'Idle');
    assert.equal(idle.durationMs, 2000);
    assert.equal(plays[0].clip, 'Walk');
  });

  test('固定宠物漫游不带 goal（不走开）', () => {
    const { sprite, runner } = loadHarness();
    sprite.pet.fixedEnabled = true;
    runner.startRoam();
    assert.ok(runner.currentPlan);
    assert.equal(
      runner.currentPlan.steps.some((s) => s.until === 'arrive'),
      false,
    );
  });
});

describe('接入点源码守卫', () => {
  test('index.html 在 presentation 脚本之后加载 behavior-runner.js', () => {
    const html = readFileSync(indexHtmlPath, 'utf8');
    const factory = html.indexOf('src="./sprite/presentation.js"');
    const runner = html.indexOf('src="./sprite/behavior-runner.js"');
    assert.ok(factory >= 0, 'presentation.js 应在 index.html 中');
    assert.ok(runner > factory, 'behavior-runner.js 应在 presentation.js 之后');
  });

  test('prepack-check 将 behavior-runner.js 列为必需文件', () => {
    const src = readFileSync(prepackPath, 'utf8');
    assert.match(src, /runtime\/electron-helper\/sprite\/behavior-runner\.js/);
  });

  test('spine 空闲链走 runner.startRoam，webm 仍 rollKind(fixed)', () => {
    const playback = readFileSync(playbackPath, 'utf8');
    const idleIdx = playback.indexOf('playIdle()');
    assert.ok(idleIdx >= 0, '应有 playIdle');
    const endedIdx = playback.indexOf('handleEnded()', idleIdx);
    const idleBody = playback.slice(idleIdx, endedIdx > idleIdx ? endedIdx : idleIdx + 2000);
    assert.match(idleBody, /this\.presentationKind === 'spine'/);
    assert.match(idleBody, /startRoam/);
    const roamIdx = idleBody.indexOf('startRoam');
    const rollIdx = playback.indexOf('S.rollKind', idleIdx);
    assert.ok(roamIdx >= 0, 'spine 应 startRoam');
    assert.ok(rollIdx > idleIdx + roamIdx, 'webm 掷骰应在 spine 早退之后');
    assert.match(playback, /fixed:\s*this\.pet\.fixedEnabled/);
  });

  test("拖拽开始 cancelPlan('user')，菜单点播 cancelPlan('menu')", () => {
    const input = readFileSync(inputPath, 'utf8');
    const menu = readFileSync(menuPath, 'utf8');
    assert.match(input, /cancelPlan\(\s*['"]user['"]\s*\)/);
    assert.match(menu, /cancelPlan\(\s*['"]menu['"]\s*\)/);
  });

  test('onContextMenu / goHome / applyFreeze 在 stopMove 之外 cancelPlan', () => {
    const menu = readFileSync(menuPath, 'utf8');
    const playback = readFileSync(playbackPath, 'utf8');
    const ctx = menu.slice(menu.indexOf('async onContextMenu'), menu.indexOf('  onMenuAction('));
    assert.match(ctx, /this\.stopMove\(\)/);
    assert.match(ctx, /this\.cancelPlan\(\s*['"]menu['"]\s*\)/);
    const home = menu.slice(menu.indexOf('  goHome()'), menu.indexOf('  postureMenuBranch('));
    assert.match(home, /this\.stopMove\(\)/);
    assert.match(home, /this\.cancelPlan\(\s*['"](?:menu|user)['"]\s*\)/);
    const freeze = playback.slice(playback.indexOf('  applyFreeze('), playback.indexOf('  setLock('));
    const freezeOn = freeze.slice(0, freeze.indexOf('占用锁解除'));
    assert.match(freezeOn, /this\.stopMove\(\)/);
    assert.match(freezeOn, /this\.cancelPlan\(\s*['"]user['"]\s*\)/);
  });
});

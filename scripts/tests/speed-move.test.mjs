/**
 * 骨骼宠恒速位移：startSpeedMoveDrive 按 speedPx * dt 朝像素 goal 走 sendBounds。
 * webm 的 startMoveDrive(el) 仍跟 video.currentTime，本文件不改那条路径。
 * 跑法：node --test scripts/tests/speed-move.test.mjs（npm run test:ui 会带上）
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const motionPath = join(root, 'runtime/electron-helper/sprite/motion.js');
const stubPath = join(root, 'runtime/electron-helper/sprite/presentation-spine-stub.js');
const factoryPath = join(root, 'runtime/electron-helper/sprite/presentation.js');

function loadMotion() {
  class Sprite {}
  let callback = null;
  let now = 0;
  const context = {
    PetSprite: Sprite,
    performance: { now: () => now },
    requestAnimationFrame: (fn) => {
      callback = fn;
      return 1;
    },
    cancelAnimationFrame: () => {
      callback = null;
    },
    VIEW: { w: 1920, h: 1080 },
    window: { __dshPetDebug: {} },
  };
  vm.runInNewContext(readFileSync(motionPath, 'utf8'), context);
  return {
    Sprite,
    tick(ms) {
      now += ms;
      const fn = callback;
      if (fn) fn();
    },
    get callback() {
      return callback;
    },
  };
}

function loadPresentation() {
  const document = {
    createElement(tag) {
      if (tag !== 'canvas') throw new Error('unexpected tag: ' + tag);
      return {
        tagName: 'CANVAS',
        className: '',
        style: { transform: '' },
        width: 320,
        height: 180,
        clientWidth: 320,
        clientHeight: 180,
        parentElement: null,
        ctx: {
          fillStyle: '',
          lastFillText: null,
          clearRect() {},
          fillRect() {},
          fillText(text) {
            this.lastFillText = { text };
          },
          measureText(text) {
            return { width: String(text).length * 8 };
          },
        },
        getContext(type) {
          return type === '2d' ? this.ctx : null;
        },
        remove() {},
      };
    },
  };
  const sandbox = { document, console, window: null };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(stubPath, 'utf8'), sandbox, { filename: stubPath });
  vm.runInContext(readFileSync(factoryPath, 'utf8'), sandbox, { filename: factoryPath });
  return sandbox;
}

function makeSprite(Sprite) {
  const positions = [];
  const sprite = new Sprite();
  Object.assign(sprite, {
    moveRef: null,
    moveToken: 0,
    pendingMove: null,
    halfW: 80,
    halfH: 90,
    pos: { x: 0, y: 200 },
    customPos: null,
    sendBounds(x, y) {
      this.pos = { x, y };
      positions.push({ x, y });
    },
  });
  return { sprite, positions };
}

describe('startSpeedMoveDrive', () => {
  test('每帧按 speedPx * dt 朝 goal 移动 sendBounds', () => {
    const { Sprite, tick } = loadMotion();
    const { sprite, positions } = makeSprite(Sprite);
    sprite.startSpeedMoveDrive({ goal: { x: 1000, y: 200 }, speedPx: 120 });
    tick(16);
    assert.equal(positions.length, 1);
    const expected = 120 * Math.min(16 / 1000, 1 / 30);
    assert.ok(Math.abs(positions[0].x - expected) < 1e-9);
    assert.equal(positions[0].y, 200);
  });

  test('到达 goal 时调用 onArrive 并停 rAF', () => {
    const { Sprite, tick } = loadMotion();
    const { sprite, positions } = makeSprite(Sprite);
    let arrived = 0;
    sprite.pos = { x: 0, y: 200 };
    sprite.startSpeedMoveDrive({
      goal: { x: 10, y: 200 },
      speedPx: 1000,
      onArrive: () => {
        arrived += 1;
      },
    });
    for (let i = 0; i < 20 && sprite.moveRef !== null; i++) tick(16);
    assert.equal(arrived, 1);
    assert.equal(sprite.moveRef, null);
    assert.equal(positions.at(-1).x, 10);
    assert.equal(positions.at(-1).y, 200);
    assert.ok(sprite.customPos);
  });

  test('stub 从左走到右后 clip 从 Walk 切 Idle', () => {
    const { Sprite, tick } = loadMotion();
    const { createSpineStubPresentation } = loadPresentation();
    const { sprite } = makeSprite(Sprite);
    const pres = createSpineStubPresentation();
    const parent = {
      clientWidth: 320,
      clientHeight: 180,
      children: [],
      appendChild(child) {
        this.children.push(child);
        child.parentElement = this;
      },
    };
    pres.mount(parent);
    pres.play('Walk', { loop: true });
    assert.equal(parent.children[0].ctx.lastFillText.text, 'Walk');
    sprite.pos = { x: 0, y: 200 };
    sprite.startSpeedMoveDrive({
      goal: { x: 400, y: 200 },
      speedPx: 20000,
      onArrive: () => pres.play('Idle', { loop: true }),
    });
    for (let i = 0; i < 10 && sprite.moveRef !== null; i++) tick(16);
    assert.equal(sprite.pos.x, 400);
    assert.equal(parent.children[0].ctx.lastFillText.text, 'Idle');
  });
});

describe('webm startMoveDrive 保持不变', () => {
  test('仍按 video.currentTime / duration 插值，不读 speedPx', () => {
    const src = readFileSync(motionPath, 'utf8');
    const speedIdx = src.indexOf('startSpeedMoveDrive');
    const moveIdx = src.indexOf('startMoveDrive(el)');
    assert.ok(speedIdx >= 0, '应存在 startSpeedMoveDrive');
    assert.ok(moveIdx >= 0, '应保留 startMoveDrive(el)');
    assert.ok(src.includes('el.currentTime'), 'webm 驱动仍跟 currentTime');
    assert.ok(src.includes('el.duration'), 'webm 驱动仍读 duration');
    const driveBody = src.slice(moveIdx, speedIdx > moveIdx ? speedIdx : src.length);
    assert.equal(driveBody.includes('speedPx'), false);
  });
});

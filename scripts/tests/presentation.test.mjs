/**
 * 桌面端 PetPresentation 工厂与骨骼 Canvas stub 的单测。
 *
 * 渲染脚本是经典 script（非 ESM），这里用 vm + 最小 DOM 替身加载，钉住：
 *   video kind 返回 null（本 Task 不搬 playback）；
 *   spine stub 的 mount / play / setFacing / dispose。
 * 跑法：node --test scripts/tests/presentation.test.mjs（npm run test:ui 会带上）
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const stubPath = join(root, 'runtime/electron-helper/sprite/presentation-spine-stub.js');
const factoryPath = join(root, 'runtime/electron-helper/sprite/presentation.js');
const indexHtmlPath = join(root, 'runtime/electron-helper/index.html');

function createCanvasMock() {
  const ctx = {
    fillStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    lastFillText: null,
    lastFillRect: null,
    lastFillStyle: null,
    clearRect() {},
    fillRect(x, y, w, h) {
      this.lastFillRect = { x, y, w, h };
      this.lastFillStyle = this.fillStyle;
    },
    fillText(text, x, y) {
      this.lastFillText = { text, x, y };
    },
    measureText(text) {
      return { width: String(text).length * 8 };
    },
  };
  return {
    tagName: 'CANVAS',
    className: '',
    style: { transform: '' },
    width: 300,
    height: 150,
    clientWidth: 320,
    clientHeight: 180,
    parentElement: null,
    children: [],
    ctx,
    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
    },
    remove() {
      if (!this.parentElement) return;
      const list = this.parentElement.children;
      const i = list.indexOf(this);
      if (i >= 0) list.splice(i, 1);
      this.parentElement = null;
    },
    getContext(type) {
      return type === '2d' ? ctx : null;
    },
  };
}

function createParent() {
  return {
    tagName: 'DIV',
    className: 'pet-stage',
    clientWidth: 320,
    clientHeight: 180,
    children: [],
    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
    },
  };
}

function loadPresentation() {
  const document = {
    createElement(tag) {
      if (tag !== 'canvas') throw new Error('unexpected tag: ' + tag);
      return createCanvasMock();
    },
  };
  const sandbox = { document, console, window: null };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(stubPath, 'utf8'), sandbox, { filename: stubPath });
  vm.runInContext(readFileSync(factoryPath, 'utf8'), sandbox, { filename: factoryPath });
  return sandbox;
}

describe('createPresentation 工厂', () => {
  test('video / 未知 kind 返回 null（video 仍走现有 videoA/B）', () => {
    const { createPresentation } = loadPresentation();
    assert.equal(createPresentation('video'), null);
    assert.equal(createPresentation('unknown'), null);
    assert.equal(createPresentation(), null);
  });

  test('spine 返回带 mount/play/setFacing/dispose 的对象', () => {
    const { createPresentation } = loadPresentation();
    const pres = createPresentation('spine');
    assert.equal(typeof pres.mount, 'function');
    assert.equal(typeof pres.play, 'function');
    assert.equal(typeof pres.setFacing, 'function');
    assert.equal(typeof pres.dispose, 'function');
  });
});

describe('createSpineStubPresentation', () => {
  test('mount 创建 canvas.pet-spine-stub 并画半透明色块', () => {
    const { createSpineStubPresentation } = loadPresentation();
    const pres = createSpineStubPresentation();
    const parent = createParent();
    pres.mount(parent);
    assert.equal(parent.children.length, 1);
    const canvas = parent.children[0];
    assert.equal(canvas.className, 'pet-spine-stub');
    assert.ok(canvas.ctx.lastFillRect);
    assert.match(String(canvas.ctx.lastFillStyle), /rgba?\(/i);
  });

  test('play 把 clip 名画到画布中央，loop 记在状态上', () => {
    const { createSpineStubPresentation } = loadPresentation();
    const pres = createSpineStubPresentation();
    const parent = createParent();
    pres.mount(parent);
    pres.play('Walk', { loop: true });
    const canvas = parent.children[0];
    assert.equal(canvas.ctx.lastFillText.text, 'Walk');
    assert.equal(canvas.ctx.lastFillText.x, canvas.width / 2);
    assert.equal(canvas.ctx.lastFillText.y, canvas.height / 2);
    assert.equal(pres.loop, true);
    pres.play('Idle', { loop: false });
    assert.equal(canvas.ctx.lastFillText.text, 'Idle');
    assert.equal(pres.loop, false);
  });

  test("setFacing('right') 用 scaleX(-1)，left 清空 transform", () => {
    const { createSpineStubPresentation } = loadPresentation();
    const pres = createSpineStubPresentation();
    const parent = createParent();
    pres.mount(parent);
    const canvas = parent.children[0];
    pres.setFacing('right');
    assert.equal(canvas.style.transform, 'scaleX(-1)');
    pres.setFacing('left');
    assert.equal(canvas.style.transform, '');
  });

  test('dispose 移除 canvas，可重复调用', () => {
    const { createSpineStubPresentation } = loadPresentation();
    const pres = createSpineStubPresentation();
    const parent = createParent();
    pres.mount(parent);
    assert.equal(parent.children.length, 1);
    pres.dispose();
    assert.equal(parent.children.length, 0);
    pres.dispose();
    assert.equal(parent.children.length, 0);
  });
});

describe('sprite 脚本加载顺序', () => {
  test('index.html 在 playback.js 之后加载 stub 与工厂', () => {
    const html = readFileSync(indexHtmlPath, 'utf8');
    const playback = html.indexOf('src="./sprite/playback.js"');
    const stub = html.indexOf('src="./sprite/presentation-spine-stub.js"');
    const factory = html.indexOf('src="./sprite/presentation.js"');
    assert.ok(playback >= 0, 'playback.js 应在 index.html 中');
    assert.ok(stub > playback, 'presentation-spine-stub.js 应紧随 playback.js');
    assert.ok(factory > stub, 'presentation.js 应在 stub 之后');
  });
});

describe('PetSprite 按 presentation 分支', () => {
  const playbackSrc = readFileSync(join(root, 'runtime/electron-helper/sprite/playback.js'), 'utf8');
  const initSrc = readFileSync(join(root, 'runtime/electron-helper/sprite/init.js'), 'utf8');

  test('spine 早退走 presentation.play；video 双缓冲换源仍在其后', () => {
    const spineIdx = playbackSrc.indexOf("this.presentationKind === 'spine'");
    const playIdx = playbackSrc.indexOf('this.presentation.play(mapped');
    const srcIdx = playbackSrc.indexOf('el.src = url || this.assetBase');
    const loadIdx = playbackSrc.indexOf('el.load()');
    const videoPlayIdx = playbackSrc.indexOf('el.play()');
    assert.ok(spineIdx >= 0, 'switchTo 应判断 spine');
    assert.ok(playIdx > spineIdx, 'spine 应调用 presentation.play');
    assert.ok(srcIdx > spineIdx, 'video 换源应在 spine 早退之后');
    assert.ok(loadIdx > srcIdx, 'video 仍 el.load()');
    assert.ok(videoPlayIdx > loadIdx, 'video 仍 el.play()');
  });

  test('init：spine 挂 createPresentation，video 仍建 videoA/B', () => {
    assert.match(initSrc, /S\.resolvePetPlaybackSetup\(pet\)/);
    assert.match(initSrc, /createPresentation\('spine'/);
    assert.match(initSrc, /this\.videoA = document\.createElement\('video'\)/);
    assert.match(initSrc, /this\.videoB = document\.createElement\('video'\)/);
    const spineMount = initSrc.indexOf("createPresentation('spine'");
    const videoA = initSrc.indexOf("this.videoA = document.createElement('video')");
    assert.ok(spineMount >= 0 && videoA > spineMount, 'video 元素创建应在 spine 分支的 else 里');
  });
});

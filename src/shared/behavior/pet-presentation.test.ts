import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  choosePlaybackBackend,
  createModel3dAnimationStub,
  createSpineAnimationStub,
  mapPresentationClip,
  normalizePresentation,
  resolvePetPlaybackSetup,
  resolvePetPresentation,
} from './pet-presentation.ts';
import { buildMenuTree } from '../menu/tree.ts';
import type { Pet } from '../types.ts';

describe('normalizePresentation', () => {
  test('video / spine / model3d 字面量原样', () => {
    assert.equal(normalizePresentation('model3d'), 'model3d');
    assert.equal(normalizePresentation('spine'), 'spine');
    assert.equal(normalizePresentation('video'), 'video');
  });

  test('其它值一律 video', () => {
    assert.equal(normalizePresentation(undefined), 'video');
    assert.equal(normalizePresentation(null), 'video');
    assert.equal(normalizePresentation('SPINE'), 'video');
    assert.equal(normalizePresentation(42), 'video');
    assert.equal(normalizePresentation({}), 'video');
    assert.equal(normalizePresentation('unknown'), 'video');
  });
});

describe('resolvePetPresentation', () => {
  test('读取 pet.presentation 并归一化', () => {
    const spinePet = { id: 'a', presentation: 'spine' } as Pet;
    const modelPet = { id: 'm', presentation: 'model3d' } as Pet;
    const videoPet = { id: 'b', presentation: 'video' } as Pet;
    const defaultPet = { id: 'c' } as Pet;
    assert.equal(resolvePetPresentation(spinePet), 'spine');
    assert.equal(resolvePetPresentation(modelPet), 'model3d');
    assert.equal(resolvePetPresentation(videoPet), 'video');
    assert.equal(resolvePetPresentation(defaultPet), 'video');
  });
});

describe('choosePlaybackBackend', () => {
  test("video / spine / model3d 原样，其余 → video", () => {
    assert.equal(choosePlaybackBackend('spine'), 'spine');
    assert.equal(choosePlaybackBackend('model3d'), 'model3d');
    assert.equal(choosePlaybackBackend('video'), 'video');
    assert.equal(choosePlaybackBackend(undefined), 'video');
    assert.equal(choosePlaybackBackend('SPINE'), 'video');
  });
});

describe('createModel3dAnimationStub', () => {
  test('model3d stub 把可点槽填进 clicks', () => {
    const animations = createModel3dAnimationStub({
      idle: 'idle',
      walk: 'walk',
      wave: 'wave',
      happy: 'cheer',
      dance: 'dance',
    });
    assert.deepEqual(animations.clicks, ['wave', 'happy', 'dance']);
  });
});

describe('createSpineAnimationStub', () => {
  test('idle 取 clips.idle，缺省 idle', () => {
    assert.deepEqual(createSpineAnimationStub({ idle: 'Idle' }).idle, ['Idle']);
    assert.deepEqual(createSpineAnimationStub({}).idle, ['idle']);
  });

  test('其它池为空，菜单树可安全读取', () => {
    const animations = createSpineAnimationStub({ idle: 'Breath' });
    assert.deepEqual(animations.turn, []);
    assert.deepEqual(animations.clicks, []);
    const tree = buildMenuTree(animations);
    assert.equal(tree[0]?.label, '动作');
    assert.equal(tree[0] && 'children' in tree[0] ? tree[0].children[0]?.label : '', '待机');
  });
});

describe('mapPresentationClip', () => {
  test('槽位名映射到 clips，未知名原样返回', () => {
    assert.equal(mapPresentationClip('walk', { walk: 'Walk' }), 'Walk');
    assert.equal(mapPresentationClip('walk', null), 'walk');
    assert.equal(mapPresentationClip('Walk', { idle: 'Idle' }), 'Walk');
  });
});

describe('resolvePetPlaybackSetup', () => {
  test('video 缺 animations 抛错', () => {
    assert.throws(
      () => resolvePetPlaybackSetup({ id: 'main', presentation: 'video' }),
      /宠物缺少 animations/,
    );
  });

  test('model3d 缺 animations 用 stub，idle 来自 meta clips', () => {
    const setup = resolvePetPlaybackSetup({
      id: 'fox',
      presentation: 'model3d',
      model3d: { meta: { clips: { idle: 'Survey' } } } as import('../types.ts').Pet['model3d'],
    });
    assert.equal(setup.kind, 'model3d');
    assert.equal(setup.usedStub, true);
    assert.deepEqual(setup.animations.idle, ['Survey']);
  });

  test('spine 缺 animations 用最小桩', () => {
    const setup = resolvePetPlaybackSetup({
      id: 's',
      presentation: 'spine',
      spine: { root: 'heroes/cat', meta: { clips: { idle: 'Idle' }, walkSpeedPx: 90, defaultSkin: 'd' } },
    });
    assert.equal(setup.kind, 'spine');
    assert.deepEqual(setup.animations.idle, ['Idle']);
    assert.equal(setup.usedStub, true);
  });

  test('有 animations 原样使用', () => {
    const animations = createSpineAnimationStub({ idle: 'A' });
    const setup = resolvePetPlaybackSetup({ id: 's', presentation: 'spine', animations });
    assert.equal(setup.kind, 'spine');
    assert.equal(setup.animations, animations);
    assert.equal(setup.usedStub, false);
  });
});
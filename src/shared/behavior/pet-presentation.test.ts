import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  choosePlaybackBackend,
  createSpineAnimationStub,
  mapPresentationClip,
  normalizePresentation,
  resolvePetPlaybackSetup,
  resolvePetPresentation,
} from './pet-presentation.ts';
import { buildMenuTree } from '../menu/tree.ts';
import type { Pet } from '../types.ts';

describe('normalizePresentation', () => {
  test('仅字面量 spine → spine', () => {
    assert.equal(normalizePresentation('spine'), 'spine');
  });

  test('其它值一律 video', () => {
    assert.equal(normalizePresentation('video'), 'video');
    assert.equal(normalizePresentation(undefined), 'video');
    assert.equal(normalizePresentation(null), 'video');
    assert.equal(normalizePresentation('SPINE'), 'video');
    assert.equal(normalizePresentation(42), 'video');
    assert.equal(normalizePresentation({}), 'video');
  });
});

describe('resolvePetPresentation', () => {
  test('读取 pet.presentation 并归一化', () => {
    const spinePet = { id: 'a', presentation: 'spine' } as Pet;
    const videoPet = { id: 'b', presentation: 'video' } as Pet;
    const defaultPet = { id: 'c' } as Pet;
    assert.equal(resolvePetPresentation(spinePet), 'spine');
    assert.equal(resolvePetPresentation(videoPet), 'video');
    assert.equal(resolvePetPresentation(defaultPet), 'video');
  });
});

describe('choosePlaybackBackend', () => {
  test("仅 'spine' → spine，其余 → video", () => {
    assert.equal(choosePlaybackBackend('spine'), 'spine');
    assert.equal(choosePlaybackBackend('video'), 'video');
    assert.equal(choosePlaybackBackend(undefined), 'video');
    assert.equal(choosePlaybackBackend(null), 'video');
    assert.equal(choosePlaybackBackend('SPINE'), 'video');
  });
});

describe('createSpineAnimationStub', () => {
  test('idle 取 clips.idle，缺省 idle', () => {
    assert.deepEqual(createSpineAnimationStub({ idle: 'Idle' }).idle, ['Idle']);
    assert.deepEqual(createSpineAnimationStub({}).idle, ['idle']);
    assert.deepEqual(createSpineAnimationStub().idle, ['idle']);
    assert.deepEqual(createSpineAnimationStub(null).idle, ['idle']);
  });

  test('其它池为空，菜单树可安全读取', () => {
    const animations = createSpineAnimationStub({ idle: 'Breath' });
    assert.deepEqual(animations.turn, []);
    assert.deepEqual(animations.drag, []);
    assert.deepEqual(animations.clicks, []);
    assert.deepEqual(animations.moves.actions, []);
    assert.deepEqual(animations.categories, []);
    assert.deepEqual(animations.events, {});
    const tree = buildMenuTree(animations);
    assert.equal(tree[0]?.label, '动作');
    assert.equal(tree[0] && 'children' in tree[0] ? tree[0].children[0]?.label : '', '待机');
  });
});

describe('mapPresentationClip', () => {
  test('槽位名映射到 clips，未知名原样返回', () => {
    assert.equal(mapPresentationClip('idle', { idle: 'Idle' }), 'Idle');
    assert.equal(mapPresentationClip('Walk', { idle: 'Idle' }), 'Walk');
    assert.equal(mapPresentationClip('idle', {}), 'idle');
    assert.equal(mapPresentationClip('idle'), 'idle');
  });
});

describe('resolvePetPlaybackSetup', () => {
  test('video 缺 animations 仍抛', () => {
    assert.throws(() => resolvePetPlaybackSetup({ id: 'v' }), /缺少 animations/);
  });

  test('spine 缺 animations 用最小桩，不抛', () => {
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

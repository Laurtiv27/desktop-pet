import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizePresentation,
  resolvePetPlaybackSetup,
  createModel3dAnimationStub,
  mapPresentationClip,
} from './pet-presentation.ts';

test('normalizePresentation 仅 spine/model3d 原样，其余 video', () => {
  assert.equal(normalizePresentation('model3d'), 'model3d');
  assert.equal(normalizePresentation('spine'), 'spine');
  assert.equal(normalizePresentation('video'), 'video');
  assert.equal(normalizePresentation(undefined), 'video');
  assert.equal(normalizePresentation(null), 'video');
  assert.equal(normalizePresentation('unknown'), 'video');
});

test('model3d 缺 animations 用 stub，idle 来自 meta clips', () => {
  const setup = resolvePetPlaybackSetup({
    id: 'fox',
    presentation: 'model3d',
    model3d: { meta: { clips: { idle: 'Survey' } } } as import('./types.ts').Pet['model3d'],
  });
  assert.equal(setup.kind, 'model3d');
  assert.equal(setup.usedStub, true);
  assert.deepEqual(setup.animations.idle, ['Survey']);
});

test('model3d 有 animations 时不使用 stub', () => {
  const animations = createModel3dAnimationStub({ idle: 'FromClips' });
  const setup = resolvePetPlaybackSetup({
    id: 'fox',
    presentation: 'model3d',
    animations,
  });
  assert.equal(setup.usedStub, false);
  assert.equal(setup.animations, animations);
});

test('video 缺 animations 抛错', () => {
  assert.throws(
    () =>
      resolvePetPlaybackSetup({
        id: 'main',
        presentation: 'video',
      }),
    /宠物缺少 animations/,
  );
});

test('mapPresentationClip 无映射时原样返回', () => {
  assert.equal(mapPresentationClip('walk', null), 'walk');
  assert.equal(mapPresentationClip('walk', { idle: 'Survey' }), 'walk');
});

test('mapPresentationClip 有映射时返回映射名', () => {
  assert.equal(mapPresentationClip('walk', { walk: 'Walk' }), 'Walk');
});
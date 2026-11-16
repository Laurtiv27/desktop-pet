import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseModel3dMeta, DEFAULT_WALK_SPEED_PX } from './model3d-meta.ts';

test('合法 meta 解析 clips/scale/camera/facingMode/autoBehavior', () => {
  const m = parseModel3dMeta({
    clips: { idle: 'Survey', walk: 'Walk' },
    walkSpeedPx: 90,
    scale: 0.02,
    pivot: { x: 0, y: 0, z: 0 },
    camera: { kind: 'perspective', fov: 35, distance: 4 },
    facingMode: 'mirror',
    autoBehavior: false,
    glb: 'Fox.glb',
  });
  assert.ok(m);
  assert.equal(m!.clips.idle, 'Survey');
  assert.equal(m!.walkSpeedPx, 90);
  assert.equal(m!.scale, 0.02);
  assert.equal(m!.facingMode, 'mirror');
  assert.equal(m!.autoBehavior, false);
  assert.equal(m!.glb, 'Fox.glb');
});

test('缺 clips 或 clips 全非法 → null', () => {
  assert.equal(parseModel3dMeta({}), null);
  assert.equal(parseModel3dMeta({ clips: { idle: 1 } }), null);
});

test('walkSpeedPx 非法回落默认', () => {
  const m = parseModel3dMeta({ clips: { idle: 'A' }, walkSpeedPx: -1 });
  assert.equal(m!.walkSpeedPx, DEFAULT_WALK_SPEED_PX);
});
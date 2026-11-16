import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseSpineMeta, DEFAULT_WALK_SPEED_PX } from './spine-meta.ts';

describe('parseSpineMeta', () => {
  test('合法 meta 解析 clips 与速度', () => {
    const m = parseSpineMeta({
      clips: { idle: 'Idle', walk: 'Walk' },
      walkSpeedPx: 90,
      defaultSkin: 'default',
    });
    assert.ok(m);
    assert.equal(m!.clips.idle, 'Idle');
    assert.equal(m!.walkSpeedPx, 90);
  });

  test('缺 clips 或非对象 → null', () => {
    assert.equal(parseSpineMeta(null), null);
    assert.equal(parseSpineMeta({ walkSpeedPx: 1 }), null);
  });

  test('walkSpeedPx 非法回落默认', () => {
    const m = parseSpineMeta({ clips: { idle: 'a' }, walkSpeedPx: -1, defaultSkin: 's' });
    assert.equal(m!.walkSpeedPx, DEFAULT_WALK_SPEED_PX);
  });
});
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { PetIntent } from './types.ts';
import { validateIntent } from './validate-intent.ts';

const allowed = new Set(['Idle', 'Walk', 'idle', 'walk']);

function baseIntent(overrides: Partial<PetIntent> = {}): PetIntent {
  return {
    source: 'user',
    sequence: [{ clip: 'Idle' }],
    ...overrides,
  };
}

describe('validateIntent', () => {
  test('合法 intent 通过', () => {
    const intent = baseIntent({
      goal: { xRatio: 0.5, yRatio: 0.3 },
      sequence: [{ clip: 'idle' }, { clip: 'Walk', loop: true, until: 'arrive' }],
    });
    const r = validateIntent(intent, allowed);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(r.intent, intent);
    }
  });

  test('未知 clip 拒绝', () => {
    const r = validateIntent(
      baseIntent({ sequence: [{ clip: 'foo' }] }),
      allowed,
    );
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, '未知动作: foo');
    }
  });

  test('goal 越界拒绝', () => {
    const r = validateIntent(
      baseIntent({ goal: { xRatio: 1.2, yRatio: 0.5 } }),
      allowed,
    );
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, '目标坐标越界');
    }
  });

  test('空 sequence 拒绝', () => {
    const r = validateIntent(baseIntent({ sequence: [] }), allowed);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, '动作序列为空');
    }
  });

  test('until 为 duration 时 durationMs 须为有限正数', () => {
    const bad = validateIntent(
      baseIntent({ sequence: [{ clip: 'Idle', until: 'duration' }] }),
      allowed,
    );
    assert.equal(bad.ok, false);
    if (!bad.ok) {
      assert.equal(bad.reason, '时长无效');
    }

    const ok = validateIntent(
      baseIntent({
        sequence: [{ clip: 'Idle', until: 'duration', durationMs: 500 }],
      }),
      allowed,
    );
    assert.equal(ok.ok, true);
  });
});
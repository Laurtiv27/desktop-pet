import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { PetIntent } from './types.ts';
import { planBehavior } from './planner.ts';

const clips = { idle: 'Idle', walk: 'Walk', sit: 'Sit' } as const;

function allowedFromClips(
  c: Partial<Record<string, string>>,
): Set<string> {
  const set = new Set<string>();
  for (const [slot, name] of Object.entries(c)) {
    set.add(slot);
    if (name) set.add(name);
  }
  return set;
}

const allowed = allowedFromClips(clips);

function baseIntent(overrides: Partial<PetIntent> = {}): PetIntent {
  return {
    source: 'roam',
    sequence: [{ clip: 'idle' }],
    ...overrides,
  };
}

describe('planBehavior', () => {
  test('远距离 goal 在最前补 walk 直到到达', () => {
    const intent = baseIntent({
      goal: { xRatio: 0.8, yRatio: 0.5 },
      sequence: [{ clip: 'sit' }],
    });
    const r = planBehavior({
      intent,
      allowedClips: allowed,
      clips,
      walkClip: 'Walk',
      hasWalkClip: true,
      current: { xRatio: 0.1, yRatio: 0.1 },
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.plan.steps.length, 2);
    assert.deepEqual(r.plan.steps[0], {
      clip: 'Walk',
      loop: true,
      until: 'arrive',
      goal: { xRatio: 0.8, yRatio: 0.5 },
    });
    assert.deepEqual(r.plan.steps[1], {
      clip: 'Sit',
      loop: false,
      until: 'clip-end',
    });
    assert.equal(r.plan.priority, 10);
    assert.equal(r.plan.facing, 'keep');
    assert.equal(r.plan.source, 'roam');
  });

  test('已在阈值内不补 walk', () => {
    const goal = { xRatio: 0.5, yRatio: 0.5 };
    const r = planBehavior({
      intent: baseIntent({ goal, sequence: [{ clip: 'idle' }] }),
      allowedClips: allowed,
      clips,
      walkClip: 'Walk',
      hasWalkClip: true,
      current: { xRatio: 0.501, yRatio: 0.5 },
      arriveThreshold: 0.01,
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.plan.steps.length, 1);
    assert.equal(r.plan.steps[0]!.clip, 'Idle');
  });

  test('需要走路但缺少 walk clip 时失败', () => {
    const r = planBehavior({
      intent: baseIntent({
        goal: { xRatio: 0.9, yRatio: 0.9 },
        sequence: [{ clip: 'idle' }],
      }),
      allowedClips: allowed,
      clips,
      walkClip: 'Walk',
      hasWalkClip: false,
      current: { xRatio: 0, yRatio: 0 },
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.reason, '缺少走路动作');
  });

  test('validateIntent 失败原样返回', () => {
    const r = planBehavior({
      intent: baseIntent({ sequence: [{ clip: 'missing' }] }),
      allowedClips: allowed,
      clips,
      walkClip: 'Walk',
      hasWalkClip: true,
      current: { xRatio: 0.5, yRatio: 0.5 },
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.reason, '未知动作: missing');
  });

  test('sequence 已有 until arrive 的 walk 时不重复插入', () => {
    const goal = { xRatio: 0.9, yRatio: 0.2 };
    const r = planBehavior({
      intent: baseIntent({
        goal,
        sequence: [{ clip: 'walk', loop: true, until: 'arrive' }, { clip: 'idle' }],
      }),
      allowedClips: allowed,
      clips,
      walkClip: 'Walk',
      hasWalkClip: true,
      current: { xRatio: 0.1, yRatio: 0.1 },
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.plan.steps.length, 2);
    assert.equal(r.plan.steps[0]!.until, 'arrive');
    assert.equal(r.plan.steps[0]!.clip, 'Walk');
  });

  test('槽位名映射为动画名，已是动画名则保持', () => {
    const r = planBehavior({
      intent: baseIntent({
        sequence: [{ clip: 'Idle' }, { clip: 'sit', loop: true }],
      }),
      allowedClips: allowed,
      clips,
      walkClip: 'Walk',
      hasWalkClip: true,
      current: { xRatio: 0.5, yRatio: 0.5 },
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.plan.steps[0]!.clip, 'Idle');
    assert.deepEqual(r.plan.steps[1], {
      clip: 'Sit',
      loop: true,
      until: 'clip-end',
    });
  });

  test('facing 与 priority 来自 intent', () => {
    const r = planBehavior({
      intent: baseIntent({
        source: 'ai',
        facing: 'left',
        priority: 42,
        sequence: [{ clip: 'idle' }],
      }),
      allowedClips: allowed,
      clips,
      walkClip: 'Walk',
      hasWalkClip: true,
      current: { xRatio: 0.5, yRatio: 0.5 },
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.plan.facing, 'left');
    assert.equal(r.plan.priority, 42);
  });
});
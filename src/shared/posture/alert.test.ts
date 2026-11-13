import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AlertGate, planAlert } from './alert.ts';
import { DEFAULT_POSTURE_CONFIG } from './config.ts';

describe('AlertGate', () => {
  test('同类冷却内第二次拒绝', () => {
    let t = 0;
    const g = new AlertGate(60, () => t);
    assert.equal(g.allow('slouch'), true);
    t = 10;
    assert.equal(g.allow('slouch'), false);
    t = 61;
    assert.equal(g.allow('slouch'), true);
  });

  test('不同事件类型独立冷却', () => {
    let t = 0;
    const g = new AlertGate(60, () => t);
    assert.equal(g.allow('slouch'), true);
    t = 10;
    assert.equal(g.allow('fatigue'), true);
    t = 20;
    assert.equal(g.allow('slouch'), false);
    assert.equal(g.allow('fatigue'), false);
  });
});

describe('planAlert', () => {
  test('允许时按配置返回演出与降级开关', () => {
    const g = new AlertGate(60, () => 0);
    const cfg = { ...DEFAULT_POSTURE_CONFIG, petPerform: true, toast: true, beep: false };
    assert.deepEqual(planAlert(cfg, 'slouch', g), {
      perform: true,
      toast: true,
      beep: false,
    });
  });

  test('冷却内三者全 false', () => {
    let t = 0;
    const g = new AlertGate(60, () => t);
    const cfg = { ...DEFAULT_POSTURE_CONFIG, petPerform: true, toast: true, beep: true };
    assert.deepEqual(planAlert(cfg, 'slouch', g), {
      perform: true,
      toast: true,
      beep: true,
    });
    t = 1;
    assert.deepEqual(planAlert(cfg, 'slouch', g), {
      perform: false,
      toast: false,
      beep: false,
    });
  });
});

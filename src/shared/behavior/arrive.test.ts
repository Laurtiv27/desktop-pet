import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { hasArrived, ratioDistance } from './arrive.ts';

describe('ratioDistance', () => {
  test('同一点距离为 0', () => {
    const p = { xRatio: 0.4, yRatio: 0.6 };
    assert.equal(ratioDistance(p, p), 0);
  });

  test('比例平面上的欧氏距离（3-4-5）', () => {
    assert.equal(ratioDistance({ xRatio: 0, yRatio: 0 }, { xRatio: 0.3, yRatio: 0.4 }), 0.5);
  });
});

describe('hasArrived', () => {
  test('默认阈值 0.01：距离不超过阈值视为到达', () => {
    const current = { xRatio: 0.5, yRatio: 0.5 };
    const goal = { xRatio: 0.509, yRatio: 0.5 };
    assert.equal(hasArrived(current, goal), true);
    assert.equal(hasArrived(current, goal, 0.01), true);
  });

  test('默认阈值外未到达', () => {
    assert.equal(hasArrived({ xRatio: 0.1, yRatio: 0.1 }, { xRatio: 0.8, yRatio: 0.5 }), false);
  });

  test('可传入自定义阈值', () => {
    const current = { xRatio: 0, yRatio: 0 };
    const goal = { xRatio: 0.2, yRatio: 0 };
    assert.equal(hasArrived(current, goal, 0.1), false);
    assert.equal(hasArrived(current, goal, 0.2), true);
  });
});

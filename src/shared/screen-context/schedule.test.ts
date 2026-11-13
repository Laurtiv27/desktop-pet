import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { shouldStartTick } from './schedule.ts';

describe('shouldStartTick', () => {
  test('enabled 且非 busy → true', () => {
    assert.equal(shouldStartTick({ enabled: true, busy: false }), true);
  });

  test('disabled → false', () => {
    assert.equal(shouldStartTick({ enabled: false, busy: false }), false);
    assert.equal(shouldStartTick({ enabled: false, busy: true }), false);
  });

  test('busy → false', () => {
    assert.equal(shouldStartTick({ enabled: true, busy: true }), false);
  });
});

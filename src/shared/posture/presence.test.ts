import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createPresenceTracker } from './presence.ts';

describe('createPresenceTracker', () => {
  test('无人脸持续 leaveSec 调 onSleep 一次', () => {
    let t = 100;
    let sleepCount = 0;
    const tracker = createPresenceTracker({
      leaveSec: 10,
      now: () => t,
      onSleep: () => {
        sleepCount++;
      },
      onWake: () => {},
    });
    tracker.onFace(true);
    t = 105;
    tracker.onFace(false);
    t = 109;
    tracker.onFace(false);
    assert.equal(sleepCount, 0);
    t = 110;
    tracker.onFace(false);
    assert.equal(sleepCount, 1);
    t = 200;
    tracker.onFace(false);
    assert.equal(sleepCount, 1);
  });

  test('人脸回来调 onWake 一次', () => {
    let t = 0;
    let wakeCount = 0;
    const tracker = createPresenceTracker({
      leaveSec: 10,
      now: () => t,
      onSleep: () => {},
      onWake: () => {
        wakeCount++;
      },
    });
    tracker.onFace(true);
    t = 11;
    tracker.onFace(false);
    assert.equal(wakeCount, 0);
    tracker.onFace(true);
    assert.equal(wakeCount, 1);
    tracker.onFace(true);
    assert.equal(wakeCount, 1);
  });

  test('reset 清除在离状态', () => {
    let t = 0;
    let sleepCount = 0;
    const tracker = createPresenceTracker({
      leaveSec: 10,
      now: () => t,
      onSleep: () => {
        sleepCount++;
      },
      onWake: () => {},
    });
    tracker.onFace(true);
    t = 20;
    tracker.onFace(false);
    assert.equal(sleepCount, 1);
    tracker.reset();
    t = 25;
    tracker.onFace(false);
    assert.equal(sleepCount, 1);
    t = 35;
    tracker.onFace(false);
    assert.equal(sleepCount, 2);
  });
});

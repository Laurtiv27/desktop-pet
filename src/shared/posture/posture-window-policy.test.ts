import { createRequire } from 'node:module';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { bootPostureAction, reduceEnabled } from './posture-window-policy.ts';

const require = createRequire(import.meta.url);
const jsPosture = require('../../../runtime/electron-helper/main/posture-window.js') as {
  bootPostureAction: typeof bootPostureAction;
  reduceEnabled: typeof reduceEnabled;
};

describe('bootPostureAction', () => {
  test('enabled 为真时启动', () => {
    assert.equal(bootPostureAction(true), 'start');
  });

  test('enabled 为假时不拉窗', () => {
    assert.equal(bootPostureAction(false), 'noop');
  });
});

describe('reduceEnabled', () => {
  test('关闭中的窗遇到 enabled 则 start', () => {
    assert.deepEqual(reduceEnabled('stopped', true), { phase: 'running', action: 'start' });
  });

  test('运行中的窗遇到关闭则 stop', () => {
    assert.deepEqual(reduceEnabled('running', false), { phase: 'stopped', action: 'stop' });
  });

  test('已经是目标状态时 noop', () => {
    assert.deepEqual(reduceEnabled('running', true), { phase: 'running', action: 'noop' });
    assert.deepEqual(reduceEnabled('stopped', false), { phase: 'stopped', action: 'noop' });
  });

  test('主进程副本与本模块一致', () => {
    assert.equal(jsPosture.bootPostureAction(true), bootPostureAction(true));
    assert.equal(jsPosture.bootPostureAction(false), bootPostureAction(false));
    assert.deepEqual(jsPosture.reduceEnabled('stopped', true), reduceEnabled('stopped', true));
    assert.deepEqual(jsPosture.reduceEnabled('running', false), reduceEnabled('running', false));
  });
});

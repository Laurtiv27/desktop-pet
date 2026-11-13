import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_POSTURE_CONFIG,
  applySensitivity,
  loadPostureConfig,
  postureConfigPath,
} from './config.ts';

describe('postureConfigPath', () => {
  test('拼到 dsh-pet/posture-config.json', () => {
    assert.equal(postureConfigPath('C:/Users/x/.dsh'), 'C:/Users/x/.dsh/dsh-pet/posture-config.json');
  });
});

describe('applySensitivity', () => {
  test('standard 不改坐姿阈值', () => {
    const t = applySensitivity({ ...DEFAULT_POSTURE_CONFIG, sensitivity: 'standard' });
    assert.equal(t.FWD_HEAD_OFF, 0.1);
    assert.equal(t.POSTURE_HOLD_SEC, 8);
  });
  test('strict 缩小阈值并缩短 hold', () => {
    const t = applySensitivity({ ...DEFAULT_POSTURE_CONFIG, sensitivity: 'strict' });
    assert.ok(Math.abs(t.FWD_HEAD_OFF - 0.08) < 1e-9);
    assert.equal(t.POSTURE_HOLD_SEC, 5);
    assert.equal(t.EAR_CLOSED, 0.18); // 疲劳不缩放
  });
});

describe('loadPostureConfig', () => {
  test('缺文件用默认且 enabled=false', () => {
    const cfg = loadPostureConfig(() => {
      throw Object.assign(new Error('enoent'), { code: 'ENOENT' });
    }, '/x/posture-config.json');
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.sensitivity, 'standard');
  });
  test('合并用户字段', () => {
    const cfg = loadPostureConfig(
      () => JSON.stringify({ enabled: true, cooldown: 30, sensitivity: 'loose' }),
      '/x/posture-config.json',
    );
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.cooldown, 30);
    assert.equal(cfg.sensitivity, 'loose');
    assert.equal(cfg.beep, true);
  });
  test('旧冷却档位就近归一到 5/10/30', () => {
    const cfg = loadPostureConfig(
      () => JSON.stringify({ cooldown: 60 }),
      '/x/posture-config.json',
    );
    assert.equal(cfg.cooldown, 30);
  });
});

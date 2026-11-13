import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SCREEN_CONTEXT_CONFIG,
  loadScreenContextConfig,
  saveScreenContextConfig,
  screenContextConfigPath,
} from './config.ts';

describe('screenContextConfigPath', () => {
  test('拼到 dsh-pet/screen-context.json', () => {
    assert.equal(
      screenContextConfigPath('C:/Users/x/.dsh'),
      'C:/Users/x/.dsh/dsh-pet/screen-context.json',
    );
  });
});

describe('DEFAULT_SCREEN_CONTEXT_CONFIG', () => {
  test('默认 disabled、interval 300、默认黑名单', () => {
    assert.equal(DEFAULT_SCREEN_CONTEXT_CONFIG.enabled, false);
    assert.equal(DEFAULT_SCREEN_CONTEXT_CONFIG.intervalSec, 300);
    assert.equal(DEFAULT_SCREEN_CONTEXT_CONFIG.persistSummary, false);
    assert.deepEqual(DEFAULT_SCREEN_CONTEXT_CONFIG.blacklist.titles, [
      '密码',
      'Password',
      '银行',
      '支付',
      '钱包',
      '私密',
      '1Password',
      'Bitwarden',
    ]);
    assert.deepEqual(DEFAULT_SCREEN_CONTEXT_CONFIG.blacklist.processes, [
      'KeePass',
      '1Password',
      'Bitwarden',
    ]);
  });
});

describe('loadScreenContextConfig', () => {
  test('缺文件用默认且 enabled=false', () => {
    const cfg = loadScreenContextConfig(() => {
      throw Object.assign(new Error('enoent'), { code: 'ENOENT' });
    }, '/x/screen-context.json');
    assert.deepEqual(cfg, DEFAULT_SCREEN_CONTEXT_CONFIG);
  });

  test('合并用户字段', () => {
    const cfg = loadScreenContextConfig(
      () =>
        JSON.stringify({
          enabled: true,
          intervalSec: 120,
          persistSummary: true,
          blacklist: { titles: ['自定义'], processes: ['MyApp'] },
        }),
      '/x/screen-context.json',
    );
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.intervalSec, 120);
    assert.equal(cfg.persistSummary, true);
    assert.deepEqual(cfg.blacklist.titles, ['自定义']);
    assert.deepEqual(cfg.blacklist.processes, ['MyApp']);
  });

  test('显式空黑名单数组读盘保留为空', () => {
    const cfg = loadScreenContextConfig(
      () =>
        JSON.stringify({
          enabled: true,
          blacklist: { titles: [], processes: [] },
        }),
      '/x/screen-context.json',
    );
    assert.deepEqual(cfg.blacklist.titles, []);
    assert.deepEqual(cfg.blacklist.processes, []);
  });

  test('空黑名单 save/load 往返', () => {
    const cfg = {
      ...DEFAULT_SCREEN_CONTEXT_CONFIG,
      blacklist: { titles: [] as string[], processes: [] as string[] },
    };
    let saved = '';
    saveScreenContextConfig(
      (_path, content) => {
        saved = content;
      },
      '/x/screen-context.json',
      cfg,
    );
    const loaded = loadScreenContextConfig(() => saved, '/x/screen-context.json');
    assert.deepEqual(loaded.blacklist.titles, []);
    assert.deepEqual(loaded.blacklist.processes, []);
  });

  test('intervalSec 非法回落 300', () => {
    const cfg = loadScreenContextConfig(
      () => JSON.stringify({ enabled: true, intervalSec: -1 }),
      '/x/screen-context.json',
    );
    assert.equal(cfg.intervalSec, 300);
    const cfg2 = loadScreenContextConfig(
      () => JSON.stringify({ enabled: true, intervalSec: 'abc' }),
      '/x/screen-context.json',
    );
    assert.equal(cfg2.intervalSec, 300);
  });
});

describe('saveScreenContextConfig', () => {
  test('写入 JSON', () => {
    let saved = '';
    saveScreenContextConfig(
      (_path, content) => {
        saved = content;
      },
      '/x/screen-context.json',
      DEFAULT_SCREEN_CONTEXT_CONFIG,
    );
    assert.equal(saved, JSON.stringify(DEFAULT_SCREEN_CONTEXT_CONFIG, null, 2));
  });
});

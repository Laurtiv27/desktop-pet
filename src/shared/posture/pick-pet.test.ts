import { createRequire } from 'node:module';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { animationPoolFor, pickActivePet } from './pick-pet.ts';

const require = createRequire(import.meta.url);
const jsPosture = require('../../../runtime/electron-helper/main/posture-window.js') as {
  pickActivePet: typeof pickActivePet;
  animationPoolFor: typeof animationPoolFor;
};

const BOTH = {
  main: { pets: [{ id: 'main', display: 'both' }] },
  dengxi: { pets: [{ id: 'dengxi', display: 'both' }] },
};

describe('pickActivePet', () => {
  test('自定义种类和 main 同时可见时优先自定义', () => {
    assert.equal(pickActivePet(BOTH), 'dengxi');
  });

  test('只有 main 在桌面时选 main', () => {
    assert.equal(pickActivePet({ main: { pets: [{ id: 'main', display: 'desktop' }] } }), 'main');
  });

  test('多个自定义种类按配置顺序取第一个非 main', () => {
    assert.equal(
      pickActivePet({
        alpha: { pets: [{ id: 'alpha', display: 'desktop' }] },
        beta: { pets: [{ id: 'beta', display: 'both' }] },
      }),
      'alpha',
    );
  });

  test('只在 web / none 或没有可见宠物时回 fallback', () => {
    assert.equal(pickActivePet({ main: { pets: [{ id: 'main', display: 'web' }] } }), 'main');
    assert.equal(pickActivePet({ main: { pets: [{ id: 'main', display: 'none' }] } }, 'dengxi'), 'dengxi');
    assert.equal(pickActivePet({}), 'main');
  });

  test('主进程副本与本模块一致', () => {
    assert.equal(jsPosture.pickActivePet(BOTH), pickActivePet(BOTH));
    assert.equal(jsPosture.pickActivePet(null, 'keep'), pickActivePet(null, 'keep'));
    assert.deepEqual(jsPosture.animationPoolFor(POOL_CFG, 'main'), animationPoolFor(POOL_CFG, 'main'));
    assert.equal(jsPosture.animationPoolFor(POOL_CFG, 'ghost'), null);
  });

  test('坏配置不抛，跳过缺 id 与非对象条目', () => {
    assert.equal(pickActivePet(null, 'keep'), 'keep');
    assert.equal(pickActivePet(undefined), 'main');
    assert.equal(
      pickActivePet({
        bad: null,
        list: { pets: 'nope' },
        empty: { pets: [{ display: 'desktop' }, { id: '', display: 'both' }, { id: 'ok', display: 'desktop' }] },
      }),
      'ok',
    );
  });
});

const POOL_CFG = {
  main: {
    pets: [{ id: 'main', display: 'both' }],
    animations: {
      idle: ['待机呼吸休闲'],
      turn: [],
      drag: ['被鼠标拖拽悬空反馈'],
      clicks: ['点击回应-开心跃动'],
      moves: { default: {}, actions: [{ name: '螃蟹走路' }] },
      categories: [
        { id: '小动作', weight: 20, actions: ['悠闲哼歌', '超大伸懒腰'] },
        { id: '玩耍', weight: 20, actions: ['原地专心玩魔方'] },
      ],
      events: { balance: ['evt-a', ['evt-b', 'evt-c']] },
    },
  },
};

describe('animationPoolFor', () => {
  test('按来源顺序收集并去重，嵌套 events 也收进来', () => {
    const pool = animationPoolFor(POOL_CFG, 'main');
    assert.ok(pool);
    assert.deepEqual(pool.slice(0, 4), ['待机呼吸休闲', '被鼠标拖拽悬空反馈', '点击回应-开心跃动', '螃蟹走路']);
    assert.ok(pool.includes('悠闲哼歌'));
    assert.ok(pool.includes('evt-b'));
    assert.equal(pool.length, new Set(pool).size);
  });

  test('未知宠物返回 null', () => {
    assert.equal(animationPoolFor(POOL_CFG, 'ghost'), null);
  });

  test('畸形 events / animations 不抛', () => {
    const cfg = {
      main: {
        pets: [{ id: 'main', display: 'both' }],
        animations: { idle: ['待机呼吸休闲'], events: ['evt-a', 'evt-b'] },
      },
    };
    assert.deepEqual(animationPoolFor(cfg, 'main'), ['待机呼吸休闲']);
    cfg.main.animations.events = 'evt-str' as unknown as string[];
    assert.deepEqual(animationPoolFor(cfg, 'main'), ['待机呼吸休闲']);
    (cfg.main.animations as { events: unknown }).events = null;
    assert.deepEqual(animationPoolFor(cfg, 'main'), ['待机呼吸休闲']);
    const broken = { main: { pets: [{ id: 'main', display: 'both' }], animations: ['not-a-dict'] } };
    assert.equal(animationPoolFor(broken, 'main'), null);
  });
});

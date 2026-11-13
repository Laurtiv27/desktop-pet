import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createScreenContextStore } from './store.ts';
import { isSummaryInjectable } from './expiry.ts';

const t0 = 1_700_000_000_000;
const intervalSec = 300;

describe('createScreenContextStore', () => {
  test('初始为 idle', () => {
    const store = createScreenContextStore({ persistSummary: false });
    const s = store.get();
    assert.equal(s.status, 'idle');
    assert.equal(s.text, '');
    assert.equal(s.updatedAt, 0);
  });

  test('setOk 更新 text、updatedAt、status', () => {
    const store = createScreenContextStore({ persistSummary: false });
    store.setOk('用户在写代码', t0);
    const s = store.get();
    assert.equal(s.status, 'ok');
    assert.equal(s.text, '用户在写代码');
    assert.equal(s.updatedAt, t0);
    assert.equal(s.lastError, undefined);
    assert.equal(s.skipNote, undefined);
  });

  test('setSkipped 保留上一份 ok 的 text 与 updatedAt', () => {
    const store = createScreenContextStore({ persistSummary: false });
    store.setOk('旧摘要', t0);
    store.setSkipped(t0 + 60_000);
    const s = store.get();
    assert.equal(s.status, 'skipped');
    assert.equal(s.text, '旧摘要');
    assert.equal(s.updatedAt, t0);
    assert.ok(s.skipNote);
    assert.equal(s.lastError, undefined);
    assert.equal(
      isSummaryInjectable({ status: s.status, text: s.text, updatedAt: s.updatedAt }, intervalSec, t0),
      false,
    );
  });

  test('setError 保留上一份 ok 并记录 lastError', () => {
    const store = createScreenContextStore({ persistSummary: false });
    store.setOk('旧摘要', t0);
    store.setError('模型超时', t0 + 1);
    const s = store.get();
    assert.equal(s.status, 'error');
    assert.equal(s.text, '旧摘要');
    assert.equal(s.updatedAt, t0);
    assert.equal(s.lastError, '模型超时');
    assert.equal(s.errorMessage, '模型超时');
    assert.equal(s.skipNote, undefined);
  });

  test('无 ok 时 setSkipped / setError 不伪造摘要', () => {
    const store = createScreenContextStore({ persistSummary: false });
    store.setSkipped(t0);
    assert.equal(store.get().text, '');
    assert.equal(store.get().updatedAt, 0);
    store.clear();
    store.setError('失败', t0);
    assert.equal(store.get().text, '');
    assert.equal(store.get().updatedAt, 0);
    assert.equal(store.get().lastError, '失败');
  });

  test('setOk 后清除 skip/error 附注', () => {
    const store = createScreenContextStore({ persistSummary: false });
    store.setOk('a', t0);
    store.setError('e', t0 + 1);
    store.setOk('b', t0 + 2);
    const s = store.get();
    assert.equal(s.status, 'ok');
    assert.equal(s.text, 'b');
    assert.equal(s.updatedAt, t0 + 2);
    assert.equal(s.lastError, undefined);
    assert.equal(s.skipNote, undefined);
  });

  test('clear 恢复 idle', () => {
    const store = createScreenContextStore({ persistSummary: false });
    store.setOk('x', t0);
    store.clear();
    const s = store.get();
    assert.equal(s.status, 'idle');
    assert.equal(s.text, '');
    assert.equal(s.updatedAt, 0);
  });

  test('persistSummary 时 setOk 写盘且 loadFromDisk 可读', () => {
    const files = new Map<string, string>();
    const readFile = (path: string) => {
      const v = files.get(path);
      if (v === undefined) {
        throw Object.assign(new Error('enoent'), { code: 'ENOENT' });
      }
      return v;
    };
    const writeFile = (path: string, data: string) => {
      files.set(path, data);
    };
    const statePath = '/data/screen-context-state.json';

    const store = createScreenContextStore({
      persistSummary: true,
      readFile,
      writeFile,
      statePath,
    });
    assert.equal(typeof store.loadFromDisk, 'function');

    store.setOk('磁盘摘要', t0);
    assert.ok(files.has(statePath));

    const store2 = createScreenContextStore({
      persistSummary: true,
      readFile,
      writeFile,
      statePath,
    });
    store2.loadFromDisk!();
    const s = store2.get();
    assert.equal(s.status, 'ok');
    assert.equal(s.text, '磁盘摘要');
    assert.equal(s.updatedAt, t0);
  });

  test('persistSummary=false 不提供 loadFromDisk', () => {
    const store = createScreenContextStore({ persistSummary: false });
    assert.equal(store.loadFromDisk, undefined);
  });
});

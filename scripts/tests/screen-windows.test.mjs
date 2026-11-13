/**
 * screen-windows：mock exec 测 PowerShell JSON 解析与非 Windows 空列表。
 * 跑法：node --test scripts/tests/screen-windows.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createWindowLister } = require('../../runtime/electron-helper/main/screen-windows.js');

function execReturning(stdout) {
  return async () => ({ stdout, stderr: '' });
}

test('解析多条窗口 JSON', async () => {
  const stdout = JSON.stringify([
    { title: '记事本', processName: 'Notepad' },
    { title: 'Visual Studio Code', processName: 'Code' },
  ]);
  const { listOpenWindows } = createWindowLister({
    exec: execReturning(stdout),
    platform: 'win32',
  });
  const rows = await listOpenWindows();
  assert.deepEqual(rows, [
    { title: '记事本', processName: 'Notepad' },
    { title: 'Visual Studio Code', processName: 'Code' },
  ]);
});

test('单条记录时为对象而非数组', async () => {
  const stdout = JSON.stringify({ title: 'Chrome', processName: 'chrome' });
  const { listOpenWindows } = createWindowLister({
    exec: execReturning(stdout),
    platform: 'win32',
  });
  assert.deepEqual(await listOpenWindows(), [{ title: 'Chrome', processName: 'chrome' }]);
});

test('过滤空标题', async () => {
  const stdout = JSON.stringify([
    { title: '  ', processName: 'x' },
    { title: 'OK', processName: 'y' },
    { title: '', processName: 'z' },
  ]);
  const { listOpenWindows } = createWindowLister({
    exec: execReturning(stdout),
    platform: 'win32',
  });
  assert.deepEqual(await listOpenWindows(), [{ title: 'OK', processName: 'y' }]);
});

test('stdout 空或非法 JSON 返回 []', async () => {
  for (const stdout of ['', 'not-json']) {
    const { listOpenWindows } = createWindowLister({
      exec: execReturning(stdout),
      platform: 'win32',
    });
    assert.deepEqual(await listOpenWindows(), []);
  }
});

test('非 Windows：[] 并 log，不调用 exec', async () => {
  const logs = [];
  let called = false;
  const { listOpenWindows } = createWindowLister({
    platform: 'linux',
    log: (...args) => logs.push(args.join(' ')),
    exec: async () => {
      called = true;
      return { stdout: '[]', stderr: '' };
    },
  });
  assert.deepEqual(await listOpenWindows(), []);
  assert.equal(called, false);
  assert.ok(logs.some((line) => line.includes('non-Windows')));
});

test('exec 失败返回 [] 并 log', async () => {
  const logs = [];
  const { listOpenWindows } = createWindowLister({
    platform: 'win32',
    log: (...args) => logs.push(args.join(' ')),
    exec: async () => {
      throw new Error('spawn failed');
    },
  });
  assert.deepEqual(await listOpenWindows(), []);
  assert.ok(logs.some((line) => line.includes('failed')));
});

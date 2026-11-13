import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isBlacklisted, type WindowInfo } from './blacklist.ts';

const noHit: WindowInfo[] = [
  { title: 'Visual Studio Code', processName: 'Code.exe' },
  { title: '记事本', processName: 'notepad.exe' },
];

describe('isBlacklisted', () => {
  test('标题子串命中', () => {
    const windows: WindowInfo[] = [{ title: '登录 - 输入密码', processName: 'app.exe' }];
    assert.equal(isBlacklisted(windows, { titles: ['密码'], processes: [] }), true);
  });

  test('进程子串命中', () => {
    const windows: WindowInfo[] = [{ title: 'Wallet', processName: '1Password.exe' }];
    assert.equal(isBlacklisted(windows, { titles: [], processes: ['1password'] }), true);
  });

  test('大小写不敏感', () => {
    const windows: WindowInfo[] = [{ title: 'BANK Portal', processName: 'Foo.exe' }];
    assert.equal(isBlacklisted(windows, { titles: ['bank'], processes: [] }), true);
  });

  test('无命中', () => {
    assert.equal(
      isBlacklisted(noHit, { titles: ['密码', '支付'], processes: ['chrome'] }),
      false,
    );
  });

  test('空窗口列表', () => {
    assert.equal(isBlacklisted([], { titles: ['密码'], processes: ['chrome'] }), false);
  });

  test('任一窗口命中即为 true', () => {
    const windows: WindowInfo[] = [
      ...noHit,
      { title: '私密相册', processName: 'photos.exe' },
    ];
    assert.equal(isBlacklisted(windows, { titles: ['私密'], processes: [] }), true);
  });
});

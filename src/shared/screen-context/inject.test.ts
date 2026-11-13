import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isSummaryInjectable } from './expiry.ts';
import {
  SCREEN_CONTEXT_INJECT_PREFIX,
  formatScreenContextInjectLine,
  appendScreenContext,
} from './inject.ts';
import type { ScreenContextState } from './types.ts';

const intervalSec = 300;
const updatedAt = 1_000_000;
const ttlMs = 2 * intervalSec * 1000;

const okState = (text: string, at = updatedAt): ScreenContextState => ({
  status: 'ok',
  text,
  updatedAt: at,
});

describe('isSummaryInjectable', () => {
  test('ok 未过期 → true', () => {
    assert.equal(isSummaryInjectable(okState('在写代码'), intervalSec, updatedAt + ttlMs), true);
  });

  test('ok 刚好在边界 → true', () => {
    assert.equal(isSummaryInjectable(okState('x'), intervalSec, updatedAt + ttlMs), true);
  });

  test('ok 过期 → false', () => {
    assert.equal(
      isSummaryInjectable(okState('在写代码'), intervalSec, updatedAt + ttlMs + 1),
      false,
    );
  });

  test('空 text → false', () => {
    assert.equal(isSummaryInjectable(okState(''), intervalSec, updatedAt), false);
    assert.equal(isSummaryInjectable(okState('   '), intervalSec, updatedAt), false);
  });

  for (const status of ['skipped', 'error', 'idle', 'expired'] as const) {
    test(`${status} → false`, () => {
      const state: ScreenContextState = { status, text: '有字', updatedAt };
      assert.equal(isSummaryInjectable(state, intervalSec, updatedAt), false);
    });
  }
});

describe('formatScreenContextInjectLine', () => {
  test('含前缀与正文', () => {
    const line = formatScreenContextInjectLine('浏览器里在看文档');
    assert.match(line, new RegExp(`^${SCREEN_CONTEXT_INJECT_PREFIX}`));
    assert.ok(line.includes('浏览器里在看文档'));
    assert.ok(line.includes('勿复述或朗读隐私细节'));
  });
});

describe('appendScreenContext', () => {
  const base = '你是桌宠，请用简短语气回复。';

  test('可注入 → base 后追加一行', () => {
    const out = appendScreenContext(base, okState('在 IDE'), intervalSec, updatedAt);
    assert.equal(
      out,
      `${base}\n（屏幕上下文，仅供语气与话题参考，勿复述或朗读隐私细节：在 IDE）`,
    );
  });

  test('不可注入 → 原样', () => {
    assert.equal(
      appendScreenContext(base, okState('x', updatedAt - ttlMs - 1), intervalSec, updatedAt),
      base,
    );
    assert.equal(
      appendScreenContext(
        base,
        { status: 'skipped', text: '旧摘要', updatedAt },
        intervalSec,
        updatedAt,
      ),
      base,
    );
    assert.equal(appendScreenContext(base, okState(''), intervalSec, updatedAt), base);
  });
});

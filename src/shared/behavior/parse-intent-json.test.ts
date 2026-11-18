/**
 * AI Intent JSON 解析：合法、非法、未知字段容忍、缺 sequence 失败。
 * 跑法：node --experimental-strip-types --test src/shared/behavior/parse-intent-json.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { parseIntentJson } from './parse-intent-json.ts';

describe('parseIntentJson', () => {
  test('整段合法 JSON', () => {
    const r = parseIntentJson(
      JSON.stringify({
        sequence: [{ clip: 'wave', until: 'clip-end' }],
        goal: { xRatio: 0.5, yRatio: 0.4 },
        facing: 'left',
      }),
    );
    assert.ok(r);
    assert.equal(r!.sequence[0]!.clip, 'wave');
    assert.equal(r!.goal?.xRatio, 0.5);
    assert.equal(r!.facing, 'left');
    assert.equal(r!.source, 'ai');
  });

  test('正文夹杂时抽第一个 {...}', () => {
    const r = parseIntentJson('好的～{"sequence":[{"clip":"sit","loop":true}]} 完');
    assert.ok(r);
    assert.equal(r!.sequence[0]!.clip, 'sit');
    assert.equal(r!.sequence[0]!.loop, true);
  });

  test('未知顶层字段忽略', () => {
    const r = parseIntentJson(
      JSON.stringify({
        extra: 'ignored',
        meta: { foo: 1 },
        sequence: [{ clip: 'idle' }],
      }),
    );
    assert.ok(r);
    assert.equal(r!.sequence.length, 1);
    assert.equal('extra' in (r as object), false);
  });

  test('非法 JSON → null', () => {
    assert.equal(parseIntentJson('{not json'), null);
    assert.equal(parseIntentJson(''), null);
  });

  test('缺 sequence 或空 sequence → null', () => {
    assert.equal(parseIntentJson('{"facing":"left"}'), null);
    assert.equal(parseIntentJson('{"sequence":[]}'), null);
    assert.equal(parseIntentJson('{"sequence":[{"until":"clip-end"}]}'), null);
  });

  test('goal / facing 不合 → null', () => {
    assert.equal(parseIntentJson('{"sequence":[{"clip":"idle"}],"goal":{"x":"a"}}'), null);
    assert.equal(parseIntentJson('{"sequence":[{"clip":"idle"}],"facing":"up"}'), null);
  });
});
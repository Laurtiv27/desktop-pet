import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAnim, resolveAnimWithFallback, type AnimMap } from './anim-map.ts';

const map = JSON.parse(
  readFileSync(fileURLToPath(new URL('./anim-map.json', import.meta.url)), 'utf8'),
) as AnimMap;

test('main fatigue → 哈欠连天', () => {
  assert.equal(resolveAnim(map, 'main', 'fatigue'), '哈欠连天');
});

test('未知宠回落 default', () => {
  assert.equal(resolveAnim(map, 'nope', 'near'), '被吓一跳');
});

test('池校验失败用首个动作', () => {
  assert.equal(resolveAnimWithFallback(map, 'main', 'fatigue', ['闲置A', '闲置B']), '闲置A');
});

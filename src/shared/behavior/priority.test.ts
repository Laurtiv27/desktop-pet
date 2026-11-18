import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { PetIntent } from './types.ts';
import { canInterrupt } from './priority.ts';

function intent(overrides: Partial<PetIntent> = {}): PetIntent {
  return {
    source: 'roam',
    sequence: [{ clip: 'idle' }],
    ...overrides,
  };
}

describe('canInterrupt', () => {
  test('更高优先级可打断', () => {
    assert.equal(
      canInterrupt(10, intent({ source: 'user' })),
      true,
    );
    assert.equal(
      canInterrupt(30, intent({ source: 'menu' })),
      true,
    );
  });

  test('相等优先级不打断', () => {
    assert.equal(canInterrupt(10, intent({ source: 'roam' })), false);
    assert.equal(canInterrupt(100, intent({ source: 'user' })), false);
  });

  test('更低优先级不打断', () => {
    assert.equal(
      canInterrupt(100, intent({ source: 'roam' })),
      false,
    );
    assert.equal(
      canInterrupt(50, intent({ source: 'ai' })),
      false,
    );
  });

  test('intent.priority 覆盖来源默认', () => {
    assert.equal(
      canInterrupt(50, intent({ source: 'roam', priority: 80 })),
      true,
    );
    assert.equal(
      canInterrupt(100, intent({ source: 'user', priority: 10 })),
      false,
    );
  });
});
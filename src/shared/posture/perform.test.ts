import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { performReminder, type PetRouteClient } from './perform.ts';

type RecordedCall = {
  method: 'GET' | 'POST';
  rest: string;
  query: Record<string, string>;
  body?: unknown;
};

function mockClient(
  handlers: Partial<{
    lock: () => Promise<{ ok: boolean; json?: unknown }>;
    broadcast: () => Promise<{ ok: boolean; json?: unknown }>;
    anim: () => Promise<{ ok: boolean; json?: unknown }>;
    release: () => Promise<{ ok: boolean; json?: unknown }>;
  }> = {},
): { client: PetRouteClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const defaults = {
    lock: async () => ({ ok: true, json: { lockId: 'L-test' } }),
    broadcast: async () => ({ ok: true }),
    anim: async () => ({ ok: true }),
    release: async () => ({ ok: true }),
  };
  const h = { ...defaults, ...handlers };
  const client: PetRouteClient = {
    async request(method, rest, query, body) {
      calls.push({ method, rest, query, body });
      if (rest === 'lock') return h.lock();
      if (rest === 'broadcast') return h.broadcast();
      if (rest === 'anim') return h.anim();
      if (rest === 'lock/release') return h.release();
      return { ok: false };
    },
  };
  return { client, calls };
}

describe('performReminder', () => {
  test('成功路径 lock → broadcast → anim → lock/release', async () => {
    const { client, calls } = mockClient();
    const ok = await performReminder(client, {
      petId: 'main',
      animName: '被吓一跳',
      message: '坐直哦',
    });
    assert.equal(ok, true);
    assert.deepEqual(
      calls.map((c) => c.rest),
      ['lock', 'broadcast', 'anim', 'lock/release'],
    );
    assert.equal(calls[0].query.pet, 'main');
    assert.equal(calls[0].query.surface, 'any');
    assert.equal(calls[1].query.lock, 'L-test');
    assert.deepEqual(calls[1].body, { text: '坐直哦', duration: 4500, anim: false });
    assert.deepEqual(calls[2].body, { name: '被吓一跳' });
    assert.deepEqual(calls[3].body, { lockId: 'L-test' });
  });

  test('lock 失败时不调 broadcast/anim 并返回 false', async () => {
    const { client, calls } = mockClient({
      lock: async () => ({ ok: false }),
    });
    const ok = await performReminder(client, {
      petId: 'main',
      animName: 'x',
      message: 'y',
    });
    assert.equal(ok, false);
    assert.deepEqual(calls.map((c) => c.rest), ['lock']);
  });

  test('broadcast 失败时尝试 release 且不播 anim', async () => {
    const { client, calls } = mockClient({
      broadcast: async () => ({ ok: false }),
    });
    const ok = await performReminder(client, {
      petId: 'main',
      animName: 'x',
      message: 'y',
    });
    assert.equal(ok, false);
    assert.deepEqual(calls.map((c) => c.rest), ['lock', 'broadcast', 'lock/release']);
  });

  test('client 抛错时吞掉并返回 false', async () => {
    const client: PetRouteClient = {
      request: async () => {
        throw new Error('network');
      },
    };
    assert.equal(
      await performReminder(client, { petId: 'main', animName: 'a', message: 'b' }),
      false,
    );
  });
});

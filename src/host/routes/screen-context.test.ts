/**
 * POST /screen-context/summarize：旧摘要接口已下线。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PetRouteDeps, RouteInput } from './types.ts';
import { handleScreenContextRoutes } from './screen-context.ts';

const JPEG = Buffer.from('jpeg-bytes').toString('base64');

function input(method: string, body?: string): RouteInput {
  return {
    url: new URL('http://127.0.0.1/dsh-pet-7340/screen-context/summarize'),
    rest: 'screen-context/summarize',
    method,
    body,
  };
}

test('POST 返回下线说明，不调模型', async () => {
  let streamed = 0;
  const deps = {
    optionalService: () => undefined,
    ctx: {
      llm: {
        stream() {
          streamed += 1;
          return { async *[Symbol.asyncIterator]() {} };
        },
      },
    },
  } as unknown as PetRouteDeps;
  const result = await handleScreenContextRoutes(
    deps,
    input('POST', JSON.stringify({ mediaType: 'image/jpeg', data: JPEG })),
  );
  assert.equal(streamed, 0);
  assert.equal(result?.kind, 'json');
  if (result?.kind !== 'json') return;
  assert.equal((result.obj as { ok?: boolean }).ok, false);
  assert.match(String((result.obj as { message?: string }).message), /下线|碎碎念/);
});

test('方法不对或 JSON 损坏时按协议失败', async () => {
  const deps = { optionalService: () => undefined, ctx: {} } as unknown as PetRouteDeps;
  const get = await handleScreenContextRoutes(deps, input('GET'));
  assert.equal(get?.kind, 'json');
  if (get?.kind === 'json') assert.equal(get.status, 405);
  const bad = await handleScreenContextRoutes(deps, input('POST', '{'));
  assert.equal(bad?.kind, 'json');
  if (bad?.kind === 'json') assert.equal(bad.status, 400);
  assert.equal(await handleScreenContextRoutes(deps, { ...input('POST'), rest: 'other' }), undefined);
});

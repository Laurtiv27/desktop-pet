/**
 * `/model3d/<petId>/<file>` 静态路由：扩展名白名单、petId 守卫、路径穿越与合法应答。
 *
 * 源码形态下 PACKAGE_ROOT 为 `<pkg>/src`，测试在 `src/assets/model3d/` 下临时落盘。
 * 跑法：node --experimental-strip-types --test src/host/routes/assets-model3d.test.ts
 */
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { handleAssetsRoutes } from './assets.ts';
import { PACKAGE_ROOT } from '../paths.ts';
import { MIME } from '../http.ts';
import type { PetRouteDeps } from './types.ts';
import type { RouteResult } from '../http.ts';

const MODEL3D_ROOT = join(PACKAGE_ROOT, 'assets', 'model3d');
const DEMO_PET = 'model3d-demo';

const deps = (): PetRouteDeps => ({ petConfigDir: '' }) as unknown as PetRouteDeps;

function call(rest: string): Promise<RouteResult | undefined> {
  return handleAssetsRoutes(deps(), { url: new URL('http://localhost/' + rest), rest, method: 'GET' });
}

function demoFile(name: string, body = 'glb-bytes'): string {
  const dir = join(MODEL3D_ROOT, DEMO_PET);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, body);
  return path;
}

before(() => {
  mkdirSync(MODEL3D_ROOT, { recursive: true });
});

beforeEach(() => {
  rmSync(MODEL3D_ROOT, { recursive: true, force: true });
  mkdirSync(MODEL3D_ROOT, { recursive: true });
});

after(() => {
  rmSync(MODEL3D_ROOT, { recursive: true, force: true });
});

describe('handleAssetsRoutes —— /model3d', () => {
  test('合法 .glb → file + model/gltf-binary', async () => {
    const path = demoFile('Fox.glb');
    const result = await call(`model3d/${DEMO_PET}/Fox.glb`);
    assert.ok(result !== undefined && result.kind === 'file');
    assert.equal(result.file, path);
    assert.equal(result.contentType, MIME['.glb']);
  });

  test('路径缺文件名 → 400', async () => {
    const result = await call(`model3d/${DEMO_PET}`);
    assert.ok(result !== undefined && result.kind === 'text');
    assert.equal(result.status, 400);
  });

  test('非法 petId → 400', async () => {
    const result = await call('model3d/../evil/fox.glb');
    assert.ok(result !== undefined && result.kind === 'text');
    assert.equal(result.status, 400);
    assert.match(result.body, /invalid pet id/);
  });

  test('.exe 扩展名 → 400', async () => {
    const result = await call(`model3d/${DEMO_PET}/payload.exe`);
    assert.ok(result !== undefined && result.kind === 'text');
    assert.equal(result.status, 400);
    assert.match(result.body, /unsupported model3d format/);
  });

  test('文件名含 ../ 逃逸 → 404', async () => {
    demoFile('safe.glb');
    const result = await call(`model3d/${DEMO_PET}/../outside/leak.glb`);
    assert.ok(result !== undefined && result.kind === 'text');
    assert.equal(result.status, 404);
  });

  test('不存在但扩展名合法 → 404', async () => {
    const result = await call(`model3d/${DEMO_PET}/missing.glb`);
    assert.ok(result !== undefined && result.kind === 'text');
    assert.equal(result.status, 404);
  });
});
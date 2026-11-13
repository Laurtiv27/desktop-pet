#!/usr/bin/env node
/**
 * 用本地 tsc 生成 lib/types 下的类型声明，发布链需要它。
 *
 * 发布入口只有 package.json exports 的 lib/types/index.d.ts（宿主半侧）。
 * 浏览器入口 src/client 不进类型工程：对话面板类型不随包发布，也避免解析已移除的客户端包。
 * 三个仍被宿主引用的包名由 tsconfig paths 指到 src/standalone/shims。
 * 声明保持与源码相同的目录，再由 lib/types/index.d.ts 再导出宿主入口。
 * 只生成声明，不构建 JS（typecheck 是另一条链）。
 * @module desktop-pet/scripts/gen-types
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TYPES = join(ROOT, 'lib', 'types');
const HOST_INDEX = join(TYPES, 'host', 'index.d.ts');

rmSync(TYPES, { recursive: true, force: true });
mkdirSync(TYPES, { recursive: true });

// 直接调用本仓库的 tsc，不经 npm/npx，这样只有 node 的环境也能生成声明。
const require = createRequire(import.meta.url);
const tscEntry = require.resolve('typescript/lib/tsc.js');
const tsc = spawnSync(process.execPath, [tscEntry, '-p', 'tsconfig.types.json'], {
  cwd: ROOT,
  stdio: 'inherit',
});
if (tsc.status !== 0) {
  console.error(`[gen-types] 类型声明生成失败 (exit ${tsc.status})`);
  process.exit(tsc.status ?? 1);
}

if (!existsSync(HOST_INDEX)) {
  console.error('[gen-types] 缺少 lib/types/host/index.d.ts');
  process.exit(1);
}

// 不把 host/ 上移：paths 会把 shim 编进同一棵声明树，相对路径必须保持源码层级。
writeFileSync(join(TYPES, 'index.d.ts'), 'export * from "./host/index.js";\n', 'utf8');

console.log('[gen-types] ✓ lib/types 声明生成完成');

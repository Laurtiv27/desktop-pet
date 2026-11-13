#!/usr/bin/env node
/**
 * 把坐姿隐藏窗运行时要带上的 MediaPipe 资源刷进 posture/vendor。
 *
 * electron-builder 排除 node_modules，插件包也不保证 node_modules 布局；
 * 检测页改为读这份副本：wasm、vision_bundle.js，以及从 src 拷来的 anim-map.json。
 * 源文件没变（大小与 mtime）则跳过。源包不在但副本已齐时沿用副本，避免没装依赖时把已固化的文件弄丢。
 * @module dsh-pet/scripts/vendor-posture-assets
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PKG = join(ROOT, 'node_modules', '@mediapipe', 'tasks-vision');
const DEST = join(ROOT, 'runtime', 'electron-helper', 'posture', 'vendor');

const REQUIRED_DEST = [
  'vision_bundle.js',
  'anim-map.json',
  'wasm/vision_wasm_internal.js',
  'wasm/vision_wasm_internal.wasm',
  'wasm/vision_wasm_module_internal.js',
  'wasm/vision_wasm_module_internal.wasm',
];

function needsCopy(from, to) {
  if (!existsSync(to)) return true;
  const src = statSync(from);
  const dst = statSync(to);
  return src.size !== dst.size || src.mtimeMs > dst.mtimeMs;
}

function destReady() {
  return REQUIRED_DEST.every((rel) => existsSync(join(DEST, rel)));
}

/**
 * 刷新 vendor 副本。
 *
 * @returns `{ copied, reused }`。reused 表示源包缺失、沿用了已有副本。
 */
export function vendorPostureAssets() {
  const visionSrc = join(PKG, 'vision_bundle.js');
  const wasmSrc = join(PKG, 'wasm');
  const animSrc = join(ROOT, 'src', 'shared', 'posture', 'anim-map.json');
  if (!existsSync(visionSrc) || !existsSync(wasmSrc) || !existsSync(animSrc)) {
    if (destReady()) {
      console.warn('[vendor-posture] 源包不在，沿用已有 vendor');
      return { copied: 0, reused: true };
    }
    throw new Error('[vendor-posture] 找不到 @mediapipe/tasks-vision 或 anim-map.json，先安装依赖');
  }

  const pairs = [
    [visionSrc, join(DEST, 'vision_bundle.js')],
    [animSrc, join(DEST, 'anim-map.json')],
  ];
  for (const name of readdirSync(wasmSrc)) {
    if (name.endsWith('.map')) continue;
    const from = join(wasmSrc, name);
    if (!statSync(from).isFile()) continue;
    pairs.push([from, join(DEST, 'wasm', name)]);
  }

  let copied = 0;
  for (const [from, to] of pairs) {
    if (!needsCopy(from, to)) continue;
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    copied += 1;
  }
  if (!destReady()) {
    throw new Error('[vendor-posture] 拷贝后仍缺 wasm / vision_bundle.js / anim-map.json');
  }
  console.log(
    copied ? `[vendor-posture] 更新 ${copied} 个文件 → posture/vendor` : '[vendor-posture] posture/vendor 已是最新',
  );
  return { copied, reused: false };
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) vendorPostureAssets();

/**
 * 桌面端表现层工厂：按 kind 给出可挂载的 PetPresentation。
 *
 * PetPresentation 约定：
 *   mount(parent) — 把表现层挂到父节点
 *   play(clip, { loop }) — 切换 clip；loop 记在状态上
 *   setFacing('left'|'right') — 朝向
 *   dispose() — 卸下并释放
 *
 * 加载顺序：vendor/spine-webgl → presentation-spine-stub → presentation-spine → 本文件。
 * video 仍走现有 videoA/B。
 * @module dsh-pet/runtime/electron-helper/sprite-presentation
 */
'use strict';

/**
 * @param {'spine'|'video'|string} kind
 * @param {object} [opts]
 * @returns {PetPresentation|null}
 */
function createPresentation(kind, opts) {
  if (kind !== 'spine') return null; // video 仍走现有 videoA/B
  // 优先真 Spine；运行时或 WebGL 不可用时回落色块 stub（仅兜底）
  if (typeof createSpineWebglPresentation === 'function') {
    const real = createSpineWebglPresentation(opts);
    if (real) return real;
  }
  return createSpineStubPresentation(opts);
}

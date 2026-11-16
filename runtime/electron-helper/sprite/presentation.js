/**
 * 桌面端表现层工厂：按 kind 给出可挂载的 PetPresentation。
 *
 * PetPresentation 约定：
 *   mount(parent) — 把表现层挂到父节点
 *   play(clip, { loop }) — 切换 clip；loop 记在状态上
 *   setFacing('left'|'right') — 朝向（右向 scaleX(-1)）
 *   dispose() — 卸下并释放
 *
 * 须在 presentation-spine-stub.js 之后加载。video 仍走现有 videoA/B，本文件不搬 playback。
 * @module dsh-pet/runtime/electron-helper/sprite-presentation
 */
'use strict';

/**
 * @param {'spine'|'video'|string} kind
 * @param {object} [opts]
 * @returns {PetPresentation|null}
 */
function createPresentation(kind, opts) {
  if (kind === 'spine') return createSpineStubPresentation(opts);
  return null; // video 仍走现有 videoA/B，本 Task 不搬 playback
}

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
  const meta = opts && opts.pet && opts.pet.spine && opts.pet.spine.meta;
  const runtime = meta && typeof meta.runtime === 'string' ? meta.runtime.trim() : '';
  const want38 = runtime === '3.8';
  console.info(
    '[dsh-pet] createPresentation spine runtime=' +
      (runtime || '(缺省4.x)') +
      ' spine38=' +
      !!(typeof window !== 'undefined' && window.spine38 && window.spine38.webgl) +
      ' fn38=' +
      (typeof createSpine38Presentation),
  );
  // 3.8 导出（立绘包等）走独立运行时；缺省 / 4.x 走现有 WebGL
  if (want38) {
    if (typeof createSpine38Presentation === 'function') {
      const v38 = createSpine38Presentation(opts);
      if (v38) return v38;
      console.warn('[dsh-pet] Spine 3.8 表现层创建失败（spine38 未就绪？）');
    } else {
      console.warn('[dsh-pet] 配置 runtime=3.8 但 createSpine38Presentation 未加载');
    }
  }
  if (typeof createSpineWebglPresentation === 'function') {
    const real = createSpineWebglPresentation(opts);
    if (real) return real;
  }
  return createSpineStubPresentation(opts);
}

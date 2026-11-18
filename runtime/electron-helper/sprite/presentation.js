/**
 * 桌面端表现层工厂：按 kind 给出可挂载的 PetPresentation。
 *
 * video 仍走 sprite 上的 videoA/videoB。
 * 加载顺序：three vendor → model3d presentation；spine vendors → spine presentations → 本文件。
 * @module dsh-pet/runtime/electron-helper/sprite-presentation
 */
'use strict';

/**
 * @param {'video'|'spine'|'model3d'|string} kind
 * @param {object} [opts]
 * @returns {PetPresentation|null}
 */
function createPresentation(kind, opts) {
  if (kind === 'model3d') return createModel3dPresentation(opts);
  if (kind !== 'spine') return null;
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
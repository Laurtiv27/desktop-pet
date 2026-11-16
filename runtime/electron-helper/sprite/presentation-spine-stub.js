/**
 * 骨骼表现层 Canvas 占位：无 Spine runtime 时也能把 clip 名画上舞台，供管线联调。
 *
 * 须在 presentation.js 之前加载。不碰 videoA/B。
 * @module dsh-pet/runtime/electron-helper/sprite-presentation-spine-stub
 */
'use strict';

/**
 * @typedef {object} PetPresentation
 * @property {(parent: Element) => void} mount
 * @property {(clip: string, opts?: { loop?: boolean }) => void} play
 * @property {(facing: 'left'|'right') => void} setFacing
 * @property {() => void} dispose
 */

/**
 * 半透明色块 + 居中 clip 名的 Canvas stub。
 *
 * @param {object} [_opts]
 * @returns {PetPresentation}
 */
function createSpineStubPresentation(_opts) {
  let canvas = null;
  let clip = '';
  let facing = 'left';
  const pres = {
    loop: false,
    mount(parent) {
      if (canvas) pres.dispose();
      canvas = document.createElement('canvas');
      canvas.className = 'pet-spine-stub';
      parent.appendChild(canvas);
      const w = Math.max(1, parent.clientWidth || canvas.clientWidth || 320);
      const h = Math.max(1, parent.clientHeight || canvas.clientHeight || 180);
      canvas.width = w;
      canvas.height = h;
      applyFacing();
      paint();
    },
    play(nextClip, options) {
      clip = nextClip == null ? '' : String(nextClip);
      pres.loop = !!(options && options.loop);
      paint();
    },
    setFacing(dir) {
      facing = dir === 'right' ? 'right' : 'left';
      applyFacing();
    },
    dispose() {
      if (!canvas) return;
      canvas.remove();
      canvas = null;
    },
  };

  function applyFacing() {
    if (!canvas) return;
    canvas.style.transform = facing === 'right' ? 'scaleX(-1)' : '';
  }

  function paint() {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(80, 140, 200, 0.45)';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = Math.max(14, Math.round(h * 0.12)) + 'px sans-serif';
    ctx.fillText(clip, w / 2, h / 2);
  }

  return pres;
}

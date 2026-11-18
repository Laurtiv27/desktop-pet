/**
 * Spine 3.8 WebGL 表现层（全局 `spine38`，与 4.x `spine` 并存）。
 * 用于旧版导出（如 3.8.55 立绘包）；API 走 spine38.webgl.*。
 *
 * @module dsh-pet/runtime/electron-helper/sprite-presentation-spine-38
 */
'use strict';

console.info(
  '[dsh-pet] presentation-spine-38.js 已执行',
  'spine38=',
  !!(typeof window !== 'undefined' && window.spine38),
  'spine=',
  typeof spine,
  'spine.webgl=',
  typeof spine !== 'undefined' && !!(spine && spine.webgl),
);

/**
 * @param {object} [opts]
 * @param {string} [opts.assetBase]
 * @param {object} [opts.pet]
 * @returns {PetPresentation|null}
 */
function createSpine38Presentation(opts) {
  const api =
    typeof window !== 'undefined' && window.spine38
      ? window.spine38
      : typeof spine38 !== 'undefined'
        ? spine38
        : null;
  if (!api || !api.webgl || typeof api.webgl.AssetManager !== 'function') {
    console.warn('[dsh-pet] Spine 3.8 API 不可用', {
      hasWindow: typeof window !== 'undefined',
      hasSpine38: !!(typeof window !== 'undefined' && window.spine38),
      hasWebgl: !!(api && api.webgl),
    });
    return null;
  }

  const meta = opts && opts.pet && opts.pet.spine && opts.pet.spine.meta;
  // 3.8 AssetManager：pathPrefix 只加在 atlas/skel 路径上，图集里的 png 用「atlas 相对目录」。
  // 所以不能 pathPrefix='./spine-demo/' + 裸文件名——png 会落到页面根目录 404。
  // 正确：pathPrefix 空，skel/atlas 带目录前缀（与官方 example 一致）。
  const assetDir = ((opts && opts.assetBase) || './spine-demo/').replace(/\/?$/, '/');
  const skeletonName =
    (meta && typeof meta.skeleton === 'string' && meta.skeleton.trim()) || 'skeleton.skel';
  const atlasName =
    (meta && typeof meta.atlas === 'string' && meta.atlas.trim()) || 'skeleton.atlas';
  const skeletonFile = assetDir + skeletonName.replace(/^\.\//, '');
  const atlasFile = assetDir + atlasName.replace(/^\.\//, '');
  const useJson = /\.json$/i.test(skeletonFile);

  let canvas = null;
  let gl = null;
  let assetManager = null;
  let skeleton = null;
  let animationState = null;
  let shader = null;
  let batcher = null;
  let skeletonRenderer = null;
  let mvp = null;
  let raf = null;
  let lastMs = 0;
  let facing = 'left';
  // 启动即按循环待机；真实 clip 名由 playIdle → play() 再映射覆盖
  let pendingClip = { name: 'skin01_idle', loop: true };
  let ready = false;
  let disposed = false;
  let loadFailed = false;
  let boundsOffset = null;
  let boundsSize = null;

  const pres = {
    loop: true,
    clipDurationSec: 0,
    mount(parent) {
      if (disposed) return;
      if (canvas) pres.dispose();
      disposed = false;
      canvas = document.createElement('canvas');
      canvas.className = 'pet-spine';
      parent.appendChild(canvas);
      resize();
      gl = canvas.getContext('webgl', {
        alpha: true,
        premultipliedAlpha: false,
        antialias: true,
      });
      if (!gl) {
        console.warn('[dsh-pet] WebGL 不可用，Spine 3.8 表现层无法启动');
        return;
      }
      shader = api.webgl.Shader.newTwoColoredTextured(gl);
      batcher = new api.webgl.PolygonBatcher(gl);
      skeletonRenderer = new api.webgl.SkeletonRenderer(gl);
      mvp = new api.webgl.Matrix4();
      assetManager = new api.webgl.AssetManager(gl, '');
      if (useJson) assetManager.loadText(skeletonFile);
      else assetManager.loadBinary(skeletonFile);
      assetManager.loadTextureAtlas(atlasFile);
      console.info('[dsh-pet] Spine 3.8 加载', skeletonFile, atlasFile);
      lastMs = performance.now();
      raf = requestAnimationFrame(tick);
    },
    play(clip, options) {
      const name = clip == null ? 'idle' : String(clip);
      const loop = !!(options && options.loop);
      pendingClip = { name, loop };
      pres.loop = loop;
      if (ready && animationState) tryApplyClip();
    },
    setFacing(dir) {
      facing = dir === 'right' ? 'right' : 'left';
      applyFacingAndFit();
    },
    dispose() {
      disposed = true;
      if (raf != null) {
        cancelAnimationFrame(raf);
        raf = null;
      }
      ready = false;
      skeleton = null;
      animationState = null;
      if (batcher && batcher.dispose) batcher.dispose();
      if (shader && shader.dispose) shader.dispose();
      batcher = null;
      shader = null;
      skeletonRenderer = null;
      mvp = null;
      assetManager = null;
      gl = null;
      if (canvas) {
        canvas.remove();
        canvas = null;
      }
    },
  };

  function resize() {
    if (!canvas || !canvas.parentElement) return;
    const parent = canvas.parentElement;
    const w = Math.max(1, parent.clientWidth || 320);
    const h = Math.max(1, parent.clientHeight || 320);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      applyFacingAndFit();
    }
  }

  function tryFinishLoad() {
    if (loadFailed || ready) return false;
    if (!assetManager || !assetManager.isLoadingComplete()) return false;
    if (assetManager.hasErrors()) {
      loadFailed = true;
      console.warn('[dsh-pet] Spine 3.8 资源加载失败', assetManager.getErrors());
      return false;
    }
    try {
      const atlas = assetManager.get(atlasFile);
      const atlasLoader = new api.AtlasAttachmentLoader(atlas);
      let data;
      if (useJson) {
        const json = new api.SkeletonJson(atlasLoader);
        json.scale = 1;
        data = json.readSkeletonData(assetManager.get(skeletonFile));
      } else {
        const binary = new api.SkeletonBinary(atlasLoader);
        binary.scale = 1;
        data = binary.readSkeletonData(assetManager.get(skeletonFile));
      }
      skeleton = new api.Skeleton(data);
      boundsOffset = new api.Vector2();
      boundsSize = new api.Vector2();
      const stateData = new api.AnimationStateData(data);
      stateData.defaultMix = 0.2;
      animationState = new api.AnimationState(stateData);
      ready = true;
      tryApplyClip();
      animationState.update(0);
      animationState.apply(skeleton);
      skeleton.updateWorldTransform();
      applyFacingAndFit();
      return true;
    } catch (err) {
      loadFailed = true;
      console.warn('[dsh-pet] Spine 3.8 骨架初始化失败', err);
      return false;
    }
  }

  function tryApplyClip() {
    if (!animationState || !skeleton) return;
    const { name, loop } = pendingClip;
    let anim = skeleton.data.findAnimation(name);
    if (!anim) {
      anim =
        skeleton.data.findAnimation('skin01_idle') ||
        skeleton.data.findAnimation('skin00_idle') ||
        skeleton.data.animations[0] ||
        null;
      console.warn(
        '[dsh-pet] 缺少 Spine 动画: ' + name + '，回落 ' + ((anim && anim.name) || '(无)'),
      );
      if (!anim) return;
    }
    animationState.setAnimationWith(0, anim, loop);
    pres.clipDurationSec = anim.duration || 1;
  }

  function applyFacingAndFit() {
    if (!skeleton || !canvas || !boundsOffset || !boundsSize || !mvp) return;
    const w = canvas.width;
    const h = canvas.height;
    skeleton.scaleX = 1;
    skeleton.scaleY = 1;
    skeleton.x = 0;
    skeleton.y = 0;
    skeleton.updateWorldTransform();
    skeleton.getBounds(boundsOffset, boundsSize, []);
    const bw = Math.max(1, boundsSize.x);
    const bh = Math.max(1, boundsSize.y);
    const pad = 0.82;
    const fit = Math.min((w * pad) / bw, (h * pad) / bh);
    const sx = facing === 'left' ? -fit : fit;
    skeleton.scaleX = sx;
    skeleton.scaleY = Math.abs(fit);
    const cx = boundsOffset.x + boundsSize.x / 2;
    const cy = boundsOffset.y + boundsSize.y / 2;
    skeleton.x = w / 2 - cx * sx;
    skeleton.y = h / 2 - cy * Math.abs(fit) - h * 0.04;
    mvp.ortho2d(0, 0, w - 1, h - 1);
  }

  function tick(now) {
    if (disposed || !canvas) return;
    raf = requestAnimationFrame(tick);
    resize();
    if (!ready) {
      if (assetManager) tryFinishLoad();
      clearTransparent();
      return;
    }
    const dt = Math.min(0.05, Math.max(0, (now - lastMs) / 1000));
    lastMs = now;
    animationState.update(dt);
    animationState.apply(skeleton);
    skeleton.updateWorldTransform();
    clearTransparent();
    if (!shader || !batcher || !skeletonRenderer || !mvp || !gl) return;
    shader.bind();
    shader.setUniformi(api.webgl.Shader.SAMPLER, 0);
    shader.setUniform4x4f(api.webgl.Shader.MVP_MATRIX, mvp.values);
    batcher.begin(shader);
    skeletonRenderer.premultipliedAlpha = false;
    skeletonRenderer.draw(batcher, skeleton);
    batcher.end();
    shader.unbind();
  }

  function clearTransparent() {
    if (!gl || !canvas) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  return pres;
}

// 显式挂到 window，避免个别环境下函数声明未进全局导致工厂回落到 4.x
if (typeof window !== 'undefined') {
  window.createSpine38Presentation = createSpine38Presentation;
}

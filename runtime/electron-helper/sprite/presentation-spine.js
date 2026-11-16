/**
 * 真·Spine WebGL 表现层：加载 atlas/skel，按 clip 名播 AnimationState。
 * 依赖先加载的 vendor/spine-webgl.iife.js（全局 `spine`）。
 * 加载失败时调用方应回落 stub。
 *
 * @module dsh-pet/runtime/electron-helper/sprite-presentation-spine
 */
'use strict';

/**
 * @param {object} [opts]
 * @param {{ root?: string }} [opts.pet]
 * @param {string} [opts.assetBase] 资源目录 URL（默认相对页面 ./spine-demo/）
 * @returns {PetPresentation|null} 无 spine 运行时则 null
 */
function createSpineWebglPresentation(opts) {
  const api = typeof spine !== 'undefined' ? spine : null;
  if (!api || typeof api.AssetManager !== 'function') return null;

  const assetBase = (opts && opts.assetBase) || './spine-demo/';

  let canvas = null;
  let gl = null;
  let renderer = null;
  let assetManager = null;
  let skeleton = null;
  let animationState = null;
  let raf = null;
  let lastMs = 0;
  let facing = 'left';
  let pendingClip = { name: 'idle', loop: true };
  let ready = false;
  let disposed = false;

  const pres = {
    loop: true,
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
        premultipliedAlpha: true,
        antialias: true,
      });
      if (!gl) {
        console.warn('[dsh-pet] WebGL 不可用，骨骼表现层无法启动');
        return;
      }
      renderer = new api.SceneRenderer(canvas, gl);
      assetManager = new api.AssetManager(gl, assetBase);
      // AssetManager 的 pathPrefix 已是 assetBase；load 路径用文件名即可
      assetManager.loadBinary('spineboy-pro.skel');
      assetManager.loadTextureAtlas('spineboy-pma.atlas');
      lastMs = performance.now();
      raf = requestAnimationFrame(tick);
    },
    play(clip, options) {
      const name = clip == null ? 'idle' : String(clip);
      const loop = !!(options && options.loop);
      pendingClip = { name, loop };
      pres.loop = loop;
      if (ready && animationState) {
        tryApplyClip();
      }
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
      renderer = null;
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
      if (renderer) renderer.resize(api.ResizeMode.Expand);
    }
  }

  function tryFinishLoad() {
    if (!assetManager || !assetManager.isLoadingComplete()) return false;
    if (assetManager.hasErrors()) {
      console.warn('[dsh-pet] Spine 资源加载失败', assetManager.getErrors());
      return false;
    }
    try {
      const atlas = assetManager.require('spineboy-pma.atlas');
      const atlasLoader = new api.AtlasAttachmentLoader(atlas);
      const binary = new api.SkeletonBinary(atlasLoader);
      binary.scale = 1;
      const data = binary.readSkeletonData(assetManager.require('spineboy-pro.skel'));
      skeleton = new api.Skeleton(data);
      const stateData = new api.AnimationStateData(data);
      stateData.defaultMix = 0.15;
      animationState = new api.AnimationState(stateData);
      ready = true;
      applyFacingAndFit();
      tryApplyClip();
      return true;
    } catch (err) {
      console.warn('[dsh-pet] Spine 骨架初始化失败', err);
      return false;
    }
  }

  function tryApplyClip() {
    if (!animationState || !skeleton) return;
    const { name, loop } = pendingClip;
    const anim = skeleton.data.findAnimation(name);
    if (!anim) {
      console.warn('[dsh-pet] 缺少 Spine 动画: ' + name + '，回落 idle');
      animationState.setAnimation(0, 'idle', true);
      return;
    }
    animationState.setAnimation(0, name, loop);
  }

  function applyFacingAndFit() {
    if (!skeleton || !canvas) return;
    const w = canvas.width;
    const h = canvas.height;
    // spineboy 默认朝右；桌宠 left = 朝左 → 负 scaleX
    const fit = Math.min(w, h) / 420;
    const sx = facing === 'left' ? -fit : fit;
    skeleton.scaleX = sx;
    skeleton.scaleY = Math.abs(fit);
    skeleton.x = w * 0.5;
    skeleton.y = h * 0.92;
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
    if (typeof api.Physics !== 'undefined' && api.Physics.update != null) {
      skeleton.updateWorldTransform(api.Physics.update);
    } else {
      skeleton.updateWorldTransform();
    }
    clearTransparent();
    if (!renderer) return;
    renderer.resize(api.ResizeMode.Expand);
    renderer.begin();
    renderer.drawSkeleton(skeleton, true);
    renderer.end();
  }

  function clearTransparent() {
    if (!gl || !canvas) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  return pres;
}

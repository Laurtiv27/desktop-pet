/**
 * 真·Spine WebGL 表现层：加载 atlas/skel，按 clip 名播 AnimationState。
 * 依赖先加载的 vendor/spine-webgl.iife.js（全局 `spine`）。
 *
 * @module dsh-pet/runtime/electron-helper/sprite-presentation-spine
 */
'use strict';

/**
 * @param {object} [opts]
 * @param {string} [opts.assetBase] 资源目录 URL（默认相对页面 ./spine-demo/）
 * @returns {PetPresentation|null}
 */
function createSpineWebglPresentation(opts) {
  const api = typeof spine !== 'undefined' ? spine : null;
  if (!api || typeof api.AssetManager !== 'function') return null;

  const meta = opts && opts.pet && opts.pet.spine && opts.pet.spine.meta;
  const assetBase = (opts && opts.assetBase) || './spine-demo/';
  const skeletonFile =
    (meta && typeof meta.skeleton === 'string' && meta.skeleton.trim()) || 'spineboy-pro.skel';
  const atlasFile =
    (meta && typeof meta.atlas === 'string' && meta.atlas.trim()) || 'spineboy-pma.atlas';
  const useJson = /\.json$/i.test(skeletonFile);

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
  let boundsOffset = null;
  let boundsSize = null;

  const pres = {
    loop: true,
    /** 当前动画时长（秒），供 runner 估 clip-end；未就绪为 0 */
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
        premultipliedAlpha: true,
        antialias: true,
      });
      if (!gl) {
        console.warn('[dsh-pet] WebGL 不可用，骨骼表现层无法启动');
        return;
      }
      renderer = new api.SceneRenderer(canvas, gl);
      assetManager = new api.AssetManager(gl, assetBase);
      if (useJson) assetManager.loadText(skeletonFile);
      else assetManager.loadBinary(skeletonFile);
      assetManager.loadTextureAtlas(atlasFile);
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

  let loadFailed = false;
  function tryFinishLoad() {
    if (loadFailed || ready) return false;
    if (!assetManager || !assetManager.isLoadingComplete()) return false;
    if (assetManager.hasErrors()) {
      loadFailed = true;
      console.warn('[dsh-pet] Spine 资源加载失败', assetManager.getErrors());
      return false;
    }
    try {
      const atlas = assetManager.require(atlasFile);
      const atlasLoader = new api.AtlasAttachmentLoader(atlas);
      let data;
      if (useJson) {
        const json = new api.SkeletonJson(atlasLoader);
        json.scale = 1;
        data = json.readSkeletonData(assetManager.require(skeletonFile));
      } else {
        const binary = new api.SkeletonBinary(atlasLoader);
        binary.scale = 1;
        data = binary.readSkeletonData(assetManager.require(skeletonFile));
      }
      skeleton = new api.Skeleton(data);
      boundsOffset = new api.Vector2();
      boundsSize = new api.Vector2();
      const stateData = new api.AnimationStateData(data);
      stateData.defaultMix = 0.2;
      animationState = new api.AnimationState(stateData);
      ready = true;
      tryApplyClip();
      // 先播一帧再量包围盒，避免 idle 未 apply 时尺寸不准
      animationState.update(0);
      animationState.apply(skeleton);
      updateWorld();
      applyFacingAndFit();
      return true;
    } catch (err) {
      loadFailed = true;
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
      const idleAnim = skeleton.data.findAnimation('idle');
      pres.clipDurationSec = (idleAnim && idleAnim.duration) || 1;
      return;
    }
    animationState.setAnimation(0, name, loop);
    pres.clipDurationSec = anim.duration || 1;
  }

  function updateWorld() {
    if (!skeleton) return;
    if (typeof api.Physics !== 'undefined' && api.Physics.update != null) {
      skeleton.updateWorldTransform(api.Physics.update);
    } else {
      skeleton.updateWorldTransform();
    }
  }

  function applyFacingAndFit() {
    if (!skeleton || !canvas || !boundsOffset || !boundsSize) return;
    const w = canvas.width;
    const h = canvas.height;
    // 先按单位缩放量包围盒（临时 scale=1）
    skeleton.scaleX = 1;
    skeleton.scaleY = 1;
    skeleton.x = 0;
    skeleton.y = 0;
    updateWorld();
    skeleton.getBounds(boundsOffset, boundsSize, []);
    const bw = Math.max(1, boundsSize.x);
    const bh = Math.max(1, boundsSize.y);
    // 留边：头脚都不要贴边裁切
    const pad = 0.82;
    const fit = Math.min((w * pad) / bw, (h * pad) / bh);
    const sx = facing === 'left' ? -fit : fit;
    skeleton.scaleX = sx;
    skeleton.scaleY = Math.abs(fit);
    // OrthoCamera 中心在 (0,0)、Y 向上：把包围盒中心对齐视口中心略偏下
    const cx = boundsOffset.x + boundsSize.x / 2;
    const cy = boundsOffset.y + boundsSize.y / 2;
    skeleton.x = -cx * sx;
    skeleton.y = -cy * Math.abs(fit) - h * 0.04;
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
    updateWorld();
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

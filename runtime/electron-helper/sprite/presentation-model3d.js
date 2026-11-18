/**
 * 三维表现层：透明 canvas 上加载 glTF，并用 AnimationMixer 循环槽位动画。
 *
 * 依赖 index.html 先载入 vendor/three-gltf.iife.js（window.THREE / window.GLTFLoader）。
 * opts.assetBase 应以 /model3d/<assetId>/ 结尾；槽位经 meta.clips 映射到 glTF 动画名。
 * @module dsh-pet/runtime/electron-helper/sprite-presentation-model3d
 */
'use strict';

function createModel3dPresentation(opts) {
  const THREE = window.THREE;
  const GLTFLoader = window.GLTFLoader;
  if (!THREE || !GLTFLoader) {
    console.warn('[dsh-pet] Three.js vendor 未加载');
    return null;
  }
  const meta = (opts && opts.pet && opts.pet.model3d && opts.pet.model3d.meta) || {};
  const assetId =
    (opts && opts.pet && opts.pet.model3d && opts.pet.model3d.assetId) ||
    (opts && opts.pet && opts.pet.id) ||
    'model3d-demo';
  let renderer;
  let scene;
  let camera;
  let root;
  let mixer;
  let clock;
  let raf;
  let disposed = false;
  let clipsByName = null;
  let pendingPlay = null;
  let presentation;
  let currentAction = null;
  let paused = false;
  let modelRoot = null;
  let modelBaseY = 0;
  let proceduralIdle = false;
  let proceduralT = 0;
  const state = { facing: 'left', loop: true, currentClip: '', onEnded: null };

  function mount(parent) {
    const canvas = document.createElement('canvas');
    canvas.className = 'pet-model3d';
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
    parent.appendChild(canvas);
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: false });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    scene = new THREE.Scene();
    const cam = meta.camera || { kind: 'perspective', fov: 35, distance: 4 };
    const w = parent.clientWidth || 462;
    const h = parent.clientHeight || Math.round((462 * 9) / 16);
    if (cam.kind === 'ortho') {
      const fr = cam.frustum || 2;
      camera = new THREE.OrthographicCamera(-fr, fr, (fr * h) / w, (-fr * h) / w, 0.1, 100);
    } else {
      camera = new THREE.PerspectiveCamera(cam.fov || 35, w / h, 0.1, 100);
    }
    camera.position.set(0, 1.2, cam.distance || 4);
    camera.lookAt(0, 0.8, 0);
    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const dir = new THREE.DirectionalLight(0xffffff, 0.65);
    dir.position.set(2, 4, 3);
    scene.add(dir);
    root = new THREE.Group();
    scene.add(root);
    renderer.setSize(w, h, false);
    clock = new THREE.Clock();
    let lastRenderSec = 0;
    const frameInterval = 1 / 30;
    const loop = () => {
      if (disposed) return;
      raf = requestAnimationFrame(loop);
      const dt = clock.getDelta();
      // 冻结时仍抽干 clock，避免解冻第一帧把整段暂停时长灌进 mixer。
      if (mixer && !paused) mixer.update(dt);
      if (proceduralIdle && modelRoot && !paused) {
        // 素材只有单关键帧「假动画」时：轻微呼吸起伏，避免完全冻尸。
        proceduralT += dt;
        modelRoot.position.y = modelBaseY + Math.sin(proceduralT * 2.1) * 0.012;
      }
      const hidden = typeof document !== 'undefined' && document.hidden;
      if (paused || hidden) return;
      const nowSec = performance.now() / 1000;
      if (nowSec - lastRenderSec < frameInterval) return;
      lastRenderSec = nowSec;
      renderer.render(scene, camera);
    };
    loop();
    loadModel();
  }

  function loadModel() {
    const base = ((opts && opts.assetBase) || '').replace(/\/?$/, '/');
    const glbName = meta.glb || 'character.glb';
    const url = base + encodeURIComponent(glbName).replace(/%2F/gi, '/');
    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => {
        if (disposed) return;
        const model = gltf.scene;
        const s = typeof meta.scale === 'number' ? meta.scale : 1;
        model.scale.setScalar(s);
        if (meta.pivot) model.position.set(meta.pivot.x || 0, meta.pivot.y || 0, meta.pivot.z || 0);
        root.add(model);
        modelRoot = model;
        modelBaseY = model.position.y || 0;
        // 按包围盒重取景：不同 Sketchfab/DCC 导出尺度差很大，固定 lookAt 会裁头或只剩脚。
        if (camera && typeof THREE.Box3 === 'function') {
          const box = new THREE.Box3().setFromObject(model);
          if (!box.isEmpty()) {
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());
            const height = Math.max(size.y, 0.01);
            const baseDist = (meta.camera && meta.camera.distance) || 4;
            const dist = Math.max(baseDist, height * 2.1, size.x * 1.4, size.z * 1.4);
            const eyeY = center.y + height * 0.08;
            camera.position.set(center.x, eyeY, center.z + dist);
            camera.lookAt(center.x, center.y, center.z);
            camera.updateProjectionMatrix();
          }
        }
        mixer = new THREE.AnimationMixer(model);
        mixer.timeScale = paused ? 0 : 1;
        mixer.addEventListener('finished', onClipFinished);
        clipsByName = Object.create(null);
        for (const c of gltf.animations || []) clipsByName[c.name] = c;
        presentation._clipsByName = clipsByName;
        presentation._mixer = mixer;
        const queued = pendingPlay;
        pendingPlay = null;
        if (queued) play(queued.slot, queued.playOpts);
        else play('idle', { loop: true });
        // 模型到达前 setFacing 只记下方向；根节点出现后补一次，避免起步朝向丢在加载窗口里。
        setFacing(state.facing);
      },
      undefined,
      (err) => console.warn('[dsh-pet] model3d 加载失败', assetId, err),
    );
  }

  function lookupClip(name) {
    if (!name || !clipsByName) return null;
    return clipsByName[name] || null;
  }

  function resolveClip(slotOrName) {
    const clips = meta.clips || {};
    const mapped = typeof clips[slotOrName] === 'string' ? clips[slotOrName] : '';
    const direct = lookupClip(mapped) || (!mapped ? lookupClip(slotOrName) : null);
    if (direct) return direct;
    const idleName = typeof clips.idle === 'string' && clips.idle ? clips.idle : '';
    if (!idleName || slotOrName === 'idle' || mapped === idleName) return null;
    return lookupClip(idleName);
  }

  function onClipFinished(event) {
    if (state.loop) return;
    if (event && event.action && currentAction && event.action !== currentAction) return;
    const cb = state.onEnded;
    state.onEnded = null;
    if (typeof cb === 'function') {
      cb();
      return;
    }
    const sprite = opts && opts.sprite;
    if (sprite && typeof sprite.handleEnded === 'function') sprite.handleEnded();
  }

  function setPaused(next) {
    paused = !!next;
    if (mixer) mixer.timeScale = paused ? 0 : 1;
  }

  function play(slotOrName, playOpts) {
    const loop = !!(playOpts && playOpts.loop);
    state.loop = loop;
    state.currentClip = slotOrName || '';
    state.onEnded = playOpts && typeof playOpts.onEnded === 'function' ? playOpts.onEnded : null;
    if (!mixer || !clipsByName) {
      pendingPlay = { slot: slotOrName, playOpts };
      return;
    }
    const clip = resolveClip(slotOrName);
    if (!clip) {
      state.onEnded = null;
      currentAction = null;
      mixer.stopAllAction();
      proceduralIdle = true;
      console.warn('[dsh-pet] model3d 未找到动画', slotOrName, '→ 程序待机');
      return;
    }
    // Sketchfab 部分转换 GLB 会带「动画名」但只有 1 个关键帧（duration≈0），看起来像没动作。
    if (!(clip.duration > 0.05)) {
      mixer.stopAllAction();
      currentAction = null;
      proceduralIdle = true;
      console.warn(
        '[dsh-pet] model3d 动画无有效时长 name=' +
          clip.name +
          ' duration=' +
          clip.duration +
          ' → 程序待机（请换带真实 idle/walk 的 GLB）',
      );
      return;
    }
    proceduralIdle = false;
    if (modelRoot) modelRoot.position.y = modelBaseY;
    mixer.stopAllAction();
    const action = mixer.clipAction(clip);
    currentAction = action;
    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
    action.play();
  }

  function setFacing(dir) {
    state.facing = dir;
    if (!root) return;
    const mode = meta.facingMode === 'turnClip' ? 'turnClip' : 'mirror';
    if (mode === 'mirror') {
      root.scale.x = Math.abs(root.scale.x || 1) * (dir === 'right' ? -1 : 1);
    } else {
      root.rotation.y = dir === 'right' ? Math.PI : 0;
    }
  }

  function dispose() {
    disposed = true;
    pendingPlay = null;
    if (raf) cancelAnimationFrame(raf);
    if (mixer) mixer.stopAllAction();
    if (renderer) {
      renderer.dispose();
      if (renderer.domElement && renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    }
  }

  presentation = {
    mount,
    play,
    setFacing,
    setPaused,
    dispose,
    _clipsByName: null,
    _mixer: null,
    /** @internal */
    _debug: {
      get root() {
        return root;
      },
      get scene() {
        return scene;
      },
    },
  };
  return presentation;
}

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
  const state = { facing: 'left', loop: true, currentClip: '' };

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
    const loop = () => {
      if (disposed) return;
      raf = requestAnimationFrame(loop);
      const dt = clock.getDelta();
      if (mixer) mixer.update(dt);
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
        mixer = new THREE.AnimationMixer(model);
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

  function play(slotOrName, playOpts) {
    const loop = !!(playOpts && playOpts.loop);
    state.loop = loop;
    state.currentClip = slotOrName || '';
    if (!mixer || !clipsByName) {
      pendingPlay = { slot: slotOrName, playOpts };
      return;
    }
    const clip = resolveClip(slotOrName);
    if (!clip) {
      mixer.stopAllAction();
      console.warn('[dsh-pet] model3d 未找到动画', slotOrName);
      return;
    }
    mixer.stopAllAction();
    const action = mixer.clipAction(clip);
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

/**
 * 三维表现层：透明 canvas 空舞台。
 *
 * 依赖 index.html 先载入 vendor/three-gltf.iife.js（window.THREE / window.GLTFLoader）。
 * 本任务只挂载清空的透明场景；GLB 与 AnimationMixer 由后续任务接入。
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
  let renderer;
  let scene;
  let camera;
  let root;
  let mixer;
  let clock;
  let raf;
  let disposed = false;
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
  }

  function play(clip, playOpts) {
    state.loop = !!(playOpts && playOpts.loop);
    state.currentClip = clip;
    // Task 5 接 AnimationMixer；此处允许空操作
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
    if (raf) cancelAnimationFrame(raf);
    if (mixer) mixer.stopAllAction();
    if (renderer) {
      renderer.dispose();
      if (renderer.domElement && renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    }
  }

  return {
    mount,
    play,
    setFacing,
    dispose,
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
}

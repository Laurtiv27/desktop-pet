# 3D 骨骼桌宠（model3d）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Electron 透明窗内以 Three.js + glTF 渲染一只可待机循环、走路位移、拖拽的 3D 桌宠，并与现有 webm 宠双轨共存。

**Architecture:** 与 Spine 规格同构的 Intent/Planner 与可插拔 Presentation；桌面端 `Model3dPresentation`（Three.js IIFE vendor + 表现层脚本），按 `walkSpeedPx` 驱动现有 `sendBounds`。已与 Spine 表现层一并合入 `main`。

**Tech Stack:** Electron helper（classic script）、Three.js r170+（bundled IIFE）、glTF/GLB、Node 测试（`node --test`）、现有 `shared-core` / `PetSprite`。

## Global Constraints

- 分支：已合入 `main`；Spine / model3d 运行时并存、互不替代
- `presentation` 缺省 `"video"`；联合类型含 `"spine"` 但本计划**不实现** Spine
- `idle` **必须循环**；`autoBehavior === false` 时禁止随机漫游
- 固定机位；朝向默认 `facingMode: "mirror"`
- 加载失败不拖垮进程；commit message 用中文 Conventional Commits（`feat:` / `fix:` / `docs:` / `test:` / `chore:`）
- 包内素材路径：`assets/model3d/<petId>/`；HTTP：`/dsh-pet-7340/model3d/<petId>/<file>`
- 演示宠 id：`model3d-demo`；首版 GLB：Khronos Sample Models **Fox**（动画名映射见 Task 5）

---

## File Structure

| 路径 | 职责 |
|------|------|
| `src/shared/behavior/types.ts` | `PetIntent` / `PresentationKind` / 优先级 |
| `src/shared/behavior/model3d-meta.ts` | 解析 `meta.json` |
| `src/shared/behavior/validate-intent.ts` | Intent 白名单校验 |
| `src/shared/behavior/planner.ts` | 补 walk / 产出 Plan |
| `src/shared/behavior/pet-presentation.ts` | `normalizePresentation` / stub animations |
| `src/shared/behavior/index.ts` | 再导出 |
| `src/shared/types.ts` | `Pet.presentation` / `Pet.model3d` |
| `src/shared/index.ts` | export behavior |
| `src/host/http.ts` | MIME `.glb` / `.gltf` / `.bin` |
| `src/host/routes/assets.ts` | `model3d` scope 静态服务 |
| `scripts/vendor-three-model3d.mjs` | 把 three+GLTFLoader 打成 IIFE |
| `scripts/vendor/model3d-three-entry.mjs` | vendor 入口 |
| `runtime/electron-helper/vendor/three-gltf.iife.js` | 生成物（`window.THREE` + `window.GLTFLoader`） |
| `runtime/electron-helper/sprite/presentation-model3d.js` | Model3dPresentation |
| `runtime/electron-helper/sprite/presentation.js` | `createPresentation` 工厂 |
| `runtime/electron-helper/sprite/behavior-runner.js` | Intent → play + speed move |
| `runtime/electron-helper/sprite/{init,playback,motion}.js` | 挂载、idle、速度位移 |
| `runtime/electron-helper/index.html` | 脚本顺序 + canvas CSS |
| `assets/model3d/model3d-demo/*` | GLB + meta.json |
| `docs/model3d-presentation.md` | 启用方式与素材署名 |

---

### Task 1: model3d meta 解析 + Presentation 类型归一化

**Files:**
- Create: `src/shared/behavior/types.ts`
- Create: `src/shared/behavior/model3d-meta.ts`
- Create: `src/shared/behavior/model3d-meta.test.ts`
- Create: `src/shared/behavior/pet-presentation.ts`
- Create: `src/shared/behavior/pet-presentation.test.ts`
- Create: `src/shared/behavior/index.ts`
- Modify: `src/shared/types.ts`（`Pet` 增加字段）
- Modify: `src/shared/index.ts`（`export * from './behavior/index.ts'`）

**Interfaces:**
- Produces: `PresentationKind = 'video' | 'spine' | 'model3d'`
- Produces: `Model3dMeta`、`parseModel3dMeta(raw): Model3dMeta | null`
- Produces: `normalizePresentation(raw): PresentationKind`（仅 `'spine'|'model3d'` 原样，其余 `'video'`）
- Produces: `resolvePetPlaybackSetup(pet)`（model3d 缺 animations 时用 stub）

- [ ] **Step 1: 写失败测试 `parseModel3dMeta`**

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseModel3dMeta, DEFAULT_WALK_SPEED_PX } from './model3d-meta.ts';

test('合法 meta 解析 clips/scale/camera/facingMode/autoBehavior', () => {
  const m = parseModel3dMeta({
    clips: { idle: 'Survey', walk: 'Walk' },
    walkSpeedPx: 90,
    scale: 0.02,
    pivot: { x: 0, y: 0, z: 0 },
    camera: { kind: 'perspective', fov: 35, distance: 4 },
    facingMode: 'mirror',
    autoBehavior: false,
    glb: 'Fox.glb',
  });
  assert.ok(m);
  assert.equal(m!.clips.idle, 'Survey');
  assert.equal(m!.walkSpeedPx, 90);
  assert.equal(m!.scale, 0.02);
  assert.equal(m!.facingMode, 'mirror');
  assert.equal(m!.autoBehavior, false);
  assert.equal(m!.glb, 'Fox.glb');
});

test('缺 clips 或 clips 全非法 → null', () => {
  assert.equal(parseModel3dMeta({}), null);
  assert.equal(parseModel3dMeta({ clips: { idle: 1 } }), null);
});

test('walkSpeedPx 非法回落默认', () => {
  const m = parseModel3dMeta({ clips: { idle: 'A' }, walkSpeedPx: -1 });
  assert.equal(m!.walkSpeedPx, DEFAULT_WALK_SPEED_PX);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --experimental-strip-types --import ./scripts/test-register.mjs --test src/shared/behavior/model3d-meta.test.ts`  
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `types.ts` + `model3d-meta.ts`**

```ts
// types.ts（节选）
export type PresentationKind = 'video' | 'spine' | 'model3d';
export type ClipSlot = 'idle' | 'walk' | 'turn' | 'sit' | 'wave' | 'happy' | 'drag';
export type IntentSource = 'roam' | 'menu' | 'ai' | 'posture' | 'user';
export type PetIntent = {
  goal?: { xRatio: number; yRatio: number };
  facing?: 'left' | 'right' | 'keep';
  sequence: Array<{
    clip: ClipSlot | string;
    loop?: boolean;
    until?: 'arrive' | 'clip-end' | 'duration';
    durationMs?: number;
  }>;
  priority?: number;
  source: IntentSource;
};
export type PetPlanStep = {
  clip: string;
  loop: boolean;
  until: 'arrive' | 'clip-end' | 'duration';
  durationMs?: number;
  goal?: { xRatio: number; yRatio: number };
};
export type PetPlan = {
  steps: PetPlanStep[];
  facing: 'left' | 'right' | 'keep';
  priority: number;
  source: IntentSource;
};
export const INTENT_PRIORITY: Record<IntentSource, number> = {
  user: 100, menu: 100, posture: 50, ai: 30, roam: 10,
};
```

```ts
// model3d-meta.ts
export type Model3dMeta = {
  clips: Record<string, string>;
  walkSpeedPx: number;
  scale: number;
  pivot: { x: number; y: number; z: number };
  camera: { kind: 'perspective' | 'ortho'; fov?: number; distance: number; frustum?: number };
  facingMode: 'mirror' | 'turnClip';
  autoBehavior?: boolean;
  glb: string;
};
export const DEFAULT_WALK_SPEED_PX = 120;

export function parseModel3dMeta(raw: unknown): Model3dMeta | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.clips !== 'object' || record.clips === null || Array.isArray(record.clips)) return null;
  const clips: Record<string, string> = {};
  for (const [k, v] of Object.entries(record.clips as Record<string, unknown>)) {
    if (typeof v === 'string' && v) clips[k] = v;
  }
  if (Object.keys(clips).length === 0) return null;

  let walkSpeedPx = DEFAULT_WALK_SPEED_PX;
  if (typeof record.walkSpeedPx === 'number' && Number.isFinite(record.walkSpeedPx) && record.walkSpeedPx > 0) {
    walkSpeedPx = record.walkSpeedPx;
  }
  let scale = 1;
  if (typeof record.scale === 'number' && Number.isFinite(record.scale) && record.scale > 0) scale = record.scale;

  const pivot = { x: 0, y: 0, z: 0 };
  if (record.pivot && typeof record.pivot === 'object' && !Array.isArray(record.pivot)) {
    const p = record.pivot as Record<string, unknown>;
    for (const k of ['x', 'y', 'z'] as const) {
      if (typeof p[k] === 'number' && Number.isFinite(p[k])) pivot[k] = p[k];
    }
  }

  let camera: Model3dMeta['camera'] = { kind: 'perspective', fov: 35, distance: 4 };
  if (record.camera && typeof record.camera === 'object' && !Array.isArray(record.camera)) {
    const c = record.camera as Record<string, unknown>;
    const kind = c.kind === 'ortho' ? 'ortho' : 'perspective';
    const distance =
      typeof c.distance === 'number' && Number.isFinite(c.distance) && c.distance > 0 ? c.distance : 4;
    camera = { kind, distance };
    if (kind === 'perspective') {
      camera.fov = typeof c.fov === 'number' && c.fov > 0 ? c.fov : 35;
    } else if (typeof c.frustum === 'number' && c.frustum > 0) {
      camera.frustum = c.frustum;
    }
  }

  const facingMode = record.facingMode === 'turnClip' ? 'turnClip' : 'mirror';
  const glb = typeof record.glb === 'string' && record.glb.trim() ? record.glb.trim() : 'character.glb';
  const out: Model3dMeta = { clips, walkSpeedPx, scale, pivot, camera, facingMode, glb };
  if (record.autoBehavior === false) out.autoBehavior = false;
  else if (record.autoBehavior === true) out.autoBehavior = true;
  return out;
}
```

- [ ] **Step 4: 实现 `pet-presentation.ts` + 测试**

```ts
import type { Animations, Pet } from '../types.ts';
import type { ClipSlot, PresentationKind } from './types.ts';

export function normalizePresentation(raw: unknown): PresentationKind {
  if (raw === 'spine') return 'spine';
  if (raw === 'model3d') return 'model3d';
  return 'video';
}

export function createModel3dAnimationStub(clips?: unknown): Animations {
  let idle = 'idle';
  if (clips && typeof clips === 'object' && !Array.isArray(clips)) {
    const v = (clips as Record<string, unknown>).idle;
    if (typeof v === 'string' && v) idle = v;
  }
  return {
    idle: [idle],
    turn: [],
    drag: [],
    clicks: [],
    moves: { default: {}, actions: [] },
    categories: [],
    events: {},
  };
}

export function mapPresentationClip(
  clip: string,
  clips?: Partial<Record<ClipSlot, string>> | Record<string, string> | null,
): string {
  if (!clips) return clip;
  const mapped = (clips as Record<string, string>)[clip];
  return typeof mapped === 'string' && mapped.length > 0 ? mapped : clip;
}

export type PetPlaybackSetup = {
  kind: PresentationKind;
  animations: Animations;
  usedStub: boolean;
};

export function resolvePetPlaybackSetup(
  pet: Pick<Pet, 'id' | 'presentation' | 'animations' | 'model3d'>,
): PetPlaybackSetup {
  const kind = normalizePresentation(pet.presentation);
  if (pet.animations) return { kind, animations: pet.animations, usedStub: false };
  if (kind === 'model3d') {
    return {
      kind,
      animations: createModel3dAnimationStub(pet.model3d?.meta?.clips),
      usedStub: true,
    };
  }
  throw new Error('宠物缺少 animations 段：' + String(pet.id ?? ''));
}
```

测试要点：`normalizePresentation('model3d') === 'model3d'`；缺 animations 的 model3d 用 stub；video 缺 animations 仍抛。

- [ ] **Step 5: 扩展 `Pet` 类型**

在 `src/shared/types.ts` 的 `Pet` 接口增加：

```ts
  /** 表现后端：缺省 video；spine 类型预留本分支不实现；model3d = Three.js glTF */
  presentation?: 'video' | 'spine' | 'model3d';
  /** 仅 presentation === 'model3d' 时有效 */
  model3d?: {
    /** 相对 /model3d/<assetRoot>/ 的目录名；缺省用 pet.id */
    assetId?: string;
    meta?: import('./behavior/model3d-meta.ts').Model3dMeta;
  };
```

- [ ] **Step 6: 导出并跑测试**

`src/shared/behavior/index.ts`：`export *` 上述模块。  
`src/shared/index.ts` 增加 `export * from './behavior/index.ts'`。

Run: `npm test -- --test-name-pattern="model3d|presentation"`（或直接跑上述两个 test 文件）  
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/shared/behavior src/shared/types.ts src/shared/index.ts
git commit -m "feat: 新增三维表现层元数据与类型归一化"
```

---

### Task 2: Intent 校验 + BehaviorPlanner

**Files:**
- Create: `src/shared/behavior/validate-intent.ts`
- Create: `src/shared/behavior/validate-intent.test.ts`
- Create: `src/shared/behavior/planner.ts`
- Create: `src/shared/behavior/planner.test.ts`
- Modify: `src/shared/behavior/index.ts`

**Interfaces:**
- Consumes: `PetIntent`、`ClipSlot`
- Produces: `validateIntent(intent, allowedClips): {ok:true,intent} | {ok:false,reason}`
- Produces: `planBehavior(input): {ok:true,plan} | {ok:false,reason}`

- [ ] **Step 1: 写 `validateIntent` 失败测试**

覆盖：空 sequence 拒绝；未知 clip 拒绝；非法 xRatio（非有限数 / 越界可按实现：非有限拒绝，越界由 planner 钳制或拒绝——**本计划：goal 的 xRatio/yRatio 必须有限数，否则拒绝**）；合法 intent 通过。

- [ ] **Step 2: 实现 `validateIntent`**

```ts
import type { PetIntent } from './types.ts';

export type ValidateIntentResult =
  | { ok: true; intent: PetIntent }
  | { ok: false; reason: string };

export function validateIntent(
  intent: PetIntent,
  allowedClips: Set<string>,
): ValidateIntentResult {
  if (!intent || !Array.isArray(intent.sequence) || intent.sequence.length === 0) {
    return { ok: false, reason: 'empty-sequence' };
  }
  if (intent.goal) {
    const { xRatio, yRatio } = intent.goal;
    if (!Number.isFinite(xRatio) || !Number.isFinite(yRatio)) {
      return { ok: false, reason: 'invalid-goal' };
    }
  }
  for (const step of intent.sequence) {
    if (!step || typeof step.clip !== 'string' || !step.clip) {
      return { ok: false, reason: 'invalid-clip' };
    }
    if (!allowedClips.has(step.clip)) {
      return { ok: false, reason: 'unknown-clip:' + step.clip };
    }
  }
  return { ok: true, intent };
}
```

- [ ] **Step 3: 写 `planBehavior` 测试**

1. 有 goal 且距离 > 阈值、有 walk → 第一步为 mapped walk + `until:'arrive'` + goal  
2. 已在目标点附近 → 不插入 walk  
3. 校验失败 → `ok:false`  
4. 未知槽位但 allowed 含真实动画名 → 原样通过映射

实现逻辑对齐 Spine 分支 `planner.ts`：`resolveClipName`、距离 `Math.hypot`、阈值默认 `0.01`。

- [ ] **Step 4: 跑测试 PASS 后 Commit**

```bash
git add src/shared/behavior/validate-intent.ts src/shared/behavior/validate-intent.test.ts \
  src/shared/behavior/planner.ts src/shared/behavior/planner.test.ts src/shared/behavior/index.ts
git commit -m "feat: 新增意图校验与行为规划器"
```

---

### Task 3: 静态资源路由 `/model3d/`

**Files:**
- Modify: `src/host/http.ts`（MIME）
- Modify: `src/host/routes/assets.ts`
- Create: `src/host/routes/assets-model3d.test.ts`（或扩展现有 assets 测试）
- Modify: `package.json` → `files` 增加 `"assets/model3d"`

**Interfaces:**
- Produces: `GET /dsh-pet-7340/model3d/<petId>/<file>` → 包内 `assets/model3d/<petId>/<file>`
- 允许扩展名：`.glb` `.gltf` `.bin` `.json` `.png` `.jpg` `.jpeg` `.webp`（gltf 外置贴图）
- `petId` 经 `isValidPetId`；路径经 `resolveExisting`

- [ ] **Step 1: MIME 与路由测试（失败）**

断言：合法 `.glb` 返回 file；`../` 逃逸 400/404；`.exe` 400。

- [ ] **Step 2: 实现**

在 `handleAssetsRoutes` 的 `font`/`sound` 旁增加：

```ts
  if (scope === 'model3d') {
    const [petId, ...nameParts] = restParts;
    if (!petId || nameParts.length === 0) {
      return { kind: 'text', status: 400, body: 'dsh-pet: expected /dsh-pet-7340/model3d/<petId>/<file>' };
    }
    if (!isValidPetId(petId)) {
      return { kind: 'text', status: 400, body: 'dsh-pet: invalid pet id' };
    }
    const fileName = nameParts.join('/');
    const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
    const allowed = new Set(['.glb', '.gltf', '.bin', '.json', '.png', '.jpg', '.jpeg', '.webp']);
    if (!allowed.has(ext)) {
      return { kind: 'text', status: 400, body: 'dsh-pet: unsupported model3d format' };
    }
    const root = join(PACKAGE_ROOT, 'assets', 'model3d', petId);
    const file = resolveExisting(root, fileName);
    if (file === undefined) return { kind: 'text', status: 404, body: 'dsh-pet: model3d asset not found' };
    return { kind: 'file', file, contentType: MIME[ext] ?? 'application/octet-stream' };
  }
```

MIME 增加：`'.glb': 'model/gltf-binary'`、`'.gltf': 'model/gltf+json'`、`'.bin': 'application/octet-stream'`。

- [ ] **Step 3: 跑相关测试 + Commit**

```bash
git commit -m "feat: 新增三维模型静态资源路由"
```

---

### Task 4: Vendor Three.js + 透明空舞台

**Files:**
- Create: `scripts/vendor/model3d-three-entry.mjs`
- Create: `scripts/vendor-three-model3d.mjs`
- Create: `runtime/electron-helper/vendor/three-gltf.iife.js`（生成）
- Create: `runtime/electron-helper/sprite/presentation-model3d.js`
- Create: `runtime/electron-helper/sprite/presentation.js`
- Modify: `runtime/electron-helper/index.html`
- Modify: `package.json`（dependency `three`，可选 script `vendor:three-model3d`）
- Modify: `scripts/prepack-check.js`（登记新 runtime 文件）

**Interfaces:**
- Produces: `window.THREE`、`window.GLTFLoader`
- Produces: `createModel3dPresentation(opts) → PetPresentation | null`
- Produces: `createPresentation(kind, opts)` — `kind==='model3d'` 时调前者，否则 `null`（video 仍走 videoA/B）

- [ ] **Step 1: 安装 three**

```bash
npm install three@0.170.0
```

- [ ] **Step 2: vendor 入口与打包脚本**

`scripts/vendor/model3d-three-entry.mjs`：

```js
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
export { THREE, GLTFLoader };
```

`scripts/vendor-three-model3d.mjs`：用现有 `rolldown` 打成 IIFE，`name: false`，末尾挂：

```js
globalThis.THREE = THREE;
globalThis.GLTFLoader = GLTFLoader;
```

输出：`runtime/electron-helper/vendor/three-gltf.iife.js`。  
`package.json` scripts 增加 `"vendor:three-model3d": "node scripts/vendor-three-model3d.mjs"`，并在 `prepare.js` 或文档中要求构建前执行（实现时二选一：**prepare 链式调用**或 README 说明；本计划要求 `prepare.js` 在 build:desktop-core 后调用 vendor，保证发布物齐全）。

- [ ] **Step 3: `presentation-model3d.js` 最小可挂载**

```js
'use strict';
function createModel3dPresentation(opts) {
  const THREE = window.THREE;
  const GLTFLoader = window.GLTFLoader;
  if (!THREE || !GLTFLoader) {
    console.warn('[dsh-pet] Three.js vendor 未加载');
    return null;
  }
  const meta = (opts && opts.pet && opts.pet.model3d && opts.pet.model3d.meta) || {};
  let renderer, scene, camera, root, mixer, clock, raf, disposed = false;
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
    const h = parent.clientHeight || Math.round(462 * 9 / 16);
    if (cam.kind === 'ortho') {
      const fr = cam.frustum || 2;
      camera = new THREE.OrthographicCamera(-fr, fr, fr * h / w, -fr * h / w, 0.1, 100);
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
  return { mount, play, setFacing, dispose, /** @internal */ _debug: { get root() { return root; }, get scene() { return scene; } } };
}
```

- [ ] **Step 4: 工厂 + HTML**

`presentation.js`：`createPresentation('model3d', opts)` → `createModel3dPresentation(opts)`。

`index.html` 在 `sprite.js` 之后、`playback.js` 之前插入：

```html
<script src="./vendor/three-gltf.iife.js"></script>
<script src="./sprite/presentation-model3d.js"></script>
<script src="./sprite/presentation.js"></script>
```

CSS：`.pet-model3d { display:block; }`

- [ ] **Step 5: 手动烟测要点（写入 PR/自检清单）**

`npm run vendor:three-model3d` 后确认 vendor 文件非空；后续 Task 6 接线后透明窗可见清空 canvas（无模型也可）。

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: 接入三维渲染依赖与透明舞台"
```

---

### Task 5: 演示 GLB + idle 循环上屏

**Files:**
- Create: `assets/model3d/model3d-demo/Fox.glb`（从 Khronos glTF-Sample-Models 下载 `Fox/glTF-Binary/Fox.glb`）
- Create: `assets/model3d/model3d-demo/meta.json`
- Create: `assets/model3d/model3d-demo/NOTICE.txt`（许可与来源 URL）
- Modify: `runtime/electron-helper/sprite/presentation-model3d.js`（GLTFLoader.load）
- Modify: `docs/model3d-presentation.md`（署名）

**Fox 动画映射（锁定）：**

| 槽位 | glTF animation name |
|------|---------------------|
| idle | `Survey` |
| walk | `Walk` |

`meta.json`：

```json
{
  "glb": "Fox.glb",
  "clips": { "idle": "Survey", "walk": "Walk" },
  "walkSpeedPx": 100,
  "scale": 0.02,
  "pivot": { "x": 0, "y": 0, "z": 0 },
  "camera": { "kind": "perspective", "fov": 35, "distance": 5 },
  "facingMode": "mirror",
  "autoBehavior": false
}
```

- [ ] **Step 1: 下载素材并写 NOTICE**

来源：`https://github.com/KhronosGroup/glTF-Sample-Models`（Fox，许可证以仓库内为准，写入 NOTICE）。

- [ ] **Step 2: 在 `mount` 后加载 GLB**

```js
const assetId = (opts.pet.model3d && opts.pet.model3d.assetId) || opts.pet.id || 'model3d-demo';
const base = (opts.assetBase || '').replace(/\/?$/, '/'); // 形如 http://127.0.0.1:port/dsh-pet-7340/model3d/model3d-demo/
const glbName = meta.glb || 'character.glb';
const loader = new GLTFLoader();
loader.load(
  base + encodeURIComponent(glbName).replace(/%2F/gi, '/'),
  (gltf) => {
    if (disposed) return;
    const model = gltf.scene;
    const s = typeof meta.scale === 'number' ? meta.scale : 1;
    model.scale.setScalar(s);
    if (meta.pivot) model.position.set(meta.pivot.x || 0, meta.pivot.y || 0, meta.pivot.z || 0);
    root.add(model);
    mixer = new THREE.AnimationMixer(model);
    const clipsByName = Object.create(null);
    for (const c of gltf.animations || []) clipsByName[c.name] = c;
    // 暴露给 play：
    presentation._clipsByName = clipsByName;
    presentation._mixer = mixer;
    play(meta.clips && meta.clips.idle ? 'idle' : 'idle', { loop: true });
  },
  undefined,
  (err) => console.warn('[dsh-pet] model3d 加载失败', err),
);
```

`play(slotOrName, {loop})`：

1. 用 `meta.clips[slot]` 映射到真实动画名  
2. 找不到 → 尝试回退 `idle` 映射 → 再失败则日志并保持静态  
3. `action.clampWhenFinished = !loop`；`loop ? THREE.LoopRepeat : THREE.LoopOnce`  
4. 切换时 `fadeOut`/`fadeIn` 可选，首版可 `stopAllAction` + `play`

- [ ] **Step 3: Commit 素材与加载逻辑**

```bash
git commit -m "feat: 加载演示狐模型并循环待机"
```

---

### Task 6: 接入 PetSprite（init / playback / facing / 速度位移）

**Files:**
- Modify: `runtime/electron-helper/sprite/init.js`
- Modify: `runtime/electron-helper/sprite/playback.js`
- Modify: `runtime/electron-helper/sprite/motion.js`
- Modify: `runtime/electron-helper/renderer.js`（若需传 assetBase）
- Modify: `scripts/build-desktop-core.mjs` 无需改（behavior 已进 shared index）
- Run: `npm run build:desktop-core` 使 `S.parseModel3dMeta` 等可用

**Interfaces:**
- Consumes: `createPresentation`、`S.normalizePresentation` / `S.resolvePetPlaybackSetup` / `S.parseModel3dMeta`
- Produces: `sprite.presentation`；`startSpeedMoveDrive({ goal, speedPx, onArrive })`

- [ ] **Step 1: `initPlayback` 支持 model3d stub**

将 `if (!pet.animations) throw ...` 改为：

```js
const setup = typeof S.resolvePetPlaybackSetup === 'function'
  ? S.resolvePetPlaybackSetup(pet)
  : { kind: 'video', animations: pet.animations, usedStub: false };
if (!setup.animations) throw new Error('宠物缺少 animations 段：' + String(pet.id ?? ''));
this.playbackKind = setup.kind;
this.animations = setup.animations;
// ...
```

在构建 DOM 处（`init` 里创建 videoA/B 的逻辑）：若 `playbackKind === 'model3d'`，创建 `.pet-stage` 后：

```js
this.presentation = createPresentation('model3d', {
  pet: this.pet,
  assetBase: this.model3dAssetBase, // 见下
});
if (this.presentation) this.presentation.mount(stageEl);
// 可不创建 video 或创建但隐藏
```

`model3dAssetBase`：由 renderer 设为  
`BASE + 'model3d/' + encodeURIComponent(assetId) + '/'`  
（`BASE` 已是含 `/dsh-pet-7340/` 的宿主前缀，与 thumb 一致）。

配置注入：用户/包内为 `model3d-demo` 条目时，`pet.presentation = 'model3d'`，`pet.model3d.meta` 可内联或启动时 fetch `meta.json` 后 `S.parseModel3dMeta`。**首版允许配置内联完整 meta**（与 Spine 演示一致），避免额外异步；磁盘 `meta.json` 仍放仓库供对照。

- [ ] **Step 2: `switchTo` / `playIdle` 分支**

```js
if (this.playbackKind === 'model3d' && this.presentation) {
  this.anim = next;
  this.once = !nextOnce;
  const loop = !nextOnce;
  // idle 槽强制 loop
  const isIdle = this.isModel3dIdleClip(next);
  this.presentation.play(next, { loop: isIdle ? true : loop });
  this.presentation.setFacing(this.facing === 'right' ? 'right' : 'left');
  if (playbackId) { this.playback = playbackId; this.reportPlayback(playbackId, 'playing'); }
  return;
}
```

`playIdle`：model3d 时 `switchTo(idleName, false)` 且**不要**依赖 video ended 才续播。

随机链：`playbackKind === 'model3d' && meta.autoBehavior === false` 时跳过漫游抽卡（与 fixed 类似，直接 return 或只保 idle）。

- [ ] **Step 3: `startSpeedMoveDrive`**

在 `motion.js` 增加（对齐 Spine 分支语义）：

```js
startSpeedMoveDrive({ goal, speedPx, onArrive }) {
  this.stopMove();
  const token = ++this.moveToken;
  const W = VIEW.w, H = VIEW.h;
  const speed = speedPx > 0 ? speedPx : 120;
  let last = performance.now();
  const step = () => {
    if (this.moveToken !== token) return;
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const cx = this.pos.x + this.halfW;
    const cy = this.pos.y + this.halfH;
    const tx = goal.xRatio * W;
    const ty = goal.yRatio * H;
    const dx = tx - cx, dy = ty - cy;
    const dist = Math.hypot(dx, dy);
    if (dist <= 2) {
      this.moveRef = null;
      this.customPos = { rx: goal.xRatio, ry: goal.yRatio };
      if (typeof onArrive === 'function') onArrive();
      return;
    }
    const stepPx = Math.min(dist, speed * dt);
    const nx = cx + (dx / dist) * stepPx;
    const ny = cy + (dy / dist) * stepPx;
    this.sendBounds(nx - this.halfW, ny - this.halfH);
    // 朝向
    if (Math.abs(dx) > 1) this.facing = dx > 0 ? 'right' : 'left';
    this.moveRef = requestAnimationFrame(step);
  };
  this.moveRef = requestAnimationFrame(step);
},
```

走路时 `presentation.play('walk', { loop: true })`；到达后回 idle。

- [ ] **Step 4: 重建 shared-core + 手动验证路径写进清单**

Run: `npm run build:desktop-core && npm run vendor:three-model3d`  
Expected: 无报错。

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: 桌宠精灵接入三维表现与速度位移"
```

---

### Task 7: BehaviorRunner + 演示配置 + 文档

**Files:**
- Create: `runtime/electron-helper/sprite/behavior-runner.js`
- Modify: `runtime/electron-helper/index.html`（behavior-runner 在 motion 之后）
- Modify: `runtime/electron-helper/sprite/init.js` 或 `playback.js`（启动时 `startBehaviorRunner`）
- Create/Modify: 演示配置——优先 **用户层示例** 写在 `docs/model3d-presentation.md`；包内可选 `assets/config` 不强制改默认女仆，避免打扰现有用户。实现：**文档给出 `main-config.jsonc` 片段**，并提供 `assets/model3d/model3d-demo/pet-snippet.jsonc` 可复制片段。
- Modify: `docs/model3d-presentation.md`
- Modify: `scripts/prepack-check.js` 登记 `behavior-runner.js`、`presentation*.js`、vendor

**Interfaces:**
- Produces: `sprite.submitIntent(intent)` / `sprite.startRoam()` / `sprite.stopRoam()`
- `autoBehavior === false` → `startRoam` 直接 return；仅 idle

- [ ] **Step 1: 实现 runner（精简版）**

职责：

1. `submitIntent` → `S.planBehavior` → 逐步执行  
2. `until:'arrive'` → `play(walk)` + `startSpeedMoveDrive`  
3. `until:'duration'|'clip-end'` → `play` + `setTimeout`（model3d 无 video ended）  
4. 结束 → `playIdle`  
5. `startRoam`：若 `parseModel3dMeta(...).autoBehavior === false` return；否则定时随机 goal + walk intent（源 `'roam'`）  
6. 拖拽开始时 `cancelPlan` + 可选 `play('drag')`

允许 clips：槽位名 ∪ meta.clips 的 key/value ∪ animations.idle。

- [ ] **Step 2: 文档**

更新 `docs/model3d-presentation.md`：

- 如何在 `main-config.jsonc` 增加 `model3d-demo` 宠物（`presentation:"model3d"`、内联 meta、`display:"desktop"`、`fixedEnabled:true`）
- 启动：`npm run build && npm run vendor:three-model3d && npm run start:desktop`（或项目惯用命令）
- Fox 署名与许可证
- 验收清单：idle 循环、walk 位移、拖拽、关漫游、webm 回归

- [ ] **Step 3: 单元测试补强（可选但推荐）**

`planner`/`meta` 已有；若 runner 纯逻辑可抽到 shared 再测——**首版 runner 留在 runtime，不做强制抽测**。

- [ ] **Step 4: 回归命令**

Run:

```bash
npm test
npm run typecheck
npm run build:desktop-core
npm run vendor:three-model3d
```

Expected: 全绿；手动桌面验收勾选文档清单。

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: 接通三维行为编排与演示配置文档"
```

---

## Self-Review

1. **Spec coverage:** 真 3D glTF、免费 Fox、固定机位、Three.js、多轨类型、独立分支、Intent/Planner、idle 循环、walk+bounds、autoBehavior 关、错误不崩溃、资源目录与路由、文档署名 → 均有对应 Task。设置页 UI 规格标为后置 → 本计划用文档片段代替，不阻塞验收。
2. **Placeholder scan:** 无 TBD；Fox 映射与 meta 字段已钉死。
3. **Type consistency:** `PresentationKind` / `parseModel3dMeta` / `createPresentation('model3d')` / `playbackKind === 'model3d'` / `startSpeedMoveDrive` 全程同名。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-11-16-model3d-presentation.md`（工作区；gitignore）。入库副本见下一步提交的 `docs/model3d-presentation-plan.md`。

**Two execution options:**

1. **Subagent-Driven（推荐）** — 每任务新开子代理，任务间复查  
2. **Inline Execution** — 本会话按 executing-plans 连续执行并设检查点  

Which approach?

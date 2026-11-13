'use strict';
/**
 * 坐姿隐藏窗主进程控制器。
 *
 * 按 `$DSH_HOME/dsh-pet/posture-config.json` 的 enabled 创建或关掉 640×480 的隐藏 BrowserWindow，
 * 页面加载完再发 `posture:init`。检测页上来的事件走告警冷却，能演出就走宠物路由
 * （lock → broadcast → anim → release），失败或未演出则 toast/蜂鸣；人脸离开满 10 秒睡、回来醒。
 * `petPerform` 为假时不睡醒、也不点播。
 *
 * Electron 主进程是 CJS，不能 import `src/shared/posture` 的 TS。下面标了「同算法」的函数
 * 是那些模块的短副本，改语义时两边一起改：
 * - pick-pet.ts            pickActivePet / animationPoolFor
 * - posture-window-policy  bootPostureAction / reduceEnabled
 * - config.ts              mergePostureConfig / applySensitivity
 * - alert.ts               AlertGate / planAlert
 * - perform.ts             performReminder
 * - presence.ts            createPresenceTracker
 * - anim-map.ts            resolveAnim / resolveAnimWithFallback
 * @module dsh-pet/runtime/electron-helper/main/posture-window
 */

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');

/** 与 pick-pet.ts 的 DEFAULT_PET_ID 一致。 */
const DEFAULT_PET_ID = 'main';
/** 目标宠物缓存：托盘切换后最多晚这么久才跟上。 */
const PET_REFRESH_MS = 5000;
/** 人脸持续离开这么多秒才让桌宠睡。与 presence.ts 缺省一致。 */
const LEAVE_SEC = 10;
/** 提醒气泡时长。与 perform.ts 的 REMINDER_BROADCAST_MS 一致。 */
const REMINDER_BROADCAST_MS = 4500;
/** 短锁，盖住气泡和动画衔接。与 perform.ts 的 LOCK_TTL_MS 一致。 */
const LOCK_TTL_MS = 8000;

const THRESHOLD_DEFAULTS = {
  CALIB_SECONDS: 4,
  CALIB_MIN_FRAMES: 30,
  EAR_CLOSED: 0.18,
  EYE_CLOSED_SEC: 1.6,
  YAWN_MAR: 0.4,
  YAWN_SEC: 2,
  PERCLOS_WINDOW_SEC: 30,
  PERCLOS_RATIO: 0.35,
  PITCH_NOD_DEG: 30,
  NOD_SEC: 2,
  MIN_FACE_WIDTH_FOR_EYE: 0.08,
  POSE_EMA: 0.35,
  FWD_HEAD_OFF: 0.1,
  TILT_DEG: 12,
  HEAD_DROP: 0.35,
  NEAR_FACE_RATIO: 1.15,
  POSTURE_HOLD_SEC: 8,
  GAZE_DOWN_SCORE: 0.4,
  GAZE_DOWN_SEC: 2.5,
};

const SENSITIVITY_FACTOR = { strict: 0.8, standard: 1.0, loose: 1.3 };
const SENSITIVITY_HOLD = { strict: 5, standard: 8, loose: 12 };
const SENSITIVITY_SET = new Set(['strict', 'standard', 'loose']);
const POSTURE_CONFIG_KEYS = ['enabled', 'paused', 'sensitivity', 'cooldown', 'beep', 'toast', 'petPerform'];

const POSTURE_COOLDOWN_CHOICES = [5, 10, 30];

const DEFAULT_POSTURE_CONFIG = {
  enabled: false,
  paused: false,
  sensitivity: 'standard',
  cooldown: 10,
  beep: true,
  toast: false,
  petPerform: true,
};

function normalizePostureCooldown(value) {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_POSTURE_CONFIG.cooldown;
  if (POSTURE_COOLDOWN_CHOICES.includes(value)) return value;
  let best = POSTURE_COOLDOWN_CHOICES[0];
  let bestDist = Math.abs(value - best);
  for (const choice of POSTURE_COOLDOWN_CHOICES) {
    const dist = Math.abs(value - choice);
    if (dist < bestDist) {
      best = choice;
      bestDist = dist;
    }
  }
  return best;
}

/** anim-map.json 读不到时的兜底，内容与该文件的 default / by_pet 一致。 */
const FALLBACK_ANIM_MAP = {
  default: {
    slouch: '被吓一跳',
    slump: '被吓一跳',
    tilt: '被吓一跳',
    near: '被吓一跳',
    fatigue: '哈欠连天',
    yawn: '哈欠连天',
    nod: '原地小憩沉眠',
    perclos: '超大伸懒腰',
    gaze_down: '原地小憩沉眠',
  },
  by_pet: {
    main: {
      slouch: '被吓一跳',
      slump: '被吓一跳',
      tilt: '被吓一跳',
      near: '被吓一跳',
      fatigue: '哈欠连天',
      yawn: '哈欠连天',
      nod: '原地小憩沉眠',
      perclos: '超大伸懒腰',
      gaze_down: '原地小憩沉眠',
    },
    dengxi: {
      slouch: '星伴轻撞',
      slump: '星伴轻撞',
      tilt: '呆毛歪一下',
      near: '悄悄凑近',
      fatigue: '打哈欠',
      yawn: '打哈欠',
      nod: '点头犯困',
      perclos: '展臂醒神',
      gaze_down: '点头犯困',
    },
  },
};

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/** 与 posture-window-policy.ts 的 bootPostureAction 同算法。 */
function bootPostureAction(enabled) {
  return enabled ? 'start' : 'noop';
}

/** 与 posture-window-policy.ts 的 reduceEnabled 同算法。 */
function reduceEnabled(phase, enabled) {
  if (enabled && phase === 'stopped') return { phase: 'running', action: 'start' };
  if (!enabled && phase === 'running') return { phase: 'stopped', action: 'stop' };
  return { phase, action: 'noop' };
}

/** 与 pick-pet.ts 的 pickActivePet 同算法。 */
function pickActivePet(cfg, fallback = DEFAULT_PET_ID) {
  if (!isRecord(cfg)) return fallback;
  const visible = [];
  for (const entry of Object.values(cfg)) {
    if (!isRecord(entry) || !Array.isArray(entry.pets)) continue;
    for (const pet of entry.pets) {
      if (!isRecord(pet)) continue;
      const id = pet.id;
      const display = pet.display;
      const idOk = (typeof id === 'string' || typeof id === 'number') && id !== '';
      if (idOk && (display === 'desktop' || display === 'both')) visible.push(String(id));
    }
  }
  if (visible.length === 0) return fallback;
  for (const petId of visible) {
    if (petId !== DEFAULT_PET_ID) return petId;
  }
  return visible[0];
}

function addPoolName(names, seen, value) {
  if (typeof value !== 'string' && typeof value !== 'number') return;
  if (value === '') return;
  const text = String(value);
  if (seen.has(text)) return;
  seen.add(text);
  names.push(text);
}

/** 与 pick-pet.ts 的 animationPoolFor 同算法。 */
function animationPoolFor(cfg, petId) {
  if (!isRecord(cfg)) return null;
  for (const entry of Object.values(cfg)) {
    if (!isRecord(entry)) continue;
    const pets = Array.isArray(entry.pets) ? entry.pets : [];
    if (!pets.some((pet) => isRecord(pet) && pet.id === petId)) continue;
    const animations = entry.animations;
    if (!isRecord(animations)) continue;
    const names = [];
    const seen = new Set();
    for (const key of ['idle', 'turn', 'drag', 'clicks']) {
      const list = animations[key];
      if (Array.isArray(list)) {
        for (const item of list) addPoolName(names, seen, item);
      }
    }
    const moves = animations.moves;
    const actions = isRecord(moves) && Array.isArray(moves.actions) ? moves.actions : [];
    for (const item of actions) {
      if (isRecord(item)) addPoolName(names, seen, item.name);
      else addPoolName(names, seen, item);
    }
    const categories = Array.isArray(animations.categories) ? animations.categories : [];
    for (const category of categories) {
      if (!isRecord(category) || !Array.isArray(category.actions)) continue;
      for (const item of category.actions) addPoolName(names, seen, item);
    }
    if (isRecord(animations.events)) {
      for (const value of Object.values(animations.events)) {
        if (!Array.isArray(value)) continue;
        for (const item of value) {
          if (Array.isArray(item)) {
            for (const nested of item) addPoolName(names, seen, nested);
          } else addPoolName(names, seen, item);
        }
      }
    }
    return names.length > 0 ? names : null;
  }
  return null;
}

/** 与 config.ts 的 mergePostureConfig 同口径：只收已知字段，坏值留默认。 */
function mergePostureConfig(parsed) {
  const out = { ...DEFAULT_POSTURE_CONFIG };
  if (!isRecord(parsed)) return out;
  for (const key of POSTURE_CONFIG_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(parsed, key)) continue;
    const value = parsed[key];
    if (key === 'sensitivity') {
      if (typeof value === 'string' && SENSITIVITY_SET.has(value)) out.sensitivity = value;
      continue;
    }
    if (key === 'cooldown') {
      if (typeof value === 'number' && Number.isFinite(value)) {
        out.cooldown = normalizePostureCooldown(value);
      }
      continue;
    }
    if (typeof value === 'boolean') out[key] = value;
  }
  return out;
}

/** 与 config.ts 的 applySensitivity 同算法。疲劳阈值不缩放。 */
function applySensitivity(cfg) {
  const sensitivity = SENSITIVITY_SET.has(cfg.sensitivity) ? cfg.sensitivity : 'standard';
  const factor = SENSITIVITY_FACTOR[sensitivity];
  const hold = SENSITIVITY_HOLD[sensitivity];
  return {
    CALIB_SECONDS: THRESHOLD_DEFAULTS.CALIB_SECONDS,
    CALIB_MIN_FRAMES: THRESHOLD_DEFAULTS.CALIB_MIN_FRAMES,
    EAR_CLOSED: THRESHOLD_DEFAULTS.EAR_CLOSED,
    EYE_CLOSED_SEC: THRESHOLD_DEFAULTS.EYE_CLOSED_SEC,
    YAWN_MAR: THRESHOLD_DEFAULTS.YAWN_MAR,
    YAWN_SEC: THRESHOLD_DEFAULTS.YAWN_SEC,
    PERCLOS_WINDOW_SEC: THRESHOLD_DEFAULTS.PERCLOS_WINDOW_SEC,
    PERCLOS_RATIO: THRESHOLD_DEFAULTS.PERCLOS_RATIO,
    PITCH_NOD_DEG: THRESHOLD_DEFAULTS.PITCH_NOD_DEG,
    NOD_SEC: THRESHOLD_DEFAULTS.NOD_SEC,
    MIN_FACE_WIDTH_FOR_EYE: THRESHOLD_DEFAULTS.MIN_FACE_WIDTH_FOR_EYE,
    POSE_EMA: THRESHOLD_DEFAULTS.POSE_EMA,
    FWD_HEAD_OFF: THRESHOLD_DEFAULTS.FWD_HEAD_OFF * factor,
    TILT_DEG: THRESHOLD_DEFAULTS.TILT_DEG * factor,
    HEAD_DROP: THRESHOLD_DEFAULTS.HEAD_DROP * factor,
    NEAR_FACE_RATIO: THRESHOLD_DEFAULTS.NEAR_FACE_RATIO * factor,
    POSTURE_HOLD_SEC: hold,
    GAZE_DOWN_SCORE: THRESHOLD_DEFAULTS.GAZE_DOWN_SCORE,
    GAZE_DOWN_SEC: THRESHOLD_DEFAULTS.GAZE_DOWN_SEC,
  };
}

/** 与 anim-map.ts 的 resolveAnim 同算法。 */
function resolveAnim(map, petId, eventType) {
  const petTable = map && map.by_pet && map.by_pet[petId];
  const fromPet = petTable && petTable[eventType];
  if (typeof fromPet === 'string') return fromPet;
  const fromDefault = map && map.default && map.default[eventType];
  return typeof fromDefault === 'string' ? fromDefault : undefined;
}

/** 与 anim-map.ts 的 resolveAnimWithFallback 同算法。池为空则不校验。 */
function resolveAnimWithFallback(map, petId, eventType, pool) {
  const name = resolveAnim(map, petId, eventType);
  if (name === undefined) return undefined;
  if (!pool || pool.length === 0) return name;
  if (pool.includes(name)) return name;
  return pool[0];
}

function loadAnimMap(animMapPath) {
  if (!animMapPath) return FALLBACK_ANIM_MAP;
  try {
    const parsed = JSON.parse(fs.readFileSync(animMapPath, 'utf8'));
    if (!isRecord(parsed) || !isRecord(parsed.default)) return FALLBACK_ANIM_MAP;
    return parsed;
  } catch {
    return FALLBACK_ANIM_MAP;
  }
}

/**
 * 读写 posture-config.json。缺文件、坏 JSON 都回默认（enabled 为 false）。
 *
 * @param options.fileSystem - 可选，缺省用 node:fs。
 * @param options.configPath - 配置文件绝对路径。
 * @returns `{ load, save }`。
 */
function createPostureConfigStore(options) {
  const fileSystem = (options && options.fileSystem) || fs;
  const configPath = options.configPath;
  return {
    load() {
      try {
        return mergePostureConfig(JSON.parse(fileSystem.readFileSync(configPath, 'utf8')));
      } catch {
        return mergePostureConfig(null);
      }
    },
    save(cfg) {
      fileSystem.mkdirSync(path.dirname(configPath), { recursive: true });
      fileSystem.writeFileSync(configPath, JSON.stringify(mergePostureConfig(cfg), null, 2), 'utf8');
    },
  };
}

/**
 * 把 PetRouteClient 接到 helper 已经在用的 hostRequest 上。
 *
 * 宿主业务失败是 HTTP 200 + `{ ok: false }`（见 routes/result.ts）。
 * performReminder 看的是 client 返回的 ok，所以这里把 `json.ok === false` 折成失败。
 * 令牌由 bridge.hostRequest 按独立模式自己带头，本函数不再加一套。
 *
 * @param deps.hostRequest - bridge.hostRequest。
 * @param deps.petRoute - 路由前缀，如 `/dsh-pet-7340`。
 * @returns PetRouteClient。
 */
function createPetRouteClient({ hostRequest, petRoute }) {
  return {
    async request(method, rest, query, body) {
      const params = new URLSearchParams();
      const source = query || {};
      for (const key of Object.keys(source)) {
        const value = source[key];
        if (value === undefined || value === null) continue;
        params.set(key, String(value));
      }
      const qs = params.toString();
      const route = String(rest || '').replace(/^\/+/, '');
      const url = petRoute + '/' + route + (qs ? '?' + qs : '');
      const payload = body === undefined ? undefined : JSON.stringify(body);
      try {
        const resp = await hostRequest(method, url, payload);
        const status = resp && typeof resp.status === 'number' ? resp.status : 0;
        let json;
        const raw = resp ? resp.body : undefined;
        if (typeof raw === 'string' && raw.length) {
          try {
            json = JSON.parse(raw);
          } catch {
            json = undefined;
          }
        } else if (isRecord(raw)) {
          json = raw;
        }
        const businessFail = isRecord(json) && json.ok === false;
        return { ok: status >= 200 && status < 300 && !businessFail, json };
      } catch {
        return { ok: false };
      }
    },
  };
}

/** 与 alert.ts 的 AlertGate 同语义。now 返回秒。 */
function createAlertGate(cooldownSec, now) {
  const clock = now || (() => Math.floor(Date.now() / 1000));
  const lastAt = new Map();
  return {
    allow(eventType) {
      const t = clock();
      const last = lastAt.get(eventType);
      if (last !== undefined && t - last < cooldownSec) return false;
      lastAt.set(eventType, t);
      return true;
    },
  };
}

/** 与 alert.ts 的 planAlert 同语义。 */
function planAlert(cfg, eventType, gate) {
  if (!gate.allow(eventType)) return { perform: false, toast: false, beep: false };
  return { perform: !!cfg.petPerform, toast: !!cfg.toast, beep: !!cfg.beep };
}

async function tryRelease(client, query, lockId) {
  try {
    await client.request('POST', 'lock/release', query, { lockId });
  } catch {
    /* 忽略 release 失败 */
  }
}

/** 与 perform.ts 的 performReminder 同序：lock → broadcast → anim → release。失败不抛。 */
async function performReminder(client, opts) {
  const petId = opts.petId;
  const animName = opts.animName;
  const message = opts.message;
  const durationMs = opts.durationMs === undefined ? REMINDER_BROADCAST_MS : opts.durationMs;
  const baseQuery = { pet: petId, surface: 'any' };
  let lockId;
  try {
    const lockRes = await client.request('POST', 'lock', baseQuery, { ttl: LOCK_TTL_MS });
    if (!lockRes.ok) return false;
    const id = isRecord(lockRes.json) ? lockRes.json.lockId : undefined;
    if (typeof id !== 'string' || !id) return false;
    lockId = id;
    const lockedQuery = { ...baseQuery, lock: lockId };
    const bcastRes = await client.request('POST', 'broadcast', lockedQuery, {
      text: message,
      duration: durationMs,
      anim: false,
    });
    if (!bcastRes.ok) {
      await tryRelease(client, baseQuery, lockId);
      return false;
    }
    const animRes = await client.request('POST', 'anim', lockedQuery, { name: animName });
    if (!animRes.ok) {
      await tryRelease(client, baseQuery, lockId);
      return false;
    }
    const relRes = await client.request('POST', 'lock/release', baseQuery, { lockId });
    return !!relRes.ok;
  } catch {
    if (lockId) await tryRelease(client, baseQuery, lockId);
    return false;
  }
}

/** 与 presence.ts 的 createPresenceTracker 同语义。 */
function createPresenceTracker(opts) {
  const leaveSec = opts.leaveSec === undefined ? LEAVE_SEC : opts.leaveSec;
  const now = opts.now || (() => Date.now() / 1000);
  let lastPresentAt = now();
  let asleep = false;
  return {
    reset() {
      lastPresentAt = now();
      asleep = false;
    },
    onFace(present) {
      const t = now();
      if (present) {
        lastPresentAt = t;
        if (asleep) {
          asleep = false;
          opts.onWake();
        }
        return;
      }
      if (!asleep && t - lastPresentAt >= leaveSec) {
        asleep = true;
        opts.onSleep();
      }
    },
  };
}

/**
 * 系统蜂鸣。
 * Windows GUI 进程往往没有控制台，`[console]::Beep` 经常没声；改走 MessageBeep。
 * 其它平台写 BEL。失败静默。
 */
function systemBeep() {
  try {
    const child =
      process.platform === 'win32'
        ? spawn('rundll32.exe', ['user32.dll,MessageBeep', '0x00000040'], {
            windowsHide: true,
            stdio: 'ignore',
          })
        : spawn('printf', ['\u0007'], { stdio: 'ignore' });
    child.on('error', () => {});
    child.unref?.();
  } catch {
    /* 蜂鸣不可用时只放弃这一声 */
  }
}

function toFileUrl(filePath) {
  if (!filePath) return '';
  return pathToFileURL(filePath).href;
}

/**
 * 坐姿隐藏窗控制器。
 *
 * @param deps.BrowserWindow - Electron BrowserWindow。
 * @param deps.ipcMain - Electron ipcMain。
 * @param deps.pathToPreload - posture/preload.js 绝对路径。
 * @param deps.pathToIndex - posture/index.html 绝对路径。
 * @param deps.modelPaths - `{ face, pose, wasm, vision }` 绝对路径。
 * @param deps.animMapPath - anim-map.json 绝对路径，缺文件用内置兜底。
 * @param deps.loadConfig - 读出已合并的配置。
 * @param deps.saveConfig - 写回配置。
 * @param deps.statusPath - 可选，状态 JSON，供设置页读。
 * @param deps.petClient - PetRouteClient。
 * @param deps.notifyToast - `(title, body) => void`。
 * @param deps.beep - 蜂鸣。
 * @param deps.log - 日志。
 * @param deps.now - 可选。返回秒（与 presence 相同）。在离计时用它，测试可注入。
 * @returns 启停与运行时状态。
 */
function createPostureController(deps) {
  const log = (message) => {
    try {
      if (typeof deps.log === 'function') deps.log(String(message));
    } catch {
      /* 日志失败不影响检测 */
    }
  };

  let cfg = mergePostureConfig(null);
  let gate = createAlertGate(cfg.cooldown);
  let win = null;
  let booted = false;
  let presence = null;
  let ipcBound = false;
  let runtimeStatus = '未启用';
  let runtimeError = '';
  let activePet = '';
  let lastCfg = null;
  let petCheckedAt = 0;
  let chain = Promise.resolve();
  const animMap = loadAnimMap(deps.animMapPath);

  function windowAlive() {
    return !!(win && !win.isDestroyed());
  }

  function phase() {
    return windowAlive() ? 'running' : 'stopped';
  }

  function publishStatus() {
    if (!deps.statusPath) return;
    const state = {
      status: runtimeStatus,
      error: runtimeError,
      running: windowAlive(),
      enabled: !!cfg.enabled,
      paused: !!cfg.paused,
    };
    try {
      fs.mkdirSync(path.dirname(deps.statusPath), { recursive: true });
      fs.writeFileSync(deps.statusPath, JSON.stringify(state, null, 2), 'utf8');
    } catch (error) {
      log('写入坐姿状态失败: ' + errorText(error));
    }
  }

  function persist() {
    try {
      deps.saveConfig(cfg);
    } catch (error) {
      log('写入坐姿配置失败: ' + errorText(error));
    }
  }

  function enqueue(task) {
    const run = chain.then(task, task);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function resolvePetId() {
    const now = Date.now();
    if (activePet && now - petCheckedAt < PET_REFRESH_MS) return activePet;
    petCheckedAt = now;
    if (!deps.petClient) {
      if (!activePet) activePet = DEFAULT_PET_ID;
      return activePet;
    }
    try {
      const res = await deps.petClient.request('GET', 'config', {});
      if (res.ok && isRecord(res.json)) {
        lastCfg = res.json;
        activePet = pickActivePet(lastCfg, activePet || DEFAULT_PET_ID);
      }
    } catch {
      /* /config 失败保留上一只，不打回 main */
    }
    if (!activePet) activePet = DEFAULT_PET_ID;
    return activePet;
  }

  function sendCommand(command) {
    if (!windowAlive()) return;
    try {
      win.webContents.send('posture:command', command);
    } catch (error) {
      log('发送坐姿命令失败: ' + errorText(error));
    }
  }

  function buildInit(config) {
    const models = deps.modelPaths || {};
    const payload = {
      faceModelPath: toFileUrl(models.face),
      poseModelPath: toFileUrl(models.pose),
      thresholds: applySensitivity(config),
      paused: !!config.paused,
    };
    if (models.wasm) payload.wasmPath = toFileUrl(models.wasm);
    if (models.vision) payload.visionScriptPath = toFileUrl(models.vision);
    return payload;
  }

  function isOurs(event) {
    return windowAlive() && event && event.sender === win.webContents;
  }

  async function sleepWake(rest) {
    if (!windowAlive() || !cfg.petPerform || !deps.petClient) return;
    const petId = await resolvePetId();
    await deps.petClient.request('POST', rest, { pet: petId }, {});
  }

  function ensurePresence() {
    presence = createPresenceTracker({
      leaveSec: LEAVE_SEC,
      now: deps.now,
      onSleep: () => {
        void enqueue(() => sleepWake('sleep')).catch((error) => log('睡下失败: ' + errorText(error)));
      },
      onWake: () => {
        void enqueue(() => sleepWake('wake')).catch((error) => log('叫醒失败: ' + errorText(error)));
      },
    });
  }

  async function handleEvent(payload) {
    if (!windowAlive()) return;
    const type = payload && typeof payload.type === 'string' ? payload.type : '';
    const message = payload && typeof payload.message === 'string' ? payload.message : '';
    if (!type) return;
    const plan = planAlert(cfg, type, gate);
    if (!plan.perform && !plan.toast && !plan.beep) return;
    if (plan.perform && deps.petClient) {
      try {
        const petId = await resolvePetId();
        const pool = animationPoolFor(lastCfg, petId);
        const animName = resolveAnimWithFallback(animMap, petId, type, pool);
        if (animName) {
          await performReminder(deps.petClient, { petId, animName, message });
        }
      } catch (error) {
        log('坐姿演出失败: ' + errorText(error));
      }
    }
    // 蜂鸣与演出独立：勾了就响，不因演出成功而吞掉。系统通知已移除。
    if (plan.beep && typeof deps.beep === 'function') {
      try {
        deps.beep();
      } catch (error) {
        log('蜂鸣失败: ' + errorText(error));
      }
    }
  }

  function bindIpc() {
    if (ipcBound) return;
    if (!deps.ipcMain) throw new Error('posture controller 需要 ipcMain');
    ipcBound = true;
    deps.ipcMain.on('posture:event', (event, payload) => {
      if (!isOurs(event)) return;
      void enqueue(() => handleEvent(payload)).catch((error) => log('处理坐姿事件失败: ' + errorText(error)));
    });
    deps.ipcMain.on('posture:face', (event, present) => {
      if (!isOurs(event) || !presence) return;
      presence.onFace(!!present);
    });
    deps.ipcMain.on('posture:status', (event, text) => {
      if (!isOurs(event)) return;
      const next = String(text ?? '');
      if (next === runtimeStatus) return;
      runtimeStatus = next;
      publishStatus();
    });
    deps.ipcMain.on('posture:error', (event, message) => {
      if (!isOurs(event)) return;
      const text = String(message ?? '');
      log(text);
      if (text === runtimeError) return;
      runtimeError = text;
      publishStatus();
    });
  }

  function startWindow() {
    if (windowAlive()) return;
    if (!deps.BrowserWindow) throw new Error('posture controller 需要 BrowserWindow');
    bindIpc();
    ensurePresence();
    runtimeError = '';
    runtimeStatus = '等待初始化';
    const models = deps.modelPaths || {};
    if (models.face && !fs.existsSync(models.face)) log('找不到人脸模型: ' + models.face);
    if (models.pose && !fs.existsSync(models.pose)) log('找不到姿态模型: ' + models.pose);
    const created = new deps.BrowserWindow({
      width: 640,
      height: 480,
      show: false,
      frame: false,
      skipTaskbar: true,
      focusable: false,
      autoHideMenuBar: true,
      resizable: false,
      webPreferences: {
        preload: deps.pathToPreload,
        contextIsolation: true,
        nodeIntegration: false,
        // MediaPipe 在 file:// 下要关沙箱，与桌宠窗和 Task 8 的验证环境一致。
        sandbox: false,
        backgroundThrottling: false,
      },
    });
    win = created;
    created.webContents.setBackgroundThrottling(false);
    created.on('closed', () => {
      if (win === created) win = null;
    });
    created.webContents.on('did-finish-load', () => {
      // stop 会先摘掉 win 再 destroy。主动关闭后的加载完成不再发 init。
      if (win !== created || created.isDestroyed()) return;
      created.webContents.send('posture:init', buildInit(cfg));
    });
    created.webContents.on('did-fail-load', (_event, code, description) => {
      if (win !== created) return;
      runtimeError = '检测页加载失败: ' + code + ' ' + description;
      runtimeStatus = '检测失败';
      log(runtimeError);
      publishStatus();
    });
    created.webContents.on('render-process-gone', (_event, details) => {
      // 主动 destroy 也会触发 gone（reason 常为 killed）。只有窗还归我们管才算崩溃。
      if (win !== created) return;
      const reason = details && details.reason ? String(details.reason) : 'unknown';
      runtimeError = '检测窗已退出: ' + reason;
      runtimeStatus = '检测失败';
      log(runtimeError);
      win = null;
      presence = null;
      publishStatus();
      if (!created.isDestroyed()) {
        try {
          created.destroy();
        } catch {
          /* 进程已经没了 */
        }
      }
    });
    created.loadFile(deps.pathToIndex).catch((error) => {
      runtimeError = '检测页加载失败: ' + errorText(error);
      runtimeStatus = '检测失败';
      log(runtimeError);
      publishStatus();
    });
    publishStatus();
  }

  function stopWindow() {
    const current = win;
    win = null;
    presence = null;
    if (current && !current.isDestroyed()) {
      try {
        current.webContents.send('posture:command', { type: 'shutdown' });
      } catch {
        /* 窗正在关 */
      }
      try {
        current.destroy();
      } catch {
        /* 窗正在关 */
      }
    }
    runtimeStatus = cfg.enabled ? '已关闭' : '未启用';
    publishStatus();
  }

  function applyLifecycle() {
    const decision = reduceEnabled(phase(), !!cfg.enabled);
    if (decision.action === 'stop') {
      stopWindow();
      return;
    }
    if (decision.action === 'start') startWindow();
  }

  function pushRuntimeCommands(prev) {
    if (!windowAlive()) return;
    if (!!cfg.paused !== !!prev.paused) sendCommand({ type: cfg.paused ? 'pause' : 'resume' });
    if (cfg.sensitivity !== prev.sensitivity) {
      sendCommand({ type: 'set-thresholds', thresholds: applySensitivity(cfg) });
    }
  }

  /** 读配置：enabled 才拉隐藏窗。 */
  function startFromConfig() {
    booted = true;
    try {
      cfg = deps.loadConfig();
    } catch (error) {
      log('读取坐姿配置失败: ' + errorText(error));
      cfg = mergePostureConfig(null);
    }
    cfg = mergePostureConfig(cfg);
    gate = createAlertGate(cfg.cooldown);
    if (bootPostureAction(!!cfg.enabled) === 'start') startWindow();
    else {
      runtimeStatus = '未启用';
      publishStatus();
    }
  }

  /** 改 enabled 并写盘。从关到开拉窗，从开到关拆窗。 */
  function setEnabled(enabled) {
    updateConfig({ enabled: !!enabled });
  }

  /** 暂停只停推理，不关窗。 */
  function setPaused(paused) {
    updateConfig({ paused: !!paused });
  }

  /** 清在离状态并让检测页重做校准。 */
  function recalibrate() {
    if (presence) presence.reset();
    sendCommand({ type: 'recalibrate' });
  }

  /**
   * 合并一部分配置并写盘。
   * 灵敏度变化给检测页换阈值；冷却只换主进程的 AlertGate。
   *
   * @param partial - PostureConfig 的部分字段。
   */
  function updateConfig(partial) {
    const prev = cfg;
    const raw = { ...cfg, ...(isRecord(partial) ? partial : {}) };
    cfg = mergePostureConfig(raw);
    if (cfg.cooldown !== prev.cooldown) gate = createAlertGate(cfg.cooldown);
    persist();
    const wasRunning = windowAlive();
    applyLifecycle();
    if (wasRunning && windowAlive()) pushRuntimeCommands(prev);
  }

  /** 关摄像头窗。还没 startFromConfig 且没有窗时不写状态文件。 */
  function stop() {
    if (!booted && !windowAlive()) return;
    stopWindow();
  }

  /** 当前合并后的配置。给控制口读，避免再读一遍可能落后的文件。 */
  function getConfig() {
    return {
      enabled: !!cfg.enabled,
      paused: !!cfg.paused,
      sensitivity: cfg.sensitivity,
      cooldown: cfg.cooldown,
      beep: !!cfg.beep,
      toast: !!cfg.toast,
      petPerform: !!cfg.petPerform,
    };
  }

  /** 设置页要读的最近状态。同时写在 statusPath。 */
  function getRuntime() {
    return {
      status: runtimeStatus,
      error: runtimeError,
      running: windowAlive(),
      enabled: !!cfg.enabled,
      paused: !!cfg.paused,
    };
  }

  return {
    startFromConfig,
    setEnabled,
    setPaused,
    recalibrate,
    updateConfig,
    stop,
    getConfig,
    getRuntime,
  };
}

module.exports = {
  createPostureController,
  createPostureConfigStore,
  createPetRouteClient,
  systemBeep,
  bootPostureAction,
  reduceEnabled,
  pickActivePet,
  animationPoolFor,
};

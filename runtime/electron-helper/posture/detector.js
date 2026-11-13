/**
 * 坐姿隐藏窗检测循环：摄像头 → MediaPipe Face/Pose（VIDEO）→ PostureCore 引擎 → postureBridge。
 *
 * 依赖（index.html 顺序）：core.js 提供 PostureCore，vision_bundle.js 提供 Vision，preload 提供 postureBridge。
 * 没有主进程、没有摄像头时本文件不得抛未捕获异常：缺 init 就停在等待；摄像头失败只 postError。
 *
 * file:// 约束（Electron loadFile）：
 * - fetch() 不能读 file://，所以本地模型先用 XHR 读成 modelAssetBuffer，再交给 createFromOptions。
 * - MediaPipe 注入 wasm loader 时会加 crossorigin=anonymous，file:// 没有 ACAO，脚本会被拒绝。
 *   仅对 vision_wasm_*.js 去掉这个属性，wasm 二进制仍由 emscripten 用 XHR 读取。
 * - wasm 目录默认相对本页解析到 vendor/wasm（打包进 runtime，不走 node_modules）；主进程也可在 init.wasmPath 传入 file URL。
 * - vision_bundle.js 由 index.html 从 vendor/ 引入。安装布局对不上时，init.visionScriptPath 可再给一份 file URL。
 * MediaPipe / wasm / 模型加载失败时仅 postError + 失败状态，不启检测环（与摄像头失败一致）。
 * 本地烟测可在 init 里设 allowMock: true，此时状态为「模拟中」且不 postEvent。
 * @module dsh-pet/runtime/electron-helper/posture/detector
 */
'use strict';

const FRAME_MS = 50;
const WASM_FALLBACK = './vendor/wasm';

const noopBridge = {
  postEvent() {},
  postFace() {},
  postStatus() {},
  postError() {},
  onInit() {},
  onCommand() {},
};

let engine = null;
let currentThresholds = null;
let faceLandmarker = null;
let poseLandmarker = null;
let mediaStream = null;
let videoTrack = null;
let paused = false;
let shutDown = false;
let bootStarted = false;
let mockMode = false;
let timer = 0;
let lastTs = 0;
let lastStatus = '';
let lastError = '';
let crossOriginPatched = false;
let mockFace = null;
let mockPose = null;

function bridge() {
  return window.postureBridge || noopBridge;
}

function messageOf(err) {
  if (err && typeof err.message === 'string' && err.message) return err.message;
  return String(err);
}

function reportError(err) {
  const text = messageOf(err);
  if (text === lastError) return;
  lastError = text;
  console.error('[posture] ' + text);
  bridge().postError(text);
}

function setDomStatus(text) {
  const el = document.getElementById('posture-status');
  if (el) el.textContent = text;
}

function emitStatus(text) {
  setDomStatus(text);
  if (text === lastStatus) return;
  lastStatus = text;
  bridge().postStatus(text);
}

function core() {
  return window.PostureCore || null;
}

function resolveThresholds(input) {
  const defaults = core() && core().THRESHOLD_DEFAULTS;
  if (!defaults) return input || null;
  if (!input || typeof input !== 'object') return defaults;
  return Object.assign({}, defaults, input);
}

function toUrl(pathOrUrl) {
  const value = String(pathOrUrl || '');
  if (/^(file|https?):/i.test(value)) return value;
  if (/^[a-zA-Z]:[\\/]/.test(value)) {
    const abs = value.replace(/\\/g, '/');
    return new URL('file:///' + abs).href;
  }
  return new URL(value, location.href).href;
}

function stripTrailingSlash(url) {
  return String(url || '').replace(/\/+$/, '');
}

function loadClassicScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('脚本加载失败 ' + src));
    document.head.appendChild(script);
  });
}

async function ensureVision(payload) {
  function ready(vision) {
    return vision && vision.FilesetResolver && vision.FaceLandmarker && vision.PoseLandmarker;
  }
  if (ready(window.Vision)) return window.Vision;
  if (payload && payload.visionScriptPath) await loadClassicScript(toUrl(payload.visionScriptPath));
  if (ready(window.Vision)) return window.Vision;
  throw new Error('Vision 脚本未加载');
}

function readBytes(url) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';
    xhr.onload = () => {
      if (xhr.status === 200 || (xhr.status === 0 && xhr.response)) {
        resolve(new Uint8Array(xhr.response));
        return;
      }
      reject(new Error('读取失败 ' + xhr.status + ' ' + url));
    };
    xhr.onerror = () => reject(new Error('读取失败 ' + url));
    xhr.send();
  });
}

/**
 * MediaPipe 的 wasm loader 注入脚本时写 crossorigin=anonymous。
 * file:// 没有 CORS 头，Chromium 会直接拒绝。src 已经先赋成 vision_wasm_*.js，这里只跳过这一支。
 */
function neutralizeWasmScriptCrossOrigin() {
  if (crossOriginPatched) return;
  crossOriginPatched = true;
  const ScriptProto = window.HTMLScriptElement && window.HTMLScriptElement.prototype;
  if (!ScriptProto) return;
  const desc = Object.getOwnPropertyDescriptor(ScriptProto, 'crossOrigin');
  if (!desc || typeof desc.set !== 'function') return;
  Object.defineProperty(ScriptProto, 'crossOrigin', {
    configurable: true,
    enumerable: desc.enumerable,
    get: desc.get,
    set(value) {
      const src = String(this.src || '');
      if (location.protocol === 'file:' && src.indexOf('vision_wasm_') !== -1) return;
      desc.set.call(this, value);
    },
  });
}

function nextTimestamp() {
  const now = Math.round(performance.now());
  lastTs = now > lastTs ? now : lastTs + 1;
  return lastTs;
}

function setVideoEnabled(enabled) {
  if (videoTrack) videoTrack.enabled = !!enabled;
}

function setPaused(next) {
  paused = !!next;
  setVideoEnabled(!paused);
  if (!engine) {
    emitStatus(paused ? '已暂停' : lastStatus || '等待初始化');
    return;
  }
  emitStatus(paused ? '已暂停' : engine.mode === 'calib' ? '校准中' : '监控中');
}

function replaceEngine(thr) {
  const shared = core();
  if (!shared || typeof shared.Engine !== 'function') return false;
  currentThresholds = resolveThresholds(thr);
  engine = new shared.Engine(currentThresholds);
  return true;
}

function buildMockLandmarks() {
  mockFace = [];
  for (let i = 0; i < 478; i++) mockFace.push({ x: 0.5, y: 0.45, z: 0, visibility: 1 });
  mockFace[33] = { x: 0.32, y: 0.42, z: 0, visibility: 1 };
  mockFace[133] = { x: 0.44, y: 0.42, z: 0, visibility: 1 };
  mockFace[263] = { x: 0.68, y: 0.42, z: 0, visibility: 1 };
  mockFace[362] = { x: 0.56, y: 0.42, z: 0, visibility: 1 };
  mockFace[159] = { x: 0.36, y: 0.4, z: 0, visibility: 1 };
  mockFace[145] = { x: 0.36, y: 0.44, z: 0, visibility: 1 };
  mockFace[386] = { x: 0.64, y: 0.4, z: 0, visibility: 1 };
  mockFace[374] = { x: 0.64, y: 0.44, z: 0, visibility: 1 };
  mockFace[13] = { x: 0.5, y: 0.58, z: 0, visibility: 1 };
  mockFace[14] = { x: 0.5, y: 0.62, z: 0, visibility: 1 };
  mockFace[61] = { x: 0.42, y: 0.6, z: 0, visibility: 1 };
  mockFace[291] = { x: 0.58, y: 0.6, z: 0, visibility: 1 };
  mockFace[10] = { x: 0.5, y: 0.2, z: 0, visibility: 1 };
  mockFace[152] = { x: 0.5, y: 0.85, z: 0, visibility: 1 };
  mockFace[127] = { x: 0.3, y: 0.5, z: 0, visibility: 1 };
  mockFace[356] = { x: 0.7, y: 0.5, z: 0, visibility: 1 };

  mockPose = [];
  for (let i = 0; i < 33; i++) mockPose.push({ x: 0.5, y: 0.4, z: 0, visibility: 1 });
  mockPose[11] = { x: 0.35, y: 0.62, z: 0, visibility: 1 };
  mockPose[12] = { x: 0.65, y: 0.62, z: 0, visibility: 1 };
  mockPose[7] = { x: 0.42, y: 0.28, z: 0, visibility: 1 };
  mockPose[8] = { x: 0.58, y: 0.28, z: 0, visibility: 1 };
  mockPose[2] = { x: 0.4, y: 0.3, z: 0, visibility: 1 };
  mockPose[5] = { x: 0.6, y: 0.3, z: 0, visibility: 1 };
}

function shutdown() {
  shutDown = true;
  if (timer) {
    clearTimeout(timer);
    timer = 0;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
  videoTrack = null;
  const video = document.getElementById('camera');
  if (video) video.srcObject = null;
  if (faceLandmarker && typeof faceLandmarker.close === 'function') faceLandmarker.close();
  if (poseLandmarker && typeof poseLandmarker.close === 'function') poseLandmarker.close();
  faceLandmarker = null;
  poseLandmarker = null;
  emitStatus('已关闭');
}

function onCommand(cmd) {
  if (!cmd || typeof cmd !== 'object') return;
  const type = cmd.type;
  if (type === 'pause') setPaused(true);
  else if (type === 'resume') setPaused(false);
  else if (type === 'recalibrate') {
    if (engine) engine.recalibrate();
    if (!paused) emitStatus('校准中');
  } else if (type === 'shutdown') shutdown();
  else if (type === 'set-thresholds' || type === 'set' || type === 'set thr dump') {
    if (cmd.thresholds && replaceEngine(cmd.thresholds) && !paused) emitStatus('校准中');
  }
}

async function modelBaseOptions(url) {
  if (/^https?:/i.test(url)) return { modelAssetPath: url, delegate: 'CPU' };
  const buf = await readBytes(url);
  return { modelAssetBuffer: buf, delegate: 'CPU' };
}

async function initVision(payload) {
  const shared = core();
  if (!shared || typeof shared.Engine !== 'function' || typeof shared.computeFaceMetrics !== 'function') {
    throw new Error('PostureCore 未加载');
  }
  const vision = await ensureVision(payload);
  neutralizeWasmScriptCrossOrigin();
  const wasmBase = stripTrailingSlash(toUrl(payload.wasmPath || WASM_FALLBACK));
  const fileset = await vision.FilesetResolver.forVisionTasks(wasmBase);
  if (shutDown) return;
  const faceUrl = toUrl(payload.faceModelPath);
  const poseUrl = toUrl(payload.poseModelPath);
  faceLandmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
    baseOptions: await modelBaseOptions(faceUrl),
    runningMode: 'VIDEO',
    numFaces: 1,
    // 下视（B）用 blendshape；虹膜点随官方 face_landmarker.task 一并给出（C 表观尺度预留）。
    outputFaceBlendshapes: true,
  });
  if (shutDown) return;
  poseLandmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
    baseOptions: await modelBaseOptions(poseUrl),
    runningMode: 'VIDEO',
    numPoses: 1,
  });
}

async function openCamera() {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    throw new Error('当前环境没有摄像头接口');
  }
  mediaStream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480 },
  });
  videoTrack = (mediaStream.getVideoTracks && mediaStream.getVideoTracks()[0]) || null;
  setVideoEnabled(!paused);
  const video = document.getElementById('camera');
  if (!video) throw new Error('缺少 video#camera');
  video.muted = true;
  video.srcObject = mediaStream;
  await video.play();
}

function sampleFrame(video) {
  const shared = core();
  const ts = nextTimestamp();
  let face = null;
  let pose = null;
  let facePresent = false;
  if (mockMode) {
    face = shared.computeFaceMetrics(mockFace, currentThresholds);
    pose = shared.computePostureMetrics(mockPose);
    facePresent = !!face;
    bridge().postFace(facePresent);
    if (!paused) emitStatus('模拟中');
    return;
  } else if (video && video.readyState >= 2 && faceLandmarker && poseLandmarker) {
    const faceRes = faceLandmarker.detectForVideo(video, ts);
    const poseRes = poseLandmarker.detectForVideo(video, ts);
    const faceLms = faceRes && faceRes.faceLandmarks && faceRes.faceLandmarks[0];
    const poseLms = poseRes && poseRes.landmarks && poseRes.landmarks[0];
    facePresent = !!(faceLms && faceLms.length);
    if (facePresent && faceLms.length > 386) {
      face = shared.computeFaceMetrics(faceLms, currentThresholds);
      const blend =
        faceRes &&
        faceRes.faceBlendshapes &&
        faceRes.faceBlendshapes[0] &&
        faceRes.faceBlendshapes[0].categories;
      if (typeof shared.withGazeAndIris === 'function') {
        face = shared.withGazeAndIris(face, { blendshapes: blend, landmarks: faceLms });
      }
    }
    if (poseLms && poseLms.length > 12) pose = shared.computePostureMetrics(poseLms);
  } else {
    return;
  }
  bridge().postFace(facePresent);
  const events = engine.update(face, pose);
  for (let i = 0; i < events.length; i++) bridge().postEvent(events[i]);
  if (!paused) emitStatus(engine.mode === 'calib' ? '校准中' : '监控中');
}

function tick() {
  if (shutDown) return;
  timer = setTimeout(tick, FRAME_MS);
  if (paused || !engine) return;
  try {
    sampleFrame(document.getElementById('camera'));
  } catch (err) {
    reportError(err);
  }
}

function startLoop() {
  if (timer || shutDown) return;
  timer = setTimeout(tick, FRAME_MS);
}

function startMock(reason) {
  mockMode = true;
  buildMockLandmarks();
  if (!replaceEngine(currentThresholds)) return;
  console.warn('[posture] allowMock：模拟关键点（不 postEvent）：' + reason);
  emitStatus(paused ? '已暂停' : '模拟中');
  startLoop();
}

async function boot(payload) {
  paused = !!payload.paused;
  currentThresholds = resolveThresholds(payload.thresholds);
  const allowMock = !!(payload && payload.allowMock);
  if (!core()) {
    reportError('PostureCore 未加载');
    emitStatus('检测失败');
    return;
  }
  try {
    await initVision(payload);
  } catch (err) {
    if (shutDown) return;
    reportError('MediaPipe 加载失败：' + messageOf(err));
    if (allowMock) {
      startMock(messageOf(err));
      return;
    }
    emitStatus('检测失败');
    return;
  }
  if (shutDown) return;
  emitStatus('模型已就绪');
  try {
    await openCamera();
  } catch (err) {
    if (shutDown) return;
    reportError('无法打开摄像头：' + messageOf(err));
    return;
  }
  if (shutDown) return;
  if (!replaceEngine(currentThresholds)) {
    reportError('PostureCore 未加载');
    return;
  }
  emitStatus(paused ? '已暂停' : '校准中');
  startLoop();
}

function start(payload) {
  if (shutDown) return;
  if (bootStarted) {
    if (payload && typeof payload.paused === 'boolean') setPaused(payload.paused);
    if (payload && payload.thresholds) replaceEngine(payload.thresholds);
    return;
  }
  if (!payload || !payload.faceModelPath || !payload.poseModelPath) {
    reportError('缺少模型路径');
    return;
  }
  if (!core()) {
    reportError('PostureCore 未加载');
    return;
  }
  bootStarted = true;
  boot(payload).catch((err) => {
    if (!shutDown) reportError(err);
  });
}

function payloadFromSearch() {
  const q = new URLSearchParams(location.search);
  const faceModelPath = q.get('faceModelPath');
  const poseModelPath = q.get('poseModelPath');
  if (!faceModelPath || !poseModelPath) return null;
  let thresholds = null;
  const raw = q.get('thresholds');
  if (raw) {
    try {
      thresholds = JSON.parse(raw);
    } catch (err) {
      console.error('[posture] thresholds 查询参数不是 JSON');
    }
  }
  const pausedFlag = q.get('paused');
  const allowMockFlag = q.get('allowMock');
  return {
    faceModelPath,
    poseModelPath,
    wasmPath: q.get('wasmPath') || '',
    thresholds,
    paused: pausedFlag === '1' || pausedFlag === 'true',
    allowMock: allowMockFlag === '1' || allowMockFlag === 'true',
  };
}

emitStatus('等待初始化');
bridge().onCommand(onCommand);
bridge().onInit(start);
const fromSearch = payloadFromSearch();
if (fromSearch) start(fromSearch);

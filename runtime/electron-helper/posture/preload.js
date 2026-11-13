/**
 * 坐姿隐藏窗 preload：只转发 posture:* 通道，不持有检测状态。
 *
 * 渲染端是 file:// 经典脚本，不能直接碰 ipcRenderer。频道名必须与主进程逐字一致
 * （主进程接线在后续任务）。本文件不暴露 petBridge。
 *
 * 渲染 → 主：
 * - posture:event   { type, message }
 * - posture:face    boolean
 * - posture:status  string
 * - posture:error   string
 * 主 → 渲染：
 * - posture:init    { faceModelPath, poseModelPath, thresholds, paused, wasmPath?, visionScriptPath? }
 * - posture:command { type: 'pause'|'resume'|'recalibrate'|'set-thresholds'|'shutdown', thresholds? }
 *
 * init / command 可能早于页面脚本注册回调，这里先记下来，onInit/onCommand 注册时补投。
 * @module dsh-pet/runtime/electron-helper/posture/preload
 */
const { contextBridge, ipcRenderer } = require('electron');

let pendingInit = null;
const initListeners = [];
const pendingCommands = [];
let commandListener = null;

ipcRenderer.on('posture:init', (_event, payload) => {
  pendingInit = payload;
  for (const cb of initListeners) cb(payload);
});

ipcRenderer.on('posture:command', (_event, cmd) => {
  if (commandListener) commandListener(cmd);
  else pendingCommands.push(cmd);
});

contextBridge.exposeInMainWorld('postureBridge', {
  postEvent(event) {
    ipcRenderer.send('posture:event', event);
  },
  postFace(present) {
    ipcRenderer.send('posture:face', !!present);
  },
  postStatus(text) {
    ipcRenderer.send('posture:status', String(text ?? ''));
  },
  postError(message) {
    ipcRenderer.send('posture:error', String(message ?? ''));
  },
  onInit(cb) {
    if (typeof cb !== 'function') return;
    initListeners.push(cb);
    if (pendingInit) cb(pendingInit);
  },
  onCommand(cb) {
    if (typeof cb !== 'function') return;
    commandListener = cb;
    while (pendingCommands.length) cb(pendingCommands.shift());
  },
});

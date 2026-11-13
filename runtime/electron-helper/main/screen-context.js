'use strict';
/**
 * 屏幕感知：碎碎念触发时按需截屏（不再独立定时摘要）。
 *
 * 算法与下列 TypeScript 保持一致（helper 是 CJS，不直接 require 那些 .ts）：
 * - src/shared/screen-context/schedule.ts  shouldStartTick（启用且不忙才截）
 * - src/shared/screen-context/blacklist.ts  isBlacklisted
 * - src/shared/screen-context/store.ts      createScreenContextStore
 * - src/shared/screen-context/config.ts     load / merge
 * - src/shared/screen-context/defaults.ts   默认配置
 *
 * 控制口不单独 listen，由 posture-api.js 的同一 http.Server 把
 * `/screen-context/config` 与 `/screen-context/command` 转进来。
 * `op: 'capture'` 返回内存 JPEG，供宿主碎碎念一次带图生成。
 * @module dsh-pet/runtime/electron-helper/main/screen-context
 */

const crypto = require('node:crypto');

/** 与 src/shared/screen-context/store.ts 的 SCREEN_CONTEXT_SKIP_NOTE 相同。 */
const SCREEN_CONTEXT_SKIP_NOTE = '本轮因黑名单跳过截屏';

const DEFAULT_TITLES = ['密码', 'Password', '银行', '支付', '钱包', '私密', '1Password', 'Bitwarden'];
const DEFAULT_PROCESSES = ['KeePass', '1Password', 'Bitwarden'];

function cloneDefaultConfig() {
  return {
    enabled: false,
    intervalSec: 300,
    persistSummary: false,
    blacklist: {
      titles: DEFAULT_TITLES.slice(),
      processes: DEFAULT_PROCESSES.slice(),
    },
  };
}

/** 给调用方看的默认值。不要就地改。 */
const DEFAULT_SCREEN_CONTEXT_CONFIG = cloneDefaultConfig();

/**
 * 与 src/shared/screen-context/schedule.ts 相同。
 *
 * @param {{ enabled: boolean, busy: boolean }} input
 * @returns {boolean}
 */
function shouldStartTick({ enabled, busy }) {
  return !!enabled && !busy;
}

function matchesAny(haystack, needles) {
  const lower = String(haystack || '').toLowerCase();
  for (const needle of needles) {
    if (needle && lower.includes(String(needle).toLowerCase())) return true;
  }
  return false;
}

/**
 * 与 src/shared/screen-context/blacklist.ts 相同：标题或进程名子串，大小写不敏感。
 *
 * @param {Array<{ title?: string, processName?: string }>} windows
 * @param {{ titles?: string[], processes?: string[] }} blacklist
 * @returns {boolean}
 */
function isBlacklisted(windows, blacklist) {
  const titles = blacklist && Array.isArray(blacklist.titles) ? blacklist.titles : [];
  const processes = blacklist && Array.isArray(blacklist.processes) ? blacklist.processes : [];
  for (const win of windows || []) {
    if (!win || typeof win !== 'object') continue;
    if (matchesAny(win.title, titles)) return true;
    if (matchesAny(win.processName, processes)) return true;
  }
  return false;
}

function persistFlag(deps) {
  const flag = deps.persistSummary;
  return typeof flag === 'function' ? !!flag() : !!flag;
}

/**
 * 内存摘要。语义对齐 store.ts。
 * persistSummary 可以是布尔，也可以是函数：helper 改配置后下一轮 setOk 才看得到新值。
 * 因此只要有 readFile 和 statePath 就挂上 loadFromDisk（TS 版在创建时看一次布尔）。
 *
 * @param {object} deps
 * @returns {object}
 */
function createScreenContextStore(deps) {
  const options = deps || {};
  let status = 'idle';
  let lastOkText = '';
  let lastOkAt = 0;
  let lastError;
  let skipNote;

  function canPersist() {
    return persistFlag(options) && typeof options.writeFile === 'function' && typeof options.statePath === 'string';
  }

  function persistOk(text, updatedAt) {
    if (!canPersist()) return;
    options.writeFile(options.statePath, JSON.stringify({ text, updatedAt }, null, 2));
  }

  function persistClear() {
    if (!canPersist()) return;
    options.writeFile(options.statePath, JSON.stringify({ text: '', updatedAt: 0 }, null, 2));
  }

  function get() {
    const snapshot = { status, text: lastOkText, updatedAt: lastOkAt };
    if (lastError !== undefined) {
      snapshot.lastError = lastError;
      snapshot.errorMessage = lastError;
    }
    if (skipNote !== undefined) snapshot.skipNote = skipNote;
    return snapshot;
  }

  function setOk(text, now) {
    status = 'ok';
    lastOkText = text;
    lastOkAt = now;
    lastError = undefined;
    skipNote = undefined;
    persistOk(text, now);
  }

  function setSkipped(_now) {
    status = 'skipped';
    lastError = undefined;
    skipNote = SCREEN_CONTEXT_SKIP_NOTE;
  }

  function setError(message, _now) {
    status = 'error';
    lastError = message;
    skipNote = undefined;
  }

  function clear() {
    status = 'idle';
    lastOkText = '';
    lastOkAt = 0;
    lastError = undefined;
    skipNote = undefined;
    persistClear();
  }

  function loadFromDisk() {
    if (!persistFlag(options) || typeof options.readFile !== 'function' || !options.statePath) return;
    try {
      const parsed = JSON.parse(options.readFile(options.statePath));
      const text = parsed && typeof parsed.text === 'string' ? parsed.text : '';
      const updatedAt = parsed && typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0;
      if (text && updatedAt > 0) {
        status = 'ok';
        lastOkText = text;
        lastOkAt = updatedAt;
        lastError = undefined;
        skipNote = undefined;
      } else {
        status = 'idle';
        lastOkText = '';
        lastOkAt = 0;
        lastError = undefined;
        skipNote = undefined;
      }
    } catch (error) {
      if (error && error.code === 'ENOENT') return;
      throw error;
    }
  }

  const store = { get, setOk, setSkipped, setError, clear };
  if (typeof options.readFile === 'function' && options.statePath) store.loadFromDisk = loadFromDisk;
  return store;
}

/** 与 config.ts mergeStringArray 相同：显式空数组保留，非数组才回退默认。 */
function mergeStringArray(value, fallback) {
  if (!Array.isArray(value)) return fallback.slice();
  const out = [];
  for (const item of value) {
    if (typeof item === 'string') out.push(item);
  }
  return out;
}

/** 与 config.ts mergeScreenContextConfig 相同。 */
function mergeScreenContextConfig(parsed) {
  const out = cloneDefaultConfig();
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out;
  if ('intervalSec' in parsed) {
    const value = parsed.intervalSec;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) out.intervalSec = value;
  }
  if (typeof parsed.enabled === 'boolean') out.enabled = parsed.enabled;
  if (typeof parsed.persistSummary === 'boolean') out.persistSummary = parsed.persistSummary;
  if (parsed.blacklist && typeof parsed.blacklist === 'object') {
    if ('titles' in parsed.blacklist) out.blacklist.titles = mergeStringArray(parsed.blacklist.titles, DEFAULT_TITLES);
    if ('processes' in parsed.blacklist) {
      out.blacklist.processes = mergeStringArray(parsed.blacklist.processes, DEFAULT_PROCESSES);
    }
  }
  return out;
}

function cloneConfig(cfg) {
  return {
    enabled: !!cfg.enabled,
    intervalSec: cfg.intervalSec,
    persistSummary: !!cfg.persistSummary,
    blacklist: {
      titles: cfg.blacklist.titles.slice(),
      processes: cfg.blacklist.processes.slice(),
    },
  };
}

/**
 * 读配置。缺文件、坏 JSON 都回默认。readFile 抛错也回默认（对齐 config.ts 的 catch）。
 *
 * @param {() => string} readFile
 * @returns {object}
 */
function loadScreenContextConfig(readFile) {
  try {
    return mergeScreenContextConfig(JSON.parse(readFile()));
  } catch {
    return cloneDefaultConfig();
  }
}

/**
 * @param {(path: string, content: string) => void} writeFile
 * @param {string} configPath
 * @param {object} cfg
 */
function saveScreenContextConfig(writeFile, configPath, cfg) {
  writeFile(configPath, JSON.stringify(cfg, null, 2));
}

/**
 * 没有视觉通道时的明确失败。main 已改走 createScreenSummarizer，不再把这个函数装进控制器。
 *
 * @returns {Promise<{ ok: false, message: string }>}
 */
async function summarizeScreenUnavailable() {
  return { ok: false, message: '当前模型或通道不支持屏幕理解' };
}

/**
 * 按需截屏控制器（无定时器）。
 *
 * @param {object} deps
 * @param {() => Promise<{ mediaType?: string, data?: string } | null>} deps.captureScreen
 * @param {() => Promise<Array<{ title: string, processName: string }>>} deps.listWindows
 * @param {() => object} deps.loadConfig
 * @param {(cfg: object) => void} deps.saveConfig
 * @param {object} deps.store
 * @param {() => number} [deps.now]
 * @param {(message: string) => void} [deps.log]
 * @param {typeof shouldStartTick} [deps.shouldStartTick]
 * @param {typeof isBlacklisted} [deps.isBlacklisted]
 * @returns {{ startFromConfig: Function, setEnabled: Function, updateConfig: Function, stop: Function, getState: Function, captureForWhisper: Function }}
 */
function createScreenContextController(deps) {
  if (!deps || !deps.store) throw new Error('屏幕感知需要 store');
  const store = deps.store;
  const decideTick = deps.shouldStartTick || shouldStartTick;
  const decideBlacklist = deps.isBlacklisted || isBlacklisted;
  const now = typeof deps.now === 'function' ? () => deps.now() : () => Date.now();
  const log = typeof deps.log === 'function' ? deps.log : () => {};

  let config = cloneDefaultConfig();
  let busy = false;

  function persist() {
    deps.saveConfig(cloneConfig(config));
  }

  function dropSummaryIfEphemeral(wasEnabled) {
    if (wasEnabled && !config.enabled && !config.persistSummary && typeof store.clear === 'function') {
      store.clear();
    }
  }

  /**
   * 碎碎念触发时截一帧。返回 JPEG base64；黑名单跳过时 `skipped: true` 且无 data。
   * 调用方用完后应丢掉 data（HTTP 层在写出响应后清空）。
   */
  async function captureForWhisper() {
    if (!decideTick({ enabled: config.enabled, busy })) {
      return { ok: false, reason: busy ? 'busy' : 'disabled' };
    }
    busy = true;
    let shot = null;
    try {
      const windows = await deps.listWindows();
      if (decideBlacklist(Array.isArray(windows) ? windows : [], config.blacklist)) {
        store.setSkipped(now());
        return { ok: true, skipped: true };
      }
      shot = await deps.captureScreen();
      if (!shot || typeof shot.data !== 'string' || !shot.data) {
        store.setError('截屏失败', now());
        return { ok: false, reason: 'capture-failed', message: '截屏失败' };
      }
      const mediaType = shot.mediaType || 'image/jpeg';
      const data = shot.data;
      store.setOk('已在最近一次碎碎念时看过屏幕', now());
      return { ok: true, skipped: false, mediaType, data };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(message);
      try {
        store.setError(message, now());
      } catch {
        /* store 自己失败就不再向外抛 */
      }
      return { ok: false, reason: 'capture-failed', message };
    } finally {
      if (shot) shot.data = null;
      shot = null;
      busy = false;
    }
  }

  function startFromConfig() {
    try {
      config = mergeScreenContextConfig(deps.loadConfig());
    } catch (error) {
      log(error instanceof Error ? error.message : String(error));
      config = cloneDefaultConfig();
    }
    if (config.persistSummary && typeof store.loadFromDisk === 'function') {
      try {
        store.loadFromDisk();
      } catch (error) {
        log(error instanceof Error ? error.message : String(error));
      }
    }
  }

  function setEnabled(enabled) {
    const wasEnabled = config.enabled;
    config.enabled = !!enabled;
    dropSummaryIfEphemeral(wasEnabled);
    persist();
  }

  function updateConfig(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return;
    const wasEnabled = config.enabled;
    if (typeof patch.enabled === 'boolean') config.enabled = patch.enabled;
    if (typeof patch.persistSummary === 'boolean') config.persistSummary = patch.persistSummary;
    if (typeof patch.intervalSec === 'number' && Number.isFinite(patch.intervalSec) && patch.intervalSec > 0) {
      config.intervalSec = patch.intervalSec;
    }
    if (patch.blacklist && typeof patch.blacklist === 'object') {
      if (Array.isArray(patch.blacklist.titles)) {
        config.blacklist.titles = patch.blacklist.titles.filter((item) => typeof item === 'string');
      }
      if (Array.isArray(patch.blacklist.processes)) {
        config.blacklist.processes = patch.blacklist.processes.filter((item) => typeof item === 'string');
      }
    }
    dropSummaryIfEphemeral(wasEnabled);
    persist();
  }

  function stop() {
    /* 无定时器可清；保留接口供 main 退出时调用 */
  }

  function getState() {
    return { config: cloneConfig(config), state: store.get(), busy };
  }

  return { startFromConfig, setEnabled, updateConfig, stop, getState, captureForWhisper };
}

function json(res, status, body) {
  if (res.writableEnded) return;
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function isLoopback(req) {
  const addr = req.socket && req.socket.remoteAddress;
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function tokensEqual(expected, supplied) {
  if (typeof expected !== 'string' || typeof supplied !== 'string' || supplied.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 65536) {
        const error = new Error('too large');
        error.code = 'too-large';
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function snapshot(controller) {
  const view = controller.getState();
  return {
    ok: true,
    helper: true,
    config: view.config,
    state: view.state,
    busy: !!view.busy,
  };
}

function validateStringList(value, label) {
  if (!Array.isArray(value)) return { ok: false, message: label + '必须是字符串数组' };
  const list = [];
  for (const item of value) {
    if (typeof item !== 'string') return { ok: false, message: label + '必须是字符串数组' };
    list.push(item);
  }
  return { ok: true, list };
}

/**
 * 校验配置补丁。允许间隔、黑名单、启用、是否落盘摘要。
 *
 * @param {object} input
 * @returns {{ ok: true, patch: object } | { ok: false, message: string }}
 */
function validateScreenContextPatch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, message: '屏幕感知配置必须是对象' };
  }
  const patch = {};
  let count = 0;
  if ('intervalSec' in input) {
    if (typeof input.intervalSec !== 'number' || !Number.isFinite(input.intervalSec) || input.intervalSec <= 0) {
      return { ok: false, message: '截屏间隔必须是大于 0 的秒数' };
    }
    patch.intervalSec = input.intervalSec;
    count += 1;
  }
  if ('enabled' in input) {
    if (typeof input.enabled !== 'boolean') return { ok: false, message: '开关必须是布尔值' };
    patch.enabled = input.enabled;
    count += 1;
  }
  if ('persistSummary' in input) {
    if (typeof input.persistSummary !== 'boolean') return { ok: false, message: '开关必须是布尔值' };
    patch.persistSummary = input.persistSummary;
    count += 1;
  }
  if ('blacklist' in input) {
    if (!input.blacklist || typeof input.blacklist !== 'object' || Array.isArray(input.blacklist)) {
      return { ok: false, message: '黑名单必须是对象' };
    }
    const blacklist = {};
    if ('titles' in input.blacklist) {
      const parsed = validateStringList(input.blacklist.titles, '标题黑名单');
      if (!parsed.ok) return parsed;
      blacklist.titles = parsed.list;
    }
    if ('processes' in input.blacklist) {
      const parsed = validateStringList(input.blacklist.processes, '进程黑名单');
      if (!parsed.ok) return parsed;
      blacklist.processes = parsed.list;
    }
    if (!('titles' in blacklist) && !('processes' in blacklist)) {
      return { ok: false, message: '黑名单至少要有标题或进程' };
    }
    patch.blacklist = blacklist;
    count += 1;
  }
  if (count === 0) return { ok: false, message: '没有可保存的屏幕感知设置' };
  return { ok: true, patch };
}

/**
 * @param {object} input
 * @returns {{ ok: true, command: object } | { ok: false, message: string }}
 */
function validateScreenContextCommand(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, message: '屏幕感知命令必须是对象' };
  }
  if (input.op !== 'enable' && input.op !== 'disable' && input.op !== 'patch' && input.op !== 'capture') {
    return { ok: false, message: '未知的屏幕感知操作' };
  }
  if (input.op === 'patch') {
    const parsed = validateScreenContextPatch(input.patch);
    if (!parsed.ok) return parsed;
    return { ok: true, command: { op: 'patch', patch: parsed.patch } };
  }
  if (input.patch !== undefined) return { ok: false, message: '该操作不接受配置补丁' };
  return { ok: true, command: { op: input.op } };
}

function applyScreenContextOp(controller, command) {
  if (command.op === 'enable') controller.setEnabled(true);
  else if (command.op === 'disable') controller.setEnabled(false);
  else if (command.op === 'patch') controller.updateConfig(command.patch);
  else if (command.op === 'capture') return;
  else throw new Error('未知的屏幕感知操作');
}

/**
 * 处理一次屏幕感知控制请求。令牌与坐姿控制口相同（x-dsh-posture-token）。
 *
 * @param {{ controller: object | null, token: string, log?: Function }} deps
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
async function handleScreenContextRequest(deps, req, res) {
  if (!isLoopback(req)) {
    json(res, 403, { ok: false, message: '仅允许本机访问' });
    return;
  }
  const header = req.headers['x-dsh-posture-token'];
  if (!tokensEqual(deps.token, Array.isArray(header) ? header[0] : header)) {
    json(res, 403, { ok: false, message: '屏幕感知服务拒绝了本次控制' });
    return;
  }
  if (!deps.controller) {
    json(res, 503, { ok: false, message: '屏幕感知未装配' });
    return;
  }
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const isConfig = url.pathname === '/screen-context/config';
  const isCommand = url.pathname === '/screen-context/command';
  const method = req.method || 'GET';
  if (!isConfig && !isCommand) {
    json(res, 404, { ok: false, message: '没有这条屏幕感知接口' });
    return;
  }
  if (isConfig && method !== 'GET' && method !== 'POST') {
    json(res, 405, { ok: false, message: '仅支持 GET 或 POST' });
    return;
  }
  if (isCommand && method !== 'POST') {
    json(res, 405, { ok: false, message: '仅支持 POST' });
    return;
  }
  try {
    if (method === 'GET') {
      json(res, 200, snapshot(deps.controller));
      return;
    }
    const text = await readBody(req);
    let raw;
    try {
      raw = text ? JSON.parse(text) : {};
    } catch {
      json(res, 400, { ok: false, message: '请求格式无效' });
      return;
    }
    if (isCommand) {
      const parsed = validateScreenContextCommand(raw);
      if (!parsed.ok) {
        json(res, 400, parsed);
        return;
      }
      if (parsed.command.op === 'capture') {
        const capture = await deps.controller.captureForWhisper();
        const body = Object.assign(snapshot(deps.controller), { capture });
        json(res, 200, body);
        if (capture && typeof capture === 'object' && 'data' in capture) capture.data = null;
        return;
      }
      applyScreenContextOp(deps.controller, parsed.command);
    } else {
      const parsed = validateScreenContextPatch(raw);
      if (!parsed.ok) {
        json(res, 400, parsed);
        return;
      }
      deps.controller.updateConfig(parsed.patch);
    }
    json(res, 200, snapshot(deps.controller));
  } catch (error) {
    if (error && error.code === 'too-large') {
      json(res, 413, { ok: false, message: '请求正文过大' });
      return;
    }
    if (typeof deps.log === 'function') deps.log(error instanceof Error ? error.message : String(error));
    json(res, 500, { ok: false, message: '屏幕感知控制失败' });
  }
}

/**
 * 把截图交给宿主的视觉摘要。走现有 hostRequest：bridge 是本进程管道，
 * 独立模式 HTTP 由 bridge 自己带上 X-DSH-Pet-Token。不把 JPEG 写盘。
 *
 * @param {{ hostRequest: Function, petRoute: string }} deps
 * @returns {(shot: { mediaType?: string, data?: string }) => Promise<{ ok: boolean, text?: string, message?: string }>}
 */
function createScreenSummarizer({ hostRequest, petRoute }) {
  const root = String(petRoute || '').replace(/\/+$/, '');
  return async function summarizeScreen(shot) {
    const mediaType = shot && typeof shot.mediaType === 'string' && shot.mediaType ? shot.mediaType : 'image/jpeg';
    const data = shot && typeof shot.data === 'string' ? shot.data : '';
    try {
      const resp = await hostRequest('POST', root + '/screen-context/summarize', JSON.stringify({ mediaType, data }));
      let body = {};
      try {
        body = JSON.parse(resp && resp.body ? resp.body : '{}');
      } catch {
        body = {};
      }
      if (body && body.ok === true && typeof body.text === 'string') return { ok: true, text: body.text };
      const message = body && typeof body.message === 'string' && body.message ? body.message : '屏幕摘要失败';
      return { ok: false, message: data && message.includes(data) ? '屏幕摘要失败' : message };
    } catch (error) {
      const raw = error instanceof Error ? error.message : '屏幕摘要请求失败';
      return { ok: false, message: data && raw.includes(data) ? '屏幕摘要请求失败' : raw };
    }
  };
}

module.exports = {
  DEFAULT_SCREEN_CONTEXT_CONFIG,
  SCREEN_CONTEXT_SKIP_NOTE,
  shouldStartTick,
  isBlacklisted,
  createScreenContextStore,
  loadScreenContextConfig,
  saveScreenContextConfig,
  summarizeScreenUnavailable,
  createScreenSummarizer,
  createScreenContextController,
  handleScreenContextRequest,
  validateScreenContextPatch,
  validateScreenContextCommand,
};

'use strict';
/**
 * 坐姿控制口：只听 127.0.0.1，把 HTTP 操作交给 postureController。
 *
 * 设置页不能直接连这个端口（CSP 只允许同源）。独立模式读 posture-api.json 里的端口和令牌再转发。
 * 写操作进 setEnabled / setPaused / recalibrate / updateConfig，不在这里另写一份配置文件。
 * 同一台 Server 还挂屏幕感知：`/screen-context/config` 与 `/screen-context/command`。
 * 不另开端口；令牌仍是端口文件里的那一枚（请求头 x-dsh-posture-token）。
 * @module dsh-pet/runtime/electron-helper/main/posture-api
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { handleScreenContextRequest } = require('./screen-context.js');

/** 端口文件名，与设置页 POSTURE_API_FILE 一致。 */
const POSTURE_API_FILE = 'posture-api.json';
/** 端口文件里的名字，与设置页 POSTURE_API_NAME 一致。 */
const POSTURE_API_NAME = 'dsh-pet-posture-api';

const COOLDOWNS = new Set([5, 10, 30]);
const SENSITIVITIES = new Set(['strict', 'standard', 'loose']);
const OPS = new Set(['enable', 'disable', 'pause', 'resume', 'recalibrate', 'patch']);
/** 系统通知已下线；toast 补丁不再接受。 */
const BOOL_KEYS = ['enabled', 'paused', 'beep', 'petPerform'];

/**
 * 校验配置补丁。规则与 src/standalone/settings-page/posture-settings.ts 保持一致。
 *
 * @param input - 请求体。
 * @returns `{ ok, patch }` 或 `{ ok:false, message }`。
 */
function validatePosturePatch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, message: '坐姿配置必须是对象' };
  }
  const patch = {};
  let count = 0;
  if ('sensitivity' in input) {
    if (typeof input.sensitivity !== 'string' || !SENSITIVITIES.has(input.sensitivity)) {
      return { ok: false, message: '灵敏度只能是严格、标准或宽松' };
    }
    patch.sensitivity = input.sensitivity;
    count += 1;
  }
  if ('cooldown' in input) {
    if (typeof input.cooldown !== 'number' || !COOLDOWNS.has(input.cooldown)) {
      return { ok: false, message: '冷却只能是 5、10 或 30 秒' };
    }
    patch.cooldown = input.cooldown;
    count += 1;
  }
  for (const key of BOOL_KEYS) {
    if (!(key in input)) continue;
    if (typeof input[key] !== 'boolean') return { ok: false, message: '开关必须是布尔值' };
    patch[key] = input[key];
    count += 1;
  }
  if (count === 0) return { ok: false, message: '没有可保存的坐姿设置' };
  return { ok: true, patch };
}

/**
 * 校验坐姿命令。
 *
 * @param input - `{ op, patch? }`。
 * @returns `{ ok, command }` 或 `{ ok:false, message }`。
 */
function validatePostureCommand(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, message: '坐姿命令必须是对象' };
  }
  if (typeof input.op !== 'string' || !OPS.has(input.op)) {
    return { ok: false, message: '未知的坐姿操作' };
  }
  if (input.op === 'patch') {
    const parsed = validatePosturePatch(input.patch);
    if (!parsed.ok) return parsed;
    return { ok: true, command: { op: 'patch', patch: parsed.patch } };
  }
  if (input.patch !== undefined) return { ok: false, message: '该操作不接受配置补丁' };
  return { ok: true, command: { op: input.op } };
}

/**
 * 把一条命令交给控制器。调用方必须先校验。
 *
 * @param controller - createPostureController 的返回值。
 * @param command - validatePostureCommand 给出的 command。
 */
function applyPostureOp(controller, command) {
  if (command.op === 'enable') controller.setEnabled(true);
  else if (command.op === 'disable') controller.setEnabled(false);
  else if (command.op === 'pause') controller.setPaused(true);
  else if (command.op === 'resume') controller.setPaused(false);
  else if (command.op === 'recalibrate') controller.recalibrate();
  else if (command.op === 'patch') controller.updateConfig(command.patch);
  else throw new Error('未知的坐姿操作');
}

/** 控制器当前配置和状态，给设置页一次拿全。 */
function snapshot(controller) {
  return {
    ok: true,
    helper: true,
    config: controller.getConfig(),
    runtime: controller.getRuntime(),
  };
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
  if (typeof supplied !== 'string' || supplied.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 8192) {
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

/**
 * 处理一次控制口请求。
 *
 * @param deps.controller - 坐姿控制器。
 * @param deps.token - 与端口文件里相同的令牌。
 * @param deps.log - 可选日志。
 * @param req - Node 请求。
 * @param res - Node 响应。
 */
async function handlePostureRequest(deps, req, res) {
  if (!isLoopback(req)) {
    json(res, 403, { ok: false, message: '仅允许本机访问' });
    return;
  }
  const header = req.headers['x-dsh-posture-token'];
  if (!tokensEqual(deps.token, Array.isArray(header) ? header[0] : header)) {
    json(res, 403, { ok: false, message: '坐姿服务拒绝了本次控制' });
    return;
  }
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const isConfig = url.pathname === '/posture/config';
  const isCommand = url.pathname === '/posture/command';
  const method = req.method || 'GET';
  if (!isConfig && !isCommand) {
    json(res, 404, { ok: false, message: '没有这条坐姿接口' });
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
      const parsed = validatePostureCommand(raw);
      if (!parsed.ok) {
        json(res, 400, parsed);
        return;
      }
      applyPostureOp(deps.controller, parsed.command);
    } else {
      const parsed = validatePosturePatch(raw);
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
    json(res, 500, { ok: false, message: '坐姿控制失败' });
  }
}

/**
 * 造控制口。start 监听随机端口并写下 posture-api.json；stop 关掉监听并删掉自己的端口文件。
 *
 * @param deps.controller - 坐姿控制器。
 * @param deps.screenContext - 可选。屏幕感知控制器；有它才处理 `/screen-context/*`。
 * @param deps.apiPath - 端口文件绝对路径。
 * @param deps.token - 可选。缺省时自己生成，只写入端口文件。
 * @param deps.log - 可选日志。
 * @returns `{ start, stop, token }`。
 */
function createPostureApi(deps) {
  const token = deps.token || crypto.randomBytes(32).toString('base64url');
  let server = null;

  function start() {
    if (server) {
      const addr = server.address();
      const port = addr && typeof addr === 'object' ? addr.port : 0;
      return Promise.resolve(port);
    }
    return new Promise((resolve, reject) => {
      const httpServer = http.createServer((req, res) => {
        let pathname = '/';
        try {
          pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
        } catch {
          pathname = '/';
        }
        if (pathname === '/screen-context/config' || pathname === '/screen-context/command') {
          void handleScreenContextRequest(
            { controller: deps.screenContext || null, token, log: deps.log },
            req,
            res,
          );
          return;
        }
        void handlePostureRequest({ controller: deps.controller, token, log: deps.log }, req, res);
      });
      server = httpServer;
      httpServer.on('error', (error) => {
        server = null;
        reject(error);
      });
      httpServer.listen(0, '127.0.0.1', () => {
        const addr = httpServer.address();
        const port = addr && typeof addr === 'object' ? addr.port : 0;
        try {
          fs.mkdirSync(path.dirname(deps.apiPath), { recursive: true });
          fs.writeFileSync(deps.apiPath, JSON.stringify({ name: POSTURE_API_NAME, port, token }, null, 2), {
            encoding: 'utf8',
            mode: 0o600,
          });
          if (typeof deps.log === 'function') deps.log('control listening 127.0.0.1:' + port);
          resolve(port);
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  function stop() {
    const current = server;
    server = null;
    if (current) current.close();
    try {
      const raw = JSON.parse(fs.readFileSync(deps.apiPath, 'utf8'));
      if (raw && raw.token === token) fs.unlinkSync(deps.apiPath);
    } catch (error) {
      if (!error || error.code === 'ENOENT') return;
      if (typeof deps.log === 'function') deps.log(error instanceof Error ? error.message : String(error));
    }
  }

  function address() {
    if (!server) return null;
    const addr = server.address();
    const port = addr && typeof addr === 'object' ? addr.port : 0;
    if (!port) return null;
    return { port, token };
  }

  return { start, stop, token, address };
}

/** 菜单点下去时控制口还没听上。文案与设置页 POSTURE_CONTROL_UNAVAILABLE 相同。 */
const POSTURE_CONTROL_UNAVAILABLE = '桌面宠物未在运行，坐姿守护无法控制';

/**
 * 把一次菜单操作打到本进程的 `/posture/command` 或 `/posture/config`。
 *
 * 设置页经独立模式转发后也落在这两个路径上，校验和 setEnabled / setPaused / recalibrate
 * 仍只在 handlePostureRequest 里做。这里不碰控制器。
 *
 * @param deps.address - `{ port, token }`，来自 createPostureApi().address()。
 * @param deps.method - `GET` 或 `POST`。
 * @param deps.path - `/posture/config` 或 `/posture/command`。
 * @param deps.body - POST 正文；GET 不传。
 * @param deps.fetchImpl - 测试可换掉。
 * @returns 控制口的 JSON；连不上时 `{ ok:false }`。
 */
async function callPostureEndpoint(deps) {
  const address = deps.address;
  const pathName = deps.path === '/posture/config' || deps.path === '/posture/command' ? deps.path : '';
  if (!address || typeof address.port !== 'number' || !address.port || typeof address.token !== 'string') {
    return { ok: false, helper: false, message: POSTURE_CONTROL_UNAVAILABLE };
  }
  if (!pathName) return { ok: false, message: '没有这条坐姿接口' };
  const method = deps.method === 'POST' ? 'POST' : 'GET';
  if (pathName === '/posture/command' && method !== 'POST') return { ok: false, message: '仅支持 POST' };
  const fetchImpl = deps.fetchImpl || fetch;
  const headers = { 'x-dsh-posture-token': address.token };
  let body;
  if (deps.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(deps.body);
  }
  let response;
  try {
    response = await fetchImpl('http://127.0.0.1:' + address.port + pathName, {
      method,
      headers,
      body,
      redirect: 'error',
    });
  } catch {
    return { ok: false, helper: false, message: POSTURE_CONTROL_UNAVAILABLE };
  }
  const text = typeof response.text === 'function' ? await response.text() : '';
  try {
    const parsed = text ? JSON.parse(text) : null;
    return parsed && typeof parsed === 'object' ? parsed : { ok: false, message: '坐姿服务应答异常' };
  } catch {
    return { ok: false, message: '坐姿服务应答异常' };
  }
}

module.exports = {
  POSTURE_API_FILE,
  POSTURE_API_NAME,
  POSTURE_CONTROL_UNAVAILABLE,
  createPostureApi,
  handlePostureRequest,
  validatePosturePatch,
  validatePostureCommand,
  applyPostureOp,
  callPostureEndpoint,
};

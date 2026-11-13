/**
 * 内置路由处理器：设置页、连通性自检与模型清单。
 *
 * 不负责分发与监听；请求体已由上层解析并限长。
 * 必须始终成立：设置页只回本机数据，绝不回显凭据。
 * @module dsh-pet/src/standalone/server/handlers
 */
import { publicSettings, validateSettings, type StandaloneSettingsService } from '../settings.ts';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { rejectRequest } from '../request-security.ts';
import type { ModelDiscoveryInput } from '../ai-provider/types.ts';
import {
  POSTURE_COMMAND_PATH,
  POSTURE_COMMAND_ROUTE,
  POSTURE_CONFIG_PATH,
  POSTURE_CONFIG_ROUTE,
  validatePostureCommand,
  validatePosturePatch,
} from '../settings-page/posture-settings.ts';
import { createFilePostureBridge, relayPosture, type PostureRelayDeps } from './posture-bridge.ts';
import { createFileScreenContextBridge, relayScreenContext, type ScreenContextRelayDeps } from './screen-context-bridge.ts';
import {
  SCREEN_CONTEXT_COMMAND_PATH,
  SCREEN_CONTEXT_COMMAND_ROUTE,
  SCREEN_CONTEXT_CONFIG_PATH,
  SCREEN_CONTEXT_CONFIG_ROUTE,
  validateScreenContextCommand,
  validateScreenContextPatch,
} from '../settings-page/screen-context-settings.ts';
import { sendJson } from './respond.ts';

/** 读完请求体并解析成 JSON；空体当作空对象。 */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    req.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    req.once('end', resolve);
    req.once('error', reject);
  });
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

/** 只接受对象形态的草稿；数组、标量与 null 一律当未填。 */
function asDraft(body: unknown): ModelDiscoveryInput {
  return body !== null && typeof body === 'object' && !Array.isArray(body) ? (body as ModelDiscoveryInput) : {};
}

/**
 * 创建设置读写处理器（GET 读，POST 存）。
 * @param ai - 设置服务。
 * @returns 处理请求的异步函数。
 */
export function settingsHandler(
  ai: StandaloneSettingsService | undefined,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  let windowStart = Date.now();
  let count = 0;
  return async (req, res) => {
    if (!ai) {
      rejectRequest(res, 503, '本机 AI 设置尚未就绪');
      return;
    }
    if (req.method === 'GET') {
      sendJson(res, 200, publicSettings(ai.getSettings()));
      return;
    }
    if (req.method !== 'POST') {
      rejectRequest(res, 405, '仅支持 GET 或 POST');
      return;
    }
    if (Date.now() - windowStart >= 60000) {
      windowStart = Date.now();
      count = 0;
    }
    count += 1;
    // 保存是重操作，按一分钟窗口限流，避免设置页反复重试打爆磁盘。
    if (count > 20) {
      rejectRequest(res, 429, '保存过于频繁，请稍后再试');
      return;
    }
    if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      rejectRequest(res, 415, '请使用 JSON 保存设置');
      return;
    }
    try {
      const input = validateSettings(await readJsonBody(req));
      sendJson(res, 200, publicSettings(await ai.saveSettings(input)));
    } catch {
      rejectRequest(res, 400, '设置未保存：请检查接口地址、模型名称、密钥和数值范围');
    }
  };
}

/**
 * 创建连通性测试处理器（POST）。
 * @param ai - 设置服务。
 * @returns 处理请求的异步函数。
 */
export function testHandler(
  ai: StandaloneSettingsService | undefined,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (req.method !== 'POST') {
      rejectRequest(res, 405, '仅支持 POST');
      return;
    }
    try {
      const input = asDraft(await readJsonBody(req));
      if (ai?.testConnection) sendJson(res, 200, await ai.testConnection(input));
      else sendJson(res, 200, { ok: false, message: '当前环境未配置测试能力' });
    } catch {
      sendJson(res, 400, { ok: false, message: '请求格式无效' });
    }
  };
}

/**
 * 创建模型清单处理器（POST）。
 * @param ai - 设置服务。
 * @returns 处理请求的异步函数。
 */
export function modelsHandler(
  ai: StandaloneSettingsService | undefined,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (req.method !== 'POST') {
      rejectRequest(res, 405, '仅支持 POST');
      return;
    }
    if (!ai?.discoverModels) {
      sendJson(res, 200, { ok: false, code: 'input', message: '当前环境未配置模型清单能力' });
      return;
    }
    try {
      sendJson(res, 200, await ai.discoverModels(asDraft(await readJsonBody(req))));
    } catch {
      sendJson(res, 400, { ok: false, code: 'input', message: '请求格式无效' });
    }
  };
}

/**
 * 创建余额查询处理器（POST）。
 *
 * 服务商与密钥都取自已保存的设置，请求体不参与：避免调用方把密钥经查询接口再传一遍。
 * @param ai - 设置服务。
 * @returns 处理请求的异步函数。
 */
export function balanceHandler(
  ai: StandaloneSettingsService | undefined,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (req.method !== 'POST') {
      rejectRequest(res, 405, '仅支持 POST');
      return;
    }
    if (!ai?.queryBalance) {
      sendJson(res, 200, { ok: false, provider: '', reason: 'unsupported' });
      return;
    }
    try {
      sendJson(res, 200, await ai.queryBalance());
    } catch {
      sendJson(res, 200, { ok: false, provider: '', reason: 'fetch-error', message: '余额查询失败' });
    }
  };
}

/**
 * 坐姿配置与命令。GET/POST `/dsh-pet-7340/posture/config`，POST `.../posture/command`。
 *
 * 校验在本进程做完，再转发到正在运行的 helper 控制器。helper 不在时写操作直接失败。
 * @param relay - 读端口文件和发请求的替身；缺省读 `$DSH_HOME/dsh-pet`。
 * @returns 处理请求的异步函数。
 */
export function postureHandler(
  relay: PostureRelayDeps = createFilePostureBridge(),
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    let pathname: string;
    try {
      pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    } catch {
      rejectRequest(res, 400, '请求地址无效');
      return;
    }
    const isConfig = pathname === POSTURE_CONFIG_PATH;
    const isCommand = pathname === POSTURE_COMMAND_PATH;
    if (!isConfig && !isCommand) {
      rejectRequest(res, 404, '没有这条坐姿接口');
      return;
    }
    const method = req.method ?? 'GET';
    if (isConfig && method !== 'GET' && method !== 'POST') {
      rejectRequest(res, 405, '仅支持 GET 或 POST');
      return;
    }
    if (isCommand && method !== 'POST') {
      rejectRequest(res, 405, '仅支持 POST');
      return;
    }
    let upstreamBody: unknown;
    if (method === 'POST') {
      const contentType = String(req.headers['content-type'] ?? '')
        .split(';')[0]
        .trim()
        .toLowerCase();
      if (contentType !== 'application/json') {
        rejectRequest(res, 415, '请使用 JSON');
        return;
      }
      let raw: unknown;
      try {
        raw = await readJsonBody(req);
      } catch {
        rejectRequest(res, 400, '请求格式无效');
        return;
      }
      if (isCommand) {
        const parsed = validatePostureCommand(raw);
        if (!parsed.ok) {
          sendJson(res, 400, { ok: false, message: parsed.message });
          return;
        }
        upstreamBody = parsed.command;
      } else {
        const parsed = validatePosturePatch(raw);
        if (!parsed.ok) {
          sendJson(res, 400, { ok: false, message: parsed.message });
          return;
        }
        upstreamBody = parsed.patch;
      }
    }
    const result = await relayPosture({
      ...relay,
      record: relay.readRecord(),
      method: method === 'POST' ? 'POST' : 'GET',
      upstreamPath: isCommand ? POSTURE_COMMAND_ROUTE : POSTURE_CONFIG_ROUTE,
      body: upstreamBody,
    });
    sendJson(res, result.status, result.body);
  };
}

/**
 * 屏幕感知配置与命令。GET/POST `/dsh-pet-7340/screen-context/config`，POST `.../screen-context/command`。
 *
 * 校验在本进程做完，再转发到正在运行的 helper 控制口（与坐姿同一端口和令牌）。
 * helper 不在时写操作直接失败。
 * @param relay - 读端口文件和发请求的替身；缺省读 `$DSH_HOME/dsh-pet`。
 * @returns 处理请求的异步函数。
 */
export function screenContextHandler(
  relay: ScreenContextRelayDeps = createFileScreenContextBridge(),
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    let pathname: string;
    try {
      pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    } catch {
      rejectRequest(res, 400, '请求地址无效');
      return;
    }
    const isConfig = pathname === SCREEN_CONTEXT_CONFIG_PATH;
    const isCommand = pathname === SCREEN_CONTEXT_COMMAND_PATH;
    if (!isConfig && !isCommand) {
      rejectRequest(res, 404, '没有这条屏幕感知接口');
      return;
    }
    const method = req.method ?? 'GET';
    if (isConfig && method !== 'GET' && method !== 'POST') {
      rejectRequest(res, 405, '仅支持 GET 或 POST');
      return;
    }
    if (isCommand && method !== 'POST') {
      rejectRequest(res, 405, '仅支持 POST');
      return;
    }
    let upstreamBody: unknown;
    if (method === 'POST') {
      const contentType = String(req.headers['content-type'] ?? '')
        .split(';')[0]
        .trim()
        .toLowerCase();
      if (contentType !== 'application/json') {
        rejectRequest(res, 415, '请使用 JSON');
        return;
      }
      let raw: unknown;
      try {
        raw = await readJsonBody(req);
      } catch {
        rejectRequest(res, 400, '请求格式无效');
        return;
      }
      if (isCommand) {
        const parsed = validateScreenContextCommand(raw);
        if (!parsed.ok) {
          sendJson(res, 400, { ok: false, message: parsed.message });
          return;
        }
        upstreamBody = parsed.command;
      } else {
        const parsed = validateScreenContextPatch(raw);
        if (!parsed.ok) {
          sendJson(res, 400, { ok: false, message: parsed.message });
          return;
        }
        upstreamBody = parsed.patch;
      }
    }
    const result = await relayScreenContext({
      ...relay,
      record: relay.readRecord(),
      method: method === 'POST' ? 'POST' : 'GET',
      upstreamPath: isCommand ? SCREEN_CONTEXT_COMMAND_ROUTE : SCREEN_CONTEXT_CONFIG_ROUTE,
      body: upstreamBody,
    });
    sendJson(res, result.status, result.body);
  };
}

/**
 * 把内存里的 JPEG 放进 OpenAI 兼容或 Anthropic 的多模态消息。
 *
 * 不走会丢弃图片块的文本解析，也不把截图写进磁盘或错误文案。
 * @module dsh-pet/src/standalone/screen-context-vision
 */
import type { StandaloneAiSettings } from './ai-config.ts';
import { isolatedFetch, type AiFetch } from './ai-transport.ts';
import {
  SCREEN_SUMMARY_UNSUPPORTED,
  type ScreenImage,
  type ScreenSummaryLlmResult,
  type ScreenSummaryRequest,
} from './screen-context-summarize.ts';

/** 服务商用这些说法表示当前模型不能看图。 */
const VISION_UNSUPPORTED = /image_url|does not support image|unsupported image|vision|multimodal/i;

/**
 * 发送一次带图摘要请求。
 *
 * @param settings - 独立模式成品配置。
 * @param fetcher - 可替换的 fetch。
 * @param request - 已带中文指示和内存 JPEG 的摘要请求。
 * @returns 模型原文，或结构化失败。
 */
export async function postStandaloneVision(
  settings: StandaloneAiSettings,
  fetcher: AiFetch,
  request: ScreenSummaryRequest,
): Promise<ScreenSummaryLlmResult> {
  if (!settings.baseUrl || !settings.model || !settings.apiKey) {
    return { ok: false, unsupported: true, message: SCREEN_SUMMARY_UNSUPPORTED };
  }
  if (request.signal?.aborted) return { ok: false, message: '屏幕摘要已取消' };
  const anthropic = settings.protocol === 'anthropic';
  const base = settings.baseUrl.replace(/\/+$/, '');
  const opus =
    anthropic && settings.model === 'claude-opus-5-5' && new URL(base).origin === 'https://api.anthropic.com';
  const url = anthropic ? `${base}/v1/messages${opus ? '?beta=true' : ''}` : `${base}/chat/completions`;
  // 输出上限跟独立模式其它调用一样，用设置里的 maxTokens，不再单独封顶。
  const payload = anthropic
    ? anthropicVisionPayload(settings.model, request.instruction, request.image, settings.maxTokens)
    : openAiVisionPayload(settings.model, request.instruction, request.image, settings.maxTokens);
  try {
    const response = await isolatedFetch(settings, fetcher)(url, {
      method: 'POST',
      body: JSON.stringify(payload),
      signal: request.signal,
    });
    if (!response.ok) return failureFromStatus(response, request.image.data, settings.apiKey);
    const text = anthropic ? anthropicText(await response.json()) : openAiText(await response.json());
    if (text === null) return { ok: false, message: '模型拒绝了这次屏幕理解' };
    return { ok: true, text };
  } catch (error) {
    if (request.signal?.aborted) return { ok: false, message: '屏幕摘要已取消' };
    const raw = error instanceof Error ? error.message : String(error);
    if (raw === '' || raw.includes(request.image.data) || raw.includes(settings.apiKey)) {
      return { ok: false, message: '屏幕摘要失败' };
    }
    return { ok: false, message: raw.length > 200 ? raw.slice(0, 200) : raw };
  }
}

/** OpenAI 兼容：文本指示与 data URL 形式的 JPEG。 */
function openAiVisionPayload(model: string, instruction: string, image: ScreenImage, maxTokens: number) {
  return {
    model,
    stream: false,
    n: 1,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: instruction },
      {
        role: 'user',
        content: [
          { type: 'text', text: instruction },
          { type: 'image_url', image_url: { url: `data:${image.mediaType};base64,${image.data}` } },
        ],
      },
    ],
  };
}

/** Anthropic：base64 图片块，不写文件。 */
function anthropicVisionPayload(model: string, instruction: string, image: ScreenImage, maxTokens: number) {
  return {
    model,
    max_tokens: maxTokens,
    system: instruction,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: instruction },
          { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } },
        ],
      },
    ],
  };
}

/** OpenAI 非流式正文。拒绝时返回 null。 */
function openAiText(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return '';
  const choices = (payload as { choices?: unknown }).choices;
  const list = Array.isArray(choices) ? choices : [];
  const choice =
    list.find((item) => typeof item === 'object' && item !== null && (item as { index?: unknown }).index === 0) ??
    list[0];
  if (typeof choice !== 'object' || choice === null) return '';
  const message = (choice as { message?: unknown }).message;
  if (typeof message !== 'object' || message === null) return '';
  if ((message as { refusal?: unknown }).refusal) return null;
  const content = (message as { content?: unknown }).content;
  return typeof content === 'string' ? content : '';
}

/** Anthropic 非流式正文。拒绝时返回 null。 */
function anthropicText(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return '';
  if ((payload as { stop_reason?: unknown }).stop_reason === 'refusal') return null;
  const content = (payload as { content?: unknown }).content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (typeof block !== 'object' || block === null) return '';
      if ((block as { type?: unknown }).type !== 'text') return '';
      const text = (block as { text?: unknown }).text;
      return typeof text === 'string' ? text : '';
    })
    .join('');
}

/**
 * 失败响应只留固定文案。
 * 先看原文是否在说「不能看图」，再丢掉可能含截图或密钥的正文。
 */
async function failureFromStatus(
  response: Response,
  imageData: string,
  apiKey: string,
): Promise<ScreenSummaryLlmResult> {
  let detail = '';
  try {
    detail = await response.text();
  } catch {
    detail = '';
  }
  const unsupported = response.status === 400 && VISION_UNSUPPORTED.test(detail);
  if (unsupported) return { ok: false, unsupported: true, message: SCREEN_SUMMARY_UNSUPPORTED };
  if (detail.includes(imageData) || (apiKey !== '' && detail.includes(apiKey))) {
    return { ok: false, message: '屏幕摘要失败' };
  }
  return { ok: false, message: '屏幕摘要失败' };
}

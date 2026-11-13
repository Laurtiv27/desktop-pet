/**
 * 屏幕截图的视觉摘要：把内存里的 JPEG 和中文短摘要指示交给可替换的 llmCall。
 *
 * 不落盘。对话通道若会丢掉图片字节，调用方不得改用纯文本结果冒充看图。
 * @module dsh-pet/src/standalone/screen-context-summarize
 */
import { parseRequest } from './ai-provider/request.ts';
import { PROVIDER } from './ai-provider/limits.ts';

/** 模型或通道无法把截图交到模型时的固定文案。 */
export const SCREEN_SUMMARY_UNSUPPORTED = '当前模型或通道不支持屏幕理解';

/**
 * 系统/用户指示：较细的中文段，禁止朗读隐私原文。
 * 模型无法判断时必须原样返回 {@link SCREEN_SUMMARY_UNKNOWN}。
 */
export const SCREEN_SUMMARY_INSTRUCTION =
  '请用中文详细描述用户当前屏幕在做什么。按下面四点写（能看见再写，看不清就写「看不清」）：' +
  '1）主应用或窗口名；2）可见的窗口标题、标签页或文件名；3）用户正在进行的具体操作或任务；' +
  '4）焦点区域里较关键的可见内容要点（例如代码文件路径、文档标题、网页主题）。' +
  '不要朗读密码、验证码、银行卡号或私聊原文；敏感处用「（已省略）」代替。' +
  '若完全无法判断，只回答：无法判断当前屏幕内容';

/** 无法判断时模型应返回的原文。 */
export const SCREEN_SUMMARY_UNKNOWN = '无法判断当前屏幕内容';

/** 一张只活在内存里的截图。`data` 是不带 data: 前缀的规范 base64。 */
export interface ScreenImage {
  readonly mediaType: string;
  readonly data: string;
}

/** 与对话看图相同的顺序：文本在前，图片在后。图片是内存字节，不是附件引用。 */
export type ScreenImageContent =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly mediaType: string; readonly data: string };

/** 一次摘要请求：指示、原图，以及按对话形状排好的内容块。 */
export interface ScreenSummaryRequest {
  readonly instruction: string;
  readonly image: ScreenImage;
  readonly signal?: AbortSignal;
  readonly content: readonly ScreenImageContent[];
}

/** llmCall 的结论。`unsupported` 为真时对外文案固定。 */
export type ScreenSummaryLlmResult =
  | { ok: true; text: string }
  | { ok: false; message: string; unsupported?: boolean };

/** 可替换的模型调用。测试注入 mock；生产侧先试对话看图，再试视觉请求。 */
export type ScreenSummaryLlmCall = (request: ScreenSummaryRequest) => Promise<ScreenSummaryLlmResult>;

/** 摘要结论。 */
export type ScreenSummaryResult = { ok: true; text: string } | { ok: false; message: string };

/**
 * 排成对话看图的内容块。
 * 不带 `attachment` / `attachmentId`：那条路要先把图写入附件服务。
 */
export function chatImageContent(instruction: string, image: ScreenImage): readonly ScreenImageContent[] {
  return [
    { type: 'text', text: instruction },
    { type: 'image', mediaType: image.mediaType, data: image.data },
  ];
}

/**
 * 用独立模式真正的请求解析看图片字节会不会留下来。
 * 碎碎念带图后应为 `kept`；`dropped` 仅表示解析成功但丢了图。
 */
export function standaloneChatImageFate(
  content: readonly ScreenImageContent[],
  model: string,
): 'kept' | 'dropped' | 'rejected' {
  const image = content.find((block) => block.type === 'image');
  const data = image?.type === 'image' ? image.data : '';
  if (!data) return 'dropped';
  try {
    const { request } = parseRequest(
      {
        provider: PROVIDER,
        model,
        messages: [{ role: 'user', content: [...content] }],
      },
      model,
    );
    return JSON.stringify(request).includes(data) ? 'kept' : 'dropped';
  } catch {
    return 'rejected';
  }
}

/** 规范 base64：重新编码必须与原文一致，避免脏字符被悄悄丢掉。 */
function canonicalBase64(data: string): boolean {
  if (data === '') return false;
  const decoded = Buffer.from(data, 'base64');
  return decoded.length > 0 && decoded.toString('base64') === data;
}

/** 失败文案不得带回截图字节。 */
function safeFailure(error: unknown, imageData: string): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw === '' || raw.includes(imageData)) return '屏幕摘要失败';
  return raw.length > 200 ? raw.slice(0, 200) : raw;
}

/**
 * 概括一张截图。
 *
 * @param input.llmCall - 真正发往模型的调用；必须收到 JPEG base64 与中文指示。
 * @param input.image - 内存中的 JPEG。
 * @param input.signal - 取消信号，原样交给 llmCall。
 * @returns 成功是模型原文（仅 trim）；失败带 message，不抛。
 */
export async function summarizeScreenshot(input: {
  llmCall: ScreenSummaryLlmCall;
  image: ScreenImage;
  signal?: AbortSignal;
}): Promise<ScreenSummaryResult> {
  const { image, llmCall, signal } = input;
  if (image.mediaType !== 'image/jpeg' || !canonicalBase64(image.data)) {
    return { ok: false, message: '仅支持 JPEG 截图' };
  }
  const instruction = SCREEN_SUMMARY_INSTRUCTION;
  try {
    const result = await llmCall({
      instruction,
      image,
      signal,
      content: chatImageContent(instruction, image),
    });
    if (!result.ok) {
      if (result.unsupported) return { ok: false, message: SCREEN_SUMMARY_UNSUPPORTED };
      const message = result.message.includes(image.data) ? '屏幕摘要失败' : result.message;
      return { ok: false, message: message || '屏幕摘要失败' };
    }
    const text = result.text.trim();
    if (!text) return { ok: false, message: '模型未返回摘要' };
    return { ok: true, text };
  } catch (error) {
    return { ok: false, message: safeFailure(error, image.data) };
  }
}

/**
 * 先走对话看图。图片字节被丢掉或解析被拒绝时，不采用那次纯文本结果，改走视觉调用。
 */
export function createChatFirstLlmCall(deps: {
  model: string;
  project?: (content: readonly ScreenImageContent[], model: string) => 'kept' | 'dropped' | 'rejected';
  sendChat: (request: ScreenSummaryRequest) => Promise<ScreenSummaryLlmResult>;
  sendVision: (request: ScreenSummaryRequest) => Promise<ScreenSummaryLlmResult>;
}): ScreenSummaryLlmCall {
  const project = deps.project ?? standaloneChatImageFate;
  return async (request) => {
    if (project(request.content, deps.model) === 'kept') return deps.sendChat(request);
    return deps.sendVision(request);
  };
}

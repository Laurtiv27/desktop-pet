/**
 * 请求解析与取消：把外部输入收成已校验的对象，并让模型调用可中止。
 *
 * 不发起网络请求；只负责解析与把 AbortSignal 接到 Promise 上。
 * 必须始终成立：解析失败必须有明确错误，不返回半成品。
 * 文本与（碎碎念截屏用的）内存图片块都会保留；其它未知块丢弃。
 * @module dsh-pet/src/standalone/ai-provider/request
 */
import { type AiImagePart, type AiRequest, type AiTextMessage, type AiTextPart } from '../ai-transport.ts';
import { MAX_INPUT_CHARS, inputSchema, textBlock } from './limits.ts';

const MAX_IMAGE_BASE64 = 10_000_000;

function parseContentBlocks(blocks: unknown[]): string | Array<AiTextPart | AiImagePart> {
  const parts: Array<AiTextPart | AiImagePart> = [];
  let textOnly = '';
  let sawImage = false;
  for (const block of blocks) {
    if (typeof block !== 'object' || block === null || !('type' in block)) continue;
    const rec = block as Record<string, unknown>;
    if (rec.type === 'text') {
      const result = textBlock.safeParse(block);
      if (!result.success) throw new Error('Invalid standalone AI text input.');
      textOnly += result.data.text;
      parts.push({ type: 'text', text: result.data.text });
      continue;
    }
    if (rec.type === 'image') {
      const mediaType = typeof rec.mediaType === 'string' ? rec.mediaType : '';
      const data = typeof rec.data === 'string' ? rec.data : '';
      if (!mediaType || !data || data.length > MAX_IMAGE_BASE64) {
        throw new Error('Invalid standalone AI image input.');
      }
      sawImage = true;
      parts.push({ type: 'image', mediaType, data });
    }
  }
  if (sawImage) {
    if (parts.length === 0) throw new Error('Standalone AI input is empty or exceeds limits.');
    return parts;
  }
  return textOnly;
}

/**
 * 把调用方输入收敛为消息序列（可含截屏图）。
 * @param options - 调用方请求。
 * @param model - 当前选中的模型。
 * @returns 规范化请求与可选的取消信号。
 * @throws 输入越界、角色顺序不合法或模型不匹配时抛出。
 */
export function parseRequest(options: unknown, model: string): { request: AiRequest; signal?: AbortSignal } {
  const parsed = inputSchema.safeParse(options);
  if (!parsed.success || parsed.data.model !== model)
    throw new Error('Invalid standalone AI model selection or input.');
  const { data } = parsed;
  const messages: AiTextMessage[] = [];
  for (const message of data.messages) {
    const content =
      typeof message.content === 'string' ? message.content : parseContentBlocks(message.content);
    if (typeof content === 'string') {
      if (content.trim().length === 0) continue;
      messages.push({ role: message.role, content });
      continue;
    }
    const hasText = content.some((part) => part.type === 'text' && part.text.trim());
    if (!hasText && !content.some((part) => part.type === 'image')) continue;
    messages.push({ role: message.role, content });
  }
  const system = data.system ?? '';
  const size =
    system.length +
    messages.reduce((sum, message) => {
      if (typeof message.content === 'string') return sum + message.content.length;
      return (
        sum +
        message.content.reduce((inner, part) => (part.type === 'text' ? inner + part.text.length : inner), 0)
      );
    }, 0);
  if (
    size > MAX_INPUT_CHARS ||
    messages.length === 0 ||
    messages[0].role !== 'user' ||
    messages[messages.length - 1]?.role !== 'user'
  ) {
    throw new Error('Standalone AI input is empty or exceeds limits.');
  }
  return { request: { system, messages }, signal: data.signal };
}

/** 让等待中的读取也能响应取消。 */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('Standalone AI request cancelled.'));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error('Standalone AI request cancelled.'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

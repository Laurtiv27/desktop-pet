/**
 * 屏幕截图视觉摘要：mock llmCall，断言中文短摘要指示、JPEG 原样送出、失败结构化。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createStandaloneAi } from './ai-provider.ts';
import { DEFAULT_AI_SETTINGS, type StandaloneAiSettings } from './ai-config.ts';
import {
  SCREEN_SUMMARY_INSTRUCTION,
  SCREEN_SUMMARY_UNSUPPORTED,
  chatImageContent,
  createChatFirstLlmCall,
  standaloneChatImageFate,
  summarizeScreenshot,
  type ScreenSummaryLlmCall,
  type ScreenSummaryRequest,
} from './screen-context-summarize.ts';
import { postStandaloneVision } from './screen-context-vision.ts';

const JPEG = Buffer.from('jpeg-bytes').toString('base64');

function image() {
  return { mediaType: 'image/jpeg', data: JPEG };
}

test('把 JPEG base64 和中文详细摘要指示交给 llmCall，成功时只 trim 不截断', async () => {
  let seen: ScreenSummaryRequest | undefined;
  const llmCall: ScreenSummaryLlmCall = async (request) => {
    seen = request;
    return { ok: true, text: `  ${'在'.repeat(400)}  ` };
  };
  const signal = new AbortController().signal;
  const result = await summarizeScreenshot({ llmCall, image: image(), signal });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.text, '在'.repeat(400));
  assert.ok(seen);
  assert.match(seen.instruction, /中文/);
  assert.match(seen.instruction, /主应用/);
  assert.doesNotMatch(seen.instruction, /360|80个字|字以内/);
  assert.match(seen.instruction, /密码/);
  assert.match(seen.instruction, /验证码/);
  assert.match(seen.instruction, /私聊/);
  assert.match(seen.instruction, /无法判断当前屏幕内容/);
  assert.equal(seen.image.mediaType, 'image/jpeg');
  assert.equal(seen.image.data, JPEG);
  assert.equal(seen.signal, signal);
  assert.deepEqual(seen.content, chatImageContent(seen.instruction, image()));
  assert.equal(seen.content[0]?.type, 'text');
  assert.equal(seen.content[1]?.type, 'image');
  assert.equal('attachment' in seen.content[1], false);
  assert.equal(JSON.stringify(seen).includes('attachmentId'), false);
});

test('llmCall 失败或抛错时返回结构化失败，不把截图原文塞进 message', async () => {
  const failed = await summarizeScreenshot({
    llmCall: async () => ({ ok: false, message: '上游超时' }),
    image: image(),
  });
  assert.deepEqual(failed, { ok: false, message: '上游超时' });

  const thrown = await summarizeScreenshot({
    llmCall: async () => {
      throw new Error(`boom ${JPEG}`);
    },
    image: image(),
  });
  assert.equal(thrown.ok, false);
  if (thrown.ok) return;
  assert.equal(thrown.message.includes(JPEG), false);
});

test('通道标明不支持看图时使用固定文案', async () => {
  const result = await summarizeScreenshot({
    llmCall: async () => ({ ok: false, unsupported: true, message: '别的说法' }),
    image: image(),
  });
  assert.deepEqual(result, { ok: false, message: SCREEN_SUMMARY_UNSUPPORTED });
});

test('空摘要视为失败；模型返回无法判断时原样成功', async () => {
  const empty = await summarizeScreenshot({
    llmCall: async () => ({ ok: true, text: '   ' }),
    image: image(),
  });
  assert.equal(empty.ok, false);

  const unknown = await summarizeScreenshot({
    llmCall: async () => ({ ok: true, text: '无法判断当前屏幕内容' }),
    image: image(),
  });
  assert.deepEqual(unknown, { ok: true, text: '无法判断当前屏幕内容' });
});

test('非 JPEG、空数据或非法 base64 不调用 llmCall', async () => {
  let calls = 0;
  const llmCall: ScreenSummaryLlmCall = async () => {
    calls += 1;
    return { ok: true, text: '不该出现' };
  };
  for (const shot of [
    { mediaType: 'image/png', data: JPEG },
    { mediaType: 'image/jpeg', data: '' },
    { mediaType: 'image/jpeg', data: JPEG + '!' },
  ]) {
    const result = await summarizeScreenshot({ llmCall, image: shot });
    assert.equal(result.ok, false);
  }
  assert.equal(calls, 0);
});

test('独立模式对话管线会保留图片字节（碎碎念带图）', () => {
  const content = chatImageContent('请概括屏幕', image());
  assert.equal(standaloneChatImageFate(content, 'test-model'), 'kept');
});

test('图片能保留时走对话通道，不再改发第二路视觉', async () => {
  let visionCalls = 0;
  let chatCalls = 0;
  const llmCall = createChatFirstLlmCall({
    model: 'test-model',
    sendChat: async () => {
      chatCalls += 1;
      return { ok: true, text: '对话通道看见了' };
    },
    sendVision: async () => {
      visionCalls += 1;
      return { ok: true, text: '不该走这里' };
    },
  });
  const result = await summarizeScreenshot({ llmCall, image: image() });
  assert.deepEqual(result, { ok: true, text: '对话通道看见了' });
  assert.equal(chatCalls, 1);
  assert.equal(visionCalls, 0);
});

function settings(patch: Partial<StandaloneAiSettings> = {}): StandaloneAiSettings {
  return { ...DEFAULT_AI_SETTINGS, baseUrl: 'https://example.test/v1', model: 'vision-model', apiKey: 'test-secret', ...patch };
}

function summaryRequest(): ScreenSummaryRequest {
  return {
    instruction: SCREEN_SUMMARY_INSTRUCTION,
    image: image(),
    content: chatImageContent(SCREEN_SUMMARY_INSTRUCTION, image()),
  };
}

test('OpenAI 兼容通道把 JPEG base64 放进 image_url', async () => {
  let body = '';
  let auth = '';
  const result = await postStandaloneVision(settings(), async (url, init) => {
    body = String(init?.body);
    auth = new Headers(init?.headers).get('authorization') ?? '';
    assert.equal(String(url), 'https://example.test/v1/chat/completions');
    return Response.json({ choices: [{ index: 0, message: { content: '正在看代码' } }] });
  }, summaryRequest());
  assert.deepEqual(result, { ok: true, text: '正在看代码' });
  assert.equal(body.includes(JPEG), true);
  assert.match(body, /image_url/);
  assert.match(body, /密码/);
  assert.match(body, /验证码/);
  assert.equal(body.includes('attachmentId'), false);
  assert.equal(auth, 'Bearer test-secret');
});

test('Anthropic 通道把 JPEG base64 放进 image source', async () => {
  let body = '';
  let apiKey = '';
  const result = await postStandaloneVision(
    settings({ protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-test' }),
    async (url, init) => {
      body = String(init?.body);
      apiKey = new Headers(init?.headers).get('x-api-key') ?? '';
      assert.equal(String(url), 'https://api.anthropic.com/v1/messages');
      return Response.json({ content: [{ type: 'text', text: '在浏览网页' }] });
    },
    summaryRequest(),
  );
  assert.deepEqual(result, { ok: true, text: '在浏览网页' });
  const parsed = JSON.parse(body) as { messages: Array<{ content: Array<Record<string, unknown>> }> };
  const blocks = parsed.messages[0]?.content ?? [];
  const imageBlock = blocks.find((block) => block.type === 'image');
  assert.deepEqual(imageBlock?.source, { type: 'base64', media_type: 'image/jpeg', data: JPEG });
  assert.equal(apiKey, 'test-secret');
});

test('服务商拒绝看图时返回固定文案，其它失败不回显截图或密钥', async () => {
  const unsupported = await postStandaloneVision(
    settings(),
    async () => Response.json({ error: { message: 'model does not support image input' } }, { status: 400 }),
    summaryRequest(),
  );
  assert.deepEqual(unsupported, { ok: false, unsupported: true, message: SCREEN_SUMMARY_UNSUPPORTED });

  const leaked = await postStandaloneVision(
    settings(),
    async () => Response.json({ error: { message: `nope ${JPEG} test-secret` } }, { status: 500 }),
    summaryRequest(),
  );
  assert.equal(leaked.ok, false);
  if (leaked.ok) return;
  assert.equal(leaked.message.includes(JPEG), false);
  assert.equal(leaked.message.includes('test-secret'), false);
});

test('对话通道若真能带上图片，就用它的结果而不再发第二路', async () => {
  let visionCalls = 0;
  const llmCall = createChatFirstLlmCall({
    model: 'test-model',
    project: () => 'kept',
    sendChat: async (request) => {
      assert.equal(request.image.data, JPEG);
      return { ok: true, text: '对话通道看到了' };
    },
    sendVision: async () => {
      visionCalls += 1;
      return { ok: true, text: '不该走这里' };
    },
  });
  const result = await llmCall({
    instruction: '概括',
    image: image(),
    content: chatImageContent('概括', image()),
  });
  assert.deepEqual(result, { ok: true, text: '对话通道看到了' });
  assert.equal(visionCalls, 0);
});

const silent = { info() {}, warn() {}, error() {}, debug() {} };

test('带截屏图的 stream 走同一把锁；忙时第二路失败', async () => {
  const home = mkdtempSync(join(tmpdir(), 'pet-screen-single-lock-'));
  let releaseStream!: () => void;
  const streamGate = new Promise<void>((resolve) => {
    releaseStream = resolve;
  });
  let streamStarted = false;
  const ai = createStandaloneAi(home, silent, {
    fetch: async () => {
      streamStarted = true;
      await streamGate;
      return new Response(
        [
          'data: {"choices":[{"index":0,"delta":{"content":"碎"}}]}\n\n',
          'data: [DONE]\n\n',
        ].join(''),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  try {
    await ai.saveSettings({
      protocol: 'openai-compatible',
      baseUrl: 'https://example.test/v1',
      model: 'vision-model',
      apiKey: 'test-secret',
      timeoutMs: 5000,
    });
    const gen = ai.stream({
      provider: 'standalone',
      model: 'vision-model',
      system: 'system',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '看屏说一句' },
            { type: 'image', mediaType: 'image/jpeg', data: JPEG },
          ],
        },
      ],
    });
    const streamTask = (async () => {
      for await (const _ of gen) {
        /* drain */
      }
    })();
    for (let i = 0; i < 40 && !streamStarted; i += 1) {
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal(streamStarted, true);
    await assert.rejects(
      async () => {
        for await (const _ of ai.stream({
          provider: 'standalone',
          model: 'vision-model',
          messages: [{ role: 'user', content: '第二路' }],
        })) {
          /* */
        }
      },
      /busy/i,
    );
    releaseStream();
    await streamTask;
  } finally {
    releaseStream();
    ai.dispose();
    rmSync(home, { recursive: true, force: true });
  }
});

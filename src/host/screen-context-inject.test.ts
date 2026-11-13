/**
 * 碎碎念与聊天注入屏幕摘要。
 *
 * mock 控制口 GET 与快照，断言最终发给模型的 prompt 含或不含上下文。
 * 梦话不注入。不打真实 helper、不联网。
 *
 * 跑法：node --experimental-strip-types --import ./scripts/test-register.mjs --test src/host/screen-context-inject.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { SCREEN_CONTEXT_INJECT_PREFIX } from '../shared/screen-context/inject.ts';
import type { ScreenContextState } from '../shared/screen-context/types.ts';
import { generateWhisper, SLEEP_TALK_INSTRUCTION } from './whisper.ts';
import { createChatMemory, type ChatMemoryInput } from './plugin/chat-memory.ts';
import type { ConfigPaths } from './config.ts';
import {
  getScreenContextForInject,
  parseScreenContextConfigBody,
  type ScreenContextForInject,
} from './screen-context-inject.ts';

const INTERVAL = 300;
const SUMMARY = '在 IDE 里改桌宠';

function freshState(text = SUMMARY, status: ScreenContextState['status'] = 'ok'): ScreenContextState {
  return { status, text, updatedAt: Date.now() };
}

function snapshot(state: ScreenContextState = freshState(), intervalSec = INTERVAL): ScreenContextForInject {
  return { state, intervalSec };
}

function configBody(state: ScreenContextState, intervalSec = INTERVAL): unknown {
  return {
    ok: true,
    helper: true,
    config: {
      enabled: true,
      intervalSec,
      persistSummary: false,
      blacklist: { titles: [], processes: [] },
    },
    state,
    busy: false,
  };
}

/** 假模型：记下每次 stream 的完整参数，并回一句短文本。 */
function fakeCtx(captured: Record<string, unknown>[]) {
  return {
    agentDefaultModel: { currentSelection: () => ({ provider: 'test', model: 'test-model' }) },
    llm: {
      stream: (options: unknown) => {
        captured.push(options as Record<string, unknown>);
        return (async function* () {
          yield { type: 'text-delta', index: 0, text: '好呀' };
        })();
      },
    },
  };
}

function userTextOf(options: Record<string, unknown> | undefined): string {
  const messages = options?.messages as Array<{ content: Array<{ type: string; text?: string }> }> | undefined;
  const last = messages?.[messages.length - 1];
  return last?.content?.find((block) => block.type === 'text')?.text ?? '';
}

function countPrefix(text: string): number {
  return text.split(SCREEN_CONTEXT_INJECT_PREFIX).length - 1;
}

describe('parseScreenContextConfigBody', () => {
  test('GET /screen-context/config 体取出 state 与 intervalSec', () => {
    const state = freshState();
    const parsed = parseScreenContextConfigBody(configBody(state, 120));
    assert.deepEqual(parsed, { state, intervalSec: 120 });
  });

  test('形状不对 → null', () => {
    assert.equal(parseScreenContextConfigBody(null), null);
    assert.equal(parseScreenContextConfigBody({ ok: false, config: {}, state: freshState() }), null);
    assert.equal(parseScreenContextConfigBody({ ok: true, config: { intervalSec: 0 }, state: freshState() }), null);
    assert.equal(parseScreenContextConfigBody({ ok: true, config: { intervalSec: 300 } }), null);
  });
});

describe('getScreenContextForInject', () => {
  test('向 helper 控制口 GET /screen-context/config，带坐姿令牌', async () => {
    const state = freshState();
    let called = '';
    const headers: Record<string, string> = {};
    const parsed = await getScreenContextForInject({
      readRecord: () => ({ port: 43123, token: 'a'.repeat(43) }),
      fetchImpl: async (url, init) => {
        called = url;
        Object.assign(headers, init.headers);
        assert.equal(init.method, 'GET');
        assert.equal(init.redirect, 'error');
        return { status: 200, text: async () => JSON.stringify(configBody(state, 180)) };
      },
    });
    assert.equal(called, 'http://127.0.0.1:43123/screen-context/config');
    assert.equal(headers['X-DSH-Posture-Token'], 'a'.repeat(43));
    assert.deepEqual(parsed, { state, intervalSec: 180 });
  });

  test('没有端口文件或控制口失败 → null', async () => {
    const missing = await getScreenContextForInject({
      readRecord: () => null,
      fetchImpl: async () => {
        throw new Error('不应请求');
      },
    });
    assert.equal(missing, null);
    const failed = await getScreenContextForInject({
      readRecord: () => ({ port: 1, token: 'b'.repeat(43) }),
      fetchImpl: async () => ({ status: 503, text: async () => '' }),
    });
    assert.equal(failed, null);
  });
});

describe('generateWhisper —— 截屏与历史', () => {
  test('带截屏与历史时指令提示看图，并附 image 块', async () => {
    const captured: Record<string, unknown>[] = [];
    const result = await generateWhisper(fakeCtx(captured), {
      system: '你是桌宠',
      history: ['刚才在写代码'],
      screenShot: { mediaType: 'image/jpeg', data: 'QQ==' },
    });
    assert.equal(result.ok, true);
    const sent = captured[0];
    assert.ok(sent);
    assert.equal(sent.system, '你是桌宠');
    const instruction = userTextOf(sent);
    assert.match(instruction, /屏幕截图/);
    assert.ok(instruction.includes('刚才在写代码'));
    assert.ok(instruction.includes('喝水'));
    const messages = sent.messages as Array<{ content: Array<{ type: string; data?: string }> }>;
    assert.equal(messages[0]?.content?.some((b) => b.type === 'image' && b.data === 'QQ=='), true);
  });

  test('梦话即使带了截屏也不附 image 块', async () => {
    const captured: Record<string, unknown>[] = [];
    await generateWhisper(fakeCtx(captured), {
      system: '你是桌宠',
      instruction: SLEEP_TALK_INSTRUCTION,
      screenShot: { mediaType: 'image/jpeg', data: 'QQ==' },
      history: ['不该出现'],
    });
    const sent = captured[0];
    assert.ok(sent);
    assert.equal(userTextOf(sent), SLEEP_TALK_INSTRUCTION);
    const messages = sent.messages as Array<{ content: Array<{ type: string }> }>;
    assert.equal(messages[0]?.content?.some((b) => b.type === 'image'), false);
  });
});

function tempWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-screen-inject-'));
  const configPaths: ConfigPaths = {
    defaultFile: fileURLToPath(new URL('../../assets/config.jsonc', import.meta.url)),
    userFile: join(dir, 'main-config.jsonc'),
    petDir: join(dir, 'pet'),
  };
  writeFileSync(configPaths.userFile, '{}');
  return { dir, configPaths, userRoot: join(dir, 'user') };
}

function createMemory(
  captureScreen: () => Promise<{ mediaType: string; data: string } | null>,
  captured: Record<string, unknown>[],
) {
  const ws = tempWorkspace();
  const memory = createChatMemory({
    ctx: fakeCtx(captured),
    configPaths: ws.configPaths,
    log: { info: () => {}, warn: () => {}, error: () => {} },
    memeDirsFor: () => [],
    playback: { create: () => ({ playbackId: 'pb' }) },
    state: { writePet: () => {} },
    userRoot: ws.userRoot,
    captureScreen,
  } as unknown as ChatMemoryInput);
  return { ws, memory };
}

describe('chatWithPet / publishWhisper —— 截屏同步碎碎念', () => {
  test('聊天不再注入屏幕上下文', async () => {
    const captured: Record<string, unknown>[] = [];
    const { ws, memory } = createMemory(async () => ({ mediaType: 'image/jpeg', data: 'QQ==' }), captured);
    try {
      const result = await memory.chatWithPet('main', '在吗');
      assert.equal(result.ok, true);
      assert.equal(countPrefix(String(captured[0]?.system ?? '')), 0);
    } finally {
      rmSync(ws.dir, { recursive: true, force: true });
    }
  });

  test('碎碎念截屏带图；梦话不截屏', async () => {
    const captured: Record<string, unknown>[] = [];
    let captures = 0;
    const { ws, memory } = createMemory(async () => {
      captures += 1;
      return { mediaType: 'image/jpeg', data: 'QQ==' };
    }, captured);
    try {
      await memory.publishSleepTalk('main');
      assert.equal(captures, 0, '梦话不应截屏');
      assert.equal(userTextOf(captured[0]), SLEEP_TALK_INSTRUCTION);

      captured.length = 0;
      await memory.publishWhisper('main');
      assert.equal(captures, 1);
      assert.ok(userTextOf(captured[0]).includes('屏幕截图'));
      const messages = captured[0]?.messages as Array<{ content: Array<{ type: string }> }>;
      assert.equal(messages[0]?.content?.some((b) => b.type === 'image'), true);
    } finally {
      rmSync(ws.dir, { recursive: true, force: true });
    }
  });
});

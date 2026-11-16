/**
 * 独立模式设置页「表现」字段：草稿读入、保存体带回、宠物卡下拉。
 *
 * 契约：
 *   1. 读入 pets[].presentation，仅 spine 原样，其余回落 video；
 *   2. 保存体带上当前草稿的 presentation；
 *   3. 宠物卡有「表现」下拉（视频 / 骨骼）。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';

import { petCardScript } from './script/pet-card.ts';
import { petsScript } from './script/pets.ts';
import { coreScript } from './script/core.ts';
import { overlayScript } from './script/overlay.ts';
import { widgetsScript } from './script/widgets.ts';

interface FakeNode {
  nodeType: number;
  attrs: Record<string, string>;
  children: FakeNode[];
  listeners: Record<string, () => void>;
  value?: string;
  textContent?: string;
  className?: string;
  disabled?: boolean;
  hidden?: boolean;
  id?: string;
  firstElementChild?: FakeNode;
  setAttribute(name: string, value: string): void;
  addEventListener(name: string, fn: () => void): void;
  append(...kids: FakeNode[]): void;
}

interface Probe {
  state: { pets: Record<string, Array<Record<string, unknown>>>; petIndex: number; entry: string };
  initDrafts(config: unknown): void;
  petsBody(): { pets: Array<Record<string, unknown>> };
  petCard(): FakeNode;
  addPet(): void;
}

function probe(): Probe {
  const byId = new Map<string, FakeNode>();
  const node = (): FakeNode => {
    const el: FakeNode = {
      nodeType: 1,
      attrs: {},
      children: [],
      listeners: {},
      value: '',
      textContent: '',
      className: '',
      disabled: false,
      hidden: false,
      setAttribute(name, value) {
        el.attrs[name] = String(value);
        if (name === 'id') {
          el.id = String(value);
          byId.set(String(value), el);
        }
      },
      addEventListener(name, fn) {
        el.listeners[name] = fn;
      },
      append(...kids) {
        el.children.push(...kids);
        el.firstElementChild = el.children[0];
      },
    };
    Object.defineProperty(el, 'id', {
      configurable: true,
      enumerable: true,
      get() {
        return el.attrs.id;
      },
      set(value: string) {
        el.attrs.id = String(value);
        byId.set(String(value), el);
      },
    });
    return el;
  };
  const document = {
    createElement: node,
    createElementNS: () => node(),
    createTextNode: (text: string) => ({ nodeType: 3, textContent: text, attrs: {}, children: [] }),
    getElementById: (id: string) => byId.get(id) ?? null,
    querySelectorAll: () => [],
    addEventListener() {},
    body: node(),
  };
  const script = [
    coreScript('/dsh-pet-7340', {
      voices: [],
      fonts: [],
      displays: ['web', 'desktop', 'both', 'none'],
      corners: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
      physics: {},
      font: {},
      weights: { idle: 10, turn: 5, move: 5 },
    }),
    widgetsScript(),
    overlayScript(),
    `
function avatarRow() { return make('div', { class: 'avatarRow' }); }
function markDirty() {}
`,
    petCardScript(),
    petsScript(),
    'globalThis.__probe = { state, initDrafts, petsBody, petCard, addPet };',
  ].join('\n');
  const context: Record<string, unknown> = {
    document,
    location: { hash: '' },
    history: { replaceState() {} },
    URLSearchParams,
    window: { innerHeight: 800, addEventListener() {}, removeEventListener() {} },
    fetch: async () => ({ ok: false, json: async () => null }),
  };
  runInNewContext(script, context);
  return context.__probe as Probe;
}

function texts(node: FakeNode | undefined, out: string[] = []): string[] {
  if (!node) return out;
  if (typeof node.textContent === 'string' && node.textContent) out.push(node.textContent);
  for (const kid of node.children ?? []) texts(kid, out);
  return out;
}

function findId(node: FakeNode | undefined, id: string): FakeNode | null {
  if (!node || node.nodeType !== 1) return null;
  if (node.attrs?.id === id) return node;
  for (const kid of node.children ?? []) {
    const hit = findId(kid, id);
    if (hit) return hit;
  }
  return null;
}

const samplePet = {
  id: 'main',
  name: '主宠',
  size: 462,
  balanceEnabled: true,
  whisperEnabled: true,
  workStatusEnabled: true,
  display: 'none',
  position: { corner: 'bottom-right', marginX: 40, marginY: 40 },
};

describe('独立模式 宠物表现类型', () => {
  test('读取：spine 原样，缺项与非法回落 video', () => {
    const api = probe();
    api.initDrafts({
      main: {
        pets: [
          { ...samplePet, id: 'a', presentation: 'spine' },
          { ...samplePet, id: 'b' },
          { ...samplePet, id: 'c', presentation: 'nope' },
        ],
      },
    });
    const list = api.state.pets.main;
    assert.equal(list[0].presentation, 'spine');
    assert.equal(list[1].presentation, 'video');
    assert.equal(list[2].presentation, 'video');
  });

  test('保存体带上当前草稿的 presentation', () => {
    const api = probe();
    api.initDrafts({ main: { pets: [{ ...samplePet, presentation: 'spine' }] } });
    assert.equal(api.petsBody().pets[0].presentation, 'spine');
    api.state.pets.main[0].presentation = 'video';
    assert.equal(api.petsBody().pets[0].presentation, 'video');
  });

  test('宠物卡有「表现」下拉，选项为视频 / 骨骼', () => {
    const api = probe();
    api.initDrafts({ main: { pets: [{ ...samplePet, presentation: 'video' }] } });
    const card = api.petCard();
    assert.ok(findId(card, 'pet-presentation'), '应有 id=pet-presentation 的控件');
    const labels = texts(card);
    assert.ok(labels.includes('表现'), '应显示「表现」标签');
    assert.ok(labels.includes('视频'), '当前值应显示「视频」');
    assert.ok(
      labels.some((text) => text.includes('骨骼')),
      '说明应提到骨骼（下拉候选项在打开菜单后才进 DOM）',
    );
  });

  test('新增宠物默认 presentation 为 video', () => {
    const api = probe();
    api.initDrafts({ main: { pets: [samplePet] } });
    api.addPet();
    const added = api.state.pets.main[1];
    assert.equal(added.presentation, 'video');
  });
});

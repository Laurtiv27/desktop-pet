import type { PetIntent } from './types.ts';

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text.charAt(i);
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseSequence(raw: unknown): PetIntent['sequence'] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: PetIntent['sequence'] = [];
  for (const item of raw) {
    if (!isRecord(item)) return null;
    const clip = item.clip;
    if (typeof clip !== 'string' || !clip.trim()) return null;
    const step: PetIntent['sequence'][number] = { clip: clip.trim() };
    if (item.loop !== undefined) {
      if (typeof item.loop !== 'boolean') return null;
      step.loop = item.loop;
    }
    if (item.until !== undefined) {
      const until = item.until;
      if (until !== 'arrive' && until !== 'clip-end' && until !== 'duration') return null;
      step.until = until;
    }
    if (item.durationMs !== undefined) {
      if (typeof item.durationMs !== 'number' || !Number.isFinite(item.durationMs)) return null;
      step.durationMs = item.durationMs;
    }
    out.push(step);
  }
  return out;
}

function parseGoal(raw: unknown): PetIntent['goal'] | null | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) return null;
  const { xRatio, yRatio } = raw;
  if (typeof xRatio !== 'number' || typeof yRatio !== 'number') return null;
  if (!Number.isFinite(xRatio) || !Number.isFinite(yRatio)) return null;
  return { xRatio, yRatio };
}

/**
 * 从模型回复或调试输入中抽出第一个 JSON 对象并校验为 PetIntent 形状。
 * 未知顶层字段忽略；结构不合或 JSON 非法时返回 null（由调用方 warn，不抛错）。
 */
export function parseIntentJson(text: string): PetIntent | null {
  if (typeof text !== 'string' || !text.trim()) return null;
  const trimmed = text.trim();
  const candidate =
    trimmed.startsWith('{') && trimmed.endsWith('}') ? trimmed : extractFirstJsonObject(text);
  if (!candidate) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const sequence = parseSequence(parsed.sequence);
  if (!sequence) return null;

  const intent: PetIntent = {
    sequence,
    source: 'ai',
  };

  if (parsed.goal !== undefined) {
    const goal = parseGoal(parsed.goal);
    if (goal === null) return null;
    intent.goal = goal;
  }

  if (parsed.facing !== undefined) {
    const facing = parsed.facing;
    if (facing !== 'left' && facing !== 'right' && facing !== 'keep') return null;
    intent.facing = facing;
  }

  if (parsed.priority !== undefined) {
    if (typeof parsed.priority !== 'number' || !Number.isFinite(parsed.priority)) return null;
    intent.priority = parsed.priority;
  }

  return intent;
}
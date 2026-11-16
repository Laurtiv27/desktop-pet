import type { PetIntent } from './types.ts';

export type ValidateIntentResult =
  | { ok: true; intent: PetIntent }
  | { ok: false; reason: string };

function isUnitRatio(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

export function validateIntent(
  intent: PetIntent,
  allowedClips: Set<string>,
): ValidateIntentResult {
  if (intent.sequence.length === 0) {
    return { ok: false, reason: '动作序列为空' };
  }

  if (intent.goal !== undefined) {
    const { xRatio, yRatio } = intent.goal;
    if (!isUnitRatio(xRatio) || !isUnitRatio(yRatio)) {
      return { ok: false, reason: '目标坐标越界' };
    }
  }

  for (const step of intent.sequence) {
    if (!allowedClips.has(step.clip)) {
      return { ok: false, reason: `未知动作: ${step.clip}` };
    }
    if (step.until === 'duration') {
      const ms = step.durationMs;
      if (ms === undefined || !Number.isFinite(ms) || ms <= 0) {
        return { ok: false, reason: '时长无效' };
      }
    }
  }

  return { ok: true, intent };
}
import type { ScreenContextState } from './types.ts';

export function isSummaryInjectable(
  state: ScreenContextState,
  intervalSec: number,
  nowMs: number,
): boolean {
  if (state.status !== 'ok') return false;
  const text = state.text.trim();
  if (!text) return false;
  const maxAgeMs = 2 * intervalSec * 1000;
  return nowMs - state.updatedAt <= maxAgeMs;
}

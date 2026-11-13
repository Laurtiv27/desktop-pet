import { isSummaryInjectable } from './expiry.ts';
import type { ScreenContextState } from './types.ts';

export const SCREEN_CONTEXT_INJECT_PREFIX =
  '（屏幕上下文，仅供语气与话题参考，勿复述或朗读隐私细节：';

export function formatScreenContextInjectLine(text: string): string {
  return `${SCREEN_CONTEXT_INJECT_PREFIX}${text}）`;
}

export function appendScreenContext(
  baseText: string,
  state: ScreenContextState,
  intervalSec: number,
  nowMs: number,
): string {
  if (!isSummaryInjectable(state, intervalSec, nowMs)) return baseText;
  return `${baseText}\n${formatScreenContextInjectLine(state.text.trim())}`;
}

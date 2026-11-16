import type { ClipSlot } from './types.ts';

export type SpineMeta = {
  clips: Partial<Record<ClipSlot, string>>;
  walkSpeedPx: number;
  defaultSkin: string;
};

export const DEFAULT_WALK_SPEED_PX = 120;

const CLIP_SLOTS: readonly ClipSlot[] = [
  'idle',
  'walk',
  'turn',
  'sit',
  'wave',
  'happy',
  'drag',
];

function isClipSlot(key: string): key is ClipSlot {
  return (CLIP_SLOTS as readonly string[]).includes(key);
}

export function parseSpineMeta(raw: unknown): SpineMeta | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;

  if (
    typeof record.clips !== 'object' ||
    record.clips === null ||
    Array.isArray(record.clips)
  ) {
    return null;
  }

  const clipsIn = record.clips as Record<string, unknown>;
  const clips: Partial<Record<ClipSlot, string>> = {};
  let hasStringClip = false;

  for (const [key, value] of Object.entries(clipsIn)) {
    if (typeof value !== 'string') {
      continue;
    }
    hasStringClip = true;
    if (isClipSlot(key)) {
      clips[key] = value;
    }
  }

  if (!hasStringClip) {
    return null;
  }

  let defaultSkin = 'default';
  if (typeof record.defaultSkin === 'string' && record.defaultSkin.length > 0) {
    defaultSkin = record.defaultSkin;
  }

  let walkSpeedPx = DEFAULT_WALK_SPEED_PX;
  if (
    typeof record.walkSpeedPx === 'number' &&
    Number.isFinite(record.walkSpeedPx) &&
    record.walkSpeedPx > 0
  ) {
    walkSpeedPx = record.walkSpeedPx;
  }

  return { clips, walkSpeedPx, defaultSkin };
}
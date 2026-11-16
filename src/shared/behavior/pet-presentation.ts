import type { Animations, Pet } from '../types.ts';
import type { ClipSlot, PresentationKind } from './types.ts';

/** 配置里的 presentation 字面量归一化为渲染分支：仅 `'spine'` 为骨骼，其余一律 `'video'`。 */
export function normalizePresentation(raw: unknown): PresentationKind {
  return raw === 'spine' ? 'spine' : 'video';
}

/** 读取宠物实例的 presentation 字段（缺省按 video）。 */
export function resolvePetPresentation(pet: Pick<Pet, 'presentation'>): PresentationKind {
  return normalizePresentation(pet.presentation);
}

/** 桌面播放走哪条后端：与 {@link normalizePresentation} 同一套归一化。 */
export function choosePlaybackBackend(presentation: unknown): PresentationKind {
  return normalizePresentation(presentation);
}

/** 骨骼宠缺 animations 时的最小桩：只填 idle，其余空池，避免菜单/随机链读字段炸掉。 */
export function createSpineAnimationStub(clips?: unknown): Animations {
  let idle = 'idle';
  if (clips && typeof clips === 'object' && !Array.isArray(clips)) {
    const idleVal = (clips as Record<string, unknown>).idle;
    if (typeof idleVal === 'string' && idleVal.length > 0) idle = idleVal;
  }
  return {
    idle: [idle],
    turn: [],
    drag: [],
    clicks: [],
    moves: { default: {}, actions: [] },
    categories: [],
    events: {},
  };
}

/** 槽位名（idle/walk/…）映射到 meta.clips 里的真实 clip；未知名原样返回。 */
export function mapPresentationClip(clip: string, clips?: Partial<Record<ClipSlot, string>> | null): string {
  if (!clips) return clip;
  const mapped = clips[clip as ClipSlot];
  return typeof mapped === 'string' && mapped.length > 0 ? mapped : clip;
}

export type PetPlaybackSetup = {
  kind: PresentationKind;
  animations: Animations;
  usedStub: boolean;
};

/** 解析桌面播放配置：spine 缺 animations 用最小桩；video 缺 animations 仍抛。 */
export function resolvePetPlaybackSetup(
  pet: Pick<Pet, 'id' | 'presentation' | 'animations' | 'spine'>,
): PetPlaybackSetup {
  const kind = choosePlaybackBackend(pet.presentation);
  if (pet.animations) {
    return { kind, animations: pet.animations, usedStub: false };
  }
  if (kind === 'spine') {
    return {
      kind,
      animations: createSpineAnimationStub(pet.spine?.meta?.clips),
      usedStub: true,
    };
  }
  throw new Error('宠物缺少 animations 段：' + String(pet.id ?? ''));
}

import type { Animations, Pet } from '../types.ts';
import type { ClipSlot, PresentationKind } from './types.ts';

export function normalizePresentation(raw: unknown): PresentationKind {
  if (raw === 'spine') return 'spine';
  if (raw === 'model3d') return 'model3d';
  return 'video';
}

export function createModel3dAnimationStub(clips?: unknown): Animations {
  let idle = 'idle';
  if (clips && typeof clips === 'object' && !Array.isArray(clips)) {
    const v = (clips as Record<string, unknown>).idle;
    if (typeof v === 'string' && v) idle = v;
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

export function mapPresentationClip(
  clip: string,
  clips?: Partial<Record<ClipSlot, string>> | Record<string, string> | null,
): string {
  if (!clips) return clip;
  const mapped = (clips as Record<string, string>)[clip];
  return typeof mapped === 'string' && mapped.length > 0 ? mapped : clip;
}

export type PetPlaybackSetup = {
  kind: PresentationKind;
  animations: Animations;
  usedStub: boolean;
};

export function resolvePetPlaybackSetup(
  pet: Pick<Pet, 'id' | 'presentation' | 'animations' | 'model3d'>,
): PetPlaybackSetup {
  const kind = normalizePresentation(pet.presentation);
  if (pet.animations) return { kind, animations: pet.animations, usedStub: false };
  if (kind === 'model3d') {
    return {
      kind,
      animations: createModel3dAnimationStub(pet.model3d?.meta?.clips),
      usedStub: true,
    };
  }
  throw new Error('宠物缺少 animations 段：' + String(pet.id ?? ''));
}
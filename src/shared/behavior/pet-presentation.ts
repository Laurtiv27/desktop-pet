import type { Pet } from '../types.ts';
import type { PresentationKind } from './types.ts';

/** 配置里的 presentation 字面量归一化为渲染分支：仅 `'spine'` 为骨骼，其余一律 `'video'`。 */
export function normalizePresentation(raw: unknown): PresentationKind {
  return raw === 'spine' ? 'spine' : 'video';
}

/** 读取宠物实例的 presentation 字段（缺省按 video）。 */
export function resolvePetPresentation(pet: Pick<Pet, 'presentation'>): PresentationKind {
  return normalizePresentation(pet.presentation);
}
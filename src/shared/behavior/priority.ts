import { INTENT_PRIORITY, type PetIntent } from './types.ts';

export function resolveIntentPriority(intent: PetIntent): number {
  return intent.priority ?? INTENT_PRIORITY[intent.source];
}

export function canInterrupt(
  currentPriority: number,
  next: PetIntent,
): boolean {
  return resolveIntentPriority(next) > currentPriority;
}
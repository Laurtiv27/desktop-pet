export type PresentationKind = 'video' | 'spine' | 'model3d';
export type ClipSlot = 'idle' | 'walk' | 'turn' | 'sit' | 'wave' | 'happy' | 'drag';
export type IntentSource = 'roam' | 'menu' | 'ai' | 'posture' | 'user';

export type PetIntent = {
  goal?: { xRatio: number; yRatio: number };
  facing?: 'left' | 'right' | 'keep';
  sequence: Array<{
    clip: ClipSlot | string;
    loop?: boolean;
    until?: 'arrive' | 'clip-end' | 'duration';
    durationMs?: number;
  }>;
  priority?: number;
  source: IntentSource;
};

export type PetPlanStep = {
  clip: string;
  loop: boolean;
  until: 'arrive' | 'clip-end' | 'duration';
  durationMs?: number;
  goal?: { xRatio: number; yRatio: number };
};

export type PetPlan = {
  steps: PetPlanStep[];
  facing: 'left' | 'right' | 'keep';
  priority: number;
  source: IntentSource;
};

export const INTENT_PRIORITY: Record<IntentSource, number> = {
  user: 100,
  menu: 100,
  posture: 50,
  ai: 30,
  roam: 10,
};
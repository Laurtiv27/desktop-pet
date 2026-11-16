import type { ClipSlot, PetIntent, PetPlan, PetPlanStep } from './types.ts';
import { INTENT_PRIORITY } from './types.ts';
import { validateIntent } from './validate-intent.ts';

const CLIP_SLOTS: readonly ClipSlot[] = [
  'idle',
  'walk',
  'turn',
  'sit',
  'wave',
  'happy',
  'drag',
];

const DEFAULT_ARRIVE_THRESHOLD = 0.01;

export type PlanBehaviorInput = {
  intent: PetIntent;
  allowedClips: Set<string>;
  clips: Partial<Record<ClipSlot, string>>;
  walkClip: string;
  hasWalkClip: boolean;
  current: { xRatio: number; yRatio: number };
  arriveThreshold?: number;
};

export type PlanBehaviorResult =
  | { ok: true; plan: PetPlan }
  | { ok: false; reason: string };

function isClipSlotKey(clip: string): clip is ClipSlot {
  return (CLIP_SLOTS as readonly string[]).includes(clip);
}

function resolveClipName(
  clip: string,
  clips: Partial<Record<ClipSlot, string>>,
): string {
  if (isClipSlotKey(clip)) {
    const mapped = clips[clip];
    if (mapped !== undefined) {
      return mapped;
    }
  }
  return clip;
}

function distanceRatio(
  a: { xRatio: number; yRatio: number },
  b: { xRatio: number; yRatio: number },
): number {
  const dx = a.xRatio - b.xRatio;
  const dy = a.yRatio - b.yRatio;
  return Math.hypot(dx, dy);
}

function sequenceHasArriveWalk(
  intent: PetIntent,
  walkClip: string,
  clips: Partial<Record<ClipSlot, string>>,
): boolean {
  return intent.sequence.some(
    (step) =>
      step.until === 'arrive' &&
      resolveClipName(step.clip, clips) === walkClip,
  );
}

function mapSequenceStep(
  step: PetIntent['sequence'][number],
  clips: Partial<Record<ClipSlot, string>>,
  goal: PetIntent['goal'],
): PetPlanStep {
  const until = step.until ?? 'clip-end';
  const mapped: PetPlanStep = {
    clip: resolveClipName(step.clip, clips),
    loop: step.loop ?? false,
    until,
  };
  if (step.durationMs !== undefined) {
    mapped.durationMs = step.durationMs;
  }
  if (until === 'arrive' && goal !== undefined) {
    mapped.goal = goal;
  }
  return mapped;
}

export function planBehavior(input: PlanBehaviorInput): PlanBehaviorResult {
  const validated = validateIntent(input.intent, input.allowedClips);
  if (!validated.ok) {
    return validated;
  }
  const intent = validated.intent;

  const threshold = input.arriveThreshold ?? DEFAULT_ARRIVE_THRESHOLD;
  const steps: PetPlanStep[] = [];

  const goal = intent.goal;
  if (goal !== undefined) {
    const needsWalk =
      distanceRatio(input.current, goal) > threshold &&
      !sequenceHasArriveWalk(intent, input.walkClip, input.clips);

    if (needsWalk) {
      if (!input.hasWalkClip) {
        return { ok: false, reason: '缺少走路动作' };
      }
      steps.push({
        clip: input.walkClip,
        loop: true,
        until: 'arrive',
        goal,
      });
    }
  }

  for (const step of intent.sequence) {
    steps.push(mapSequenceStep(step, input.clips, goal));
  }

  const plan: PetPlan = {
    steps,
    facing: intent.facing ?? 'keep',
    priority: intent.priority ?? INTENT_PRIORITY[intent.source],
    source: intent.source,
  };

  return { ok: true, plan };
}
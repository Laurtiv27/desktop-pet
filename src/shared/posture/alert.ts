import type { PostureConfig } from './types.ts';

export type AlertPlan = { perform: boolean; toast: boolean; beep: boolean };

export class AlertGate {
  private readonly cooldownSec: number;
  private readonly now: () => number;
  private readonly lastAt = new Map<string, number>();

  constructor(cooldownSec: number, now?: () => number) {
    this.cooldownSec = cooldownSec;
    this.now = now ?? (() => Math.floor(Date.now() / 1000));
  }

  allow(eventType: string): boolean {
    const t = this.now();
    const last = this.lastAt.get(eventType);
    if (last !== undefined && t - last < this.cooldownSec) {
      return false;
    }
    this.lastAt.set(eventType, t);
    return true;
  }
}

export function planAlert(cfg: PostureConfig, eventType: string, gate: AlertGate): AlertPlan {
  if (!gate.allow(eventType)) {
    return { perform: false, toast: false, beep: false };
  }
  return {
    perform: cfg.petPerform,
    toast: cfg.toast,
    beep: cfg.beep,
  };
}

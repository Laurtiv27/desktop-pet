/** 人脸在离：离开持续 leaveSec 秒触发睡，回来触发醒；各动作至多一次，直到状态翻转。 */

export function createPresenceTracker(opts: {
  leaveSec?: number;
  now?: () => number;
  onSleep: () => void;
  onWake: () => void;
}): { onFace(present: boolean): void; reset(): void } {
  const leaveSec = opts.leaveSec ?? 10;
  const now = opts.now ?? (() => Date.now() / 1000);

  let lastPresentAt = now();
  let asleep = false;

  function reset(): void {
    lastPresentAt = now();
    asleep = false;
  }

  function onFace(present: boolean): void {
    const t = now();
    if (present) {
      lastPresentAt = t;
      if (asleep) {
        asleep = false;
        opts.onWake();
      }
      return;
    }
    if (!asleep && t - lastPresentAt >= leaveSec) {
      asleep = true;
      opts.onSleep();
    }
  }

  return { onFace, reset };
}

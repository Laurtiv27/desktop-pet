export function shouldStartTick({ enabled, busy }: { enabled: boolean; busy: boolean }): boolean {
  return enabled && !busy;
}

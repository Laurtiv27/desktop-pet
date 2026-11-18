export type RatioPos = { xRatio: number; yRatio: number };

export const DEFAULT_ARRIVE_THRESHOLD = 0.01;

export function ratioDistance(a: RatioPos, b: RatioPos): number {
  return Math.hypot(a.xRatio - b.xRatio, a.yRatio - b.yRatio);
}

export function hasArrived(current: RatioPos, goal: RatioPos, threshold = DEFAULT_ARRIVE_THRESHOLD): boolean {
  return ratioDistance(current, goal) <= threshold;
}

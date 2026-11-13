import type { Landmark, PoseMetrics } from './types.ts';

function dist(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function vis(lm: Landmark): number {
  return lm.visibility ?? 0;
}

export function computePostureMetrics(lms: Landmark[]): PoseMetrics | null {
  const lSh = lms[11];
  const rSh = lms[12];
  const lEar = lms[7];
  const rEar = lms[8];
  if (vis(lSh) < 0.5 || vis(rSh) < 0.5) {
    return null;
  }

  const shoulderW = Math.max(dist(lSh, rSh), 1e-6);
  const shoulderMidX = (lSh.x + rSh.x) / 2;
  const earMidX = (lEar.x + rEar.x) / 2;
  const earMidY = (lEar.y + rEar.y) / 2;

  const fwd_ratio = Math.abs(earMidX - shoulderMidX) / shoulderW;
  const le = lms[2];
  const re = lms[5];
  const tilt_deg =
    (Math.atan2(Math.abs(re.y - le.y), Math.max(Math.abs(re.x - le.x), 1e-6)) * 180) / Math.PI;
  const head_h = earMidY / shoulderW;

  return { fwd_ratio, tilt_deg, head_h };
}

import { THRESHOLD_DEFAULTS } from './defaults.ts';
import type { EffectiveThresholds, FaceMetrics, Landmark } from './types.ts';

function dist(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function computeEar(lms: Landmark[]): number {
  const left = dist(lms[159], lms[145]) / Math.max(dist(lms[33], lms[133]), 1e-6);
  const right = dist(lms[386], lms[374]) / Math.max(dist(lms[263], lms[362]), 1e-6);
  return (left + right) / 2;
}

function computeMar(lms: Landmark[]): number {
  return dist(lms[13], lms[14]) / Math.max(dist(lms[61], lms[291]), 1e-6);
}

function computeRollDeg(lms: Landmark[]): number {
  const l = lms[33];
  const r = lms[263];
  return (Math.atan2(Math.abs(r.y - l.y), Math.max(Math.abs(r.x - l.x), 1e-6)) * 180) / Math.PI;
}

function computePitchDeg(lms: Landmark[]): number {
  const f = lms[10];
  const c = lms[152];
  return (Math.atan2(Math.abs(f.x - c.x), Math.max(Math.abs(f.y - c.y), 1e-6)) * 180) / Math.PI;
}

function computeFaceWidth(lms: Landmark[]): number {
  return dist(lms[127], lms[356]);
}

export function computeFaceMetrics(
  lms: Landmark[],
  thr: Pick<EffectiveThresholds, 'EAR_CLOSED' | 'YAWN_MAR' | 'PITCH_NOD_DEG'> = THRESHOLD_DEFAULTS,
): FaceMetrics {
  const ear = computeEar(lms);
  const mar = computeMar(lms);
  const roll_deg = computeRollDeg(lms);
  const pitch_deg = computePitchDeg(lms);
  const face_width = computeFaceWidth(lms);
  return {
    ear,
    mar,
    roll_deg,
    pitch_deg,
    face_width,
    eyes_closed: ear < thr.EAR_CLOSED,
    yawn_open: mar > thr.YAWN_MAR,
    nodding: pitch_deg > thr.PITCH_NOD_DEG,
  };
}

/**
 * 本帧闭眼采样是否可信。
 * 低头过大或脸过小（关键点挤在一起）时 EAR 会假塌，不能记进 fatigue / perclos。
 */
export function isEyeSampleReliable(
  face: FaceMetrics,
  thr: Pick<EffectiveThresholds, 'MIN_FACE_WIDTH_FOR_EYE'> = THRESHOLD_DEFAULTS,
): boolean {
  if (face.nodding) return false;
  if (!(face.face_width > thr.MIN_FACE_WIDTH_FOR_EYE)) return false;
  return true;
}

type BlendshapeCat = { categoryName?: string; displayName?: string; score?: number };

function blendscoreOf(categories: readonly BlendshapeCat[], name: string): number {
  for (const cat of categories) {
    const label = cat.categoryName || cat.displayName || '';
    if (label === name && typeof cat.score === 'number') return cat.score;
  }
  return 0;
}

/** 左右眼 blink blendshape 均值；闭眼时通常很高。 */
export function blinkFromBlendshapes(categories: readonly BlendshapeCat[] | undefined): number | undefined {
  if (!categories || categories.length === 0) return undefined;
  return (blendscoreOf(categories, 'eyeBlinkLeft') + blendscoreOf(categories, 'eyeBlinkRight')) / 2;
}

/**
 * 左右眼下视 blendshape 均值。
 * 闭眼/高 blink 时 MediaPipe 常把 eyeLookDown 抬很高，这里直接压成 0，避免误报「看下方」。
 */
export function gazeDownFromBlendshapes(categories: readonly BlendshapeCat[] | undefined): number | undefined {
  if (!categories || categories.length === 0) return undefined;
  const blink = blinkFromBlendshapes(categories) ?? 0;
  // 眨眼/闭眼过程中 lookDown 不可信。
  if (blink >= 0.45) return 0;
  return (blendscoreOf(categories, 'eyeLookDownLeft') + blendscoreOf(categories, 'eyeLookDownRight')) / 2;
}

/**
 * 虹膜表观尺度：左右虹膜水平跨度均值（需 ≥478 点的虹膜细化模型）。
 * 仅作内部代理，不是瞳孔直径。
 */
export function estimateIrisScale(lms: Landmark[] | undefined): number | undefined {
  if (!lms || lms.length < 478) return undefined;
  // MediaPipe 虹膜：左 468–472，右 473–477；取对侧点近似直径。
  const left = dist(lms[469]!, lms[471]!);
  const right = dist(lms[474]!, lms[476]!);
  const scale = (left + right) / 2;
  return Number.isFinite(scale) && scale > 0 ? scale : undefined;
}

/**
 * 把朝向 / 虹膜尺度挂到已有人脸指标上。
 * 高 blink 时补强 eyes_closed（EAR 对软闭眼常不够敏感）。
 */
export function withGazeAndIris(
  face: FaceMetrics,
  input: { blendshapes?: readonly BlendshapeCat[]; landmarks?: Landmark[] },
): FaceMetrics {
  const gaze_down = gazeDownFromBlendshapes(input.blendshapes);
  const blink = blinkFromBlendshapes(input.blendshapes);
  const iris_scale = estimateIrisScale(input.landmarks);
  const eyes_closed = face.eyes_closed || (blink !== undefined && blink >= 0.5);
  return {
    ...face,
    eyes_closed,
    ...(gaze_down !== undefined ? { gaze_down } : {}),
    ...(iris_scale !== undefined ? { iris_scale } : {}),
  };
}

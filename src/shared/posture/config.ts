import {
  DEFAULT_POSTURE_CONFIG,
  normalizePostureCooldown,
  SENSITIVITY_FACTOR,
  SENSITIVITY_HOLD,
  THRESHOLD_DEFAULTS,
} from './defaults.ts';
import type { EffectiveThresholds, PostureConfig, Sensitivity } from './types.ts';

export {
  DEFAULT_POSTURE_CONFIG,
  normalizePostureCooldown,
  POSTURE_COOLDOWN_CHOICES,
  SENSITIVITY_FACTOR,
  SENSITIVITY_HOLD,
  THRESHOLD_DEFAULTS,
} from './defaults.ts';
export type { EffectiveThresholds, PostureConfig, Sensitivity } from './types.ts';

const POSTURE_CONFIG_KEYS: Array<keyof PostureConfig> = [
  'enabled',
  'paused',
  'sensitivity',
  'cooldown',
  'beep',
  'toast',
  'petPerform',
];

const SENSITIVITY_SET = new Set<Sensitivity>(['strict', 'standard', 'loose']);

export function postureConfigPath(dshHome: string): string {
  return `${dshHome}/dsh-pet/posture-config.json`;
}

export function applySensitivity(cfg: PostureConfig): EffectiveThresholds {
  const sensitivity = SENSITIVITY_SET.has(cfg.sensitivity) ? cfg.sensitivity : 'standard';
  const factor = SENSITIVITY_FACTOR[sensitivity];
  const hold = SENSITIVITY_HOLD[sensitivity];
  return {
    CALIB_SECONDS: THRESHOLD_DEFAULTS.CALIB_SECONDS,
    CALIB_MIN_FRAMES: THRESHOLD_DEFAULTS.CALIB_MIN_FRAMES,
    EAR_CLOSED: THRESHOLD_DEFAULTS.EAR_CLOSED,
    EYE_CLOSED_SEC: THRESHOLD_DEFAULTS.EYE_CLOSED_SEC,
    YAWN_MAR: THRESHOLD_DEFAULTS.YAWN_MAR,
    YAWN_SEC: THRESHOLD_DEFAULTS.YAWN_SEC,
    PERCLOS_WINDOW_SEC: THRESHOLD_DEFAULTS.PERCLOS_WINDOW_SEC,
    PERCLOS_RATIO: THRESHOLD_DEFAULTS.PERCLOS_RATIO,
    PITCH_NOD_DEG: THRESHOLD_DEFAULTS.PITCH_NOD_DEG,
    NOD_SEC: THRESHOLD_DEFAULTS.NOD_SEC,
    MIN_FACE_WIDTH_FOR_EYE: THRESHOLD_DEFAULTS.MIN_FACE_WIDTH_FOR_EYE,
    POSE_EMA: THRESHOLD_DEFAULTS.POSE_EMA,
    FWD_HEAD_OFF: THRESHOLD_DEFAULTS.FWD_HEAD_OFF * factor,
    TILT_DEG: THRESHOLD_DEFAULTS.TILT_DEG * factor,
    HEAD_DROP: THRESHOLD_DEFAULTS.HEAD_DROP * factor,
    NEAR_FACE_RATIO: THRESHOLD_DEFAULTS.NEAR_FACE_RATIO * factor,
    POSTURE_HOLD_SEC: hold,
    GAZE_DOWN_SCORE: THRESHOLD_DEFAULTS.GAZE_DOWN_SCORE,
    GAZE_DOWN_SEC: THRESHOLD_DEFAULTS.GAZE_DOWN_SEC,
  };
}

function mergePostureConfig(parsed: unknown): PostureConfig {
  const out: PostureConfig = { ...DEFAULT_POSTURE_CONFIG };
  if (!parsed || typeof parsed !== 'object') return out;
  const obj = parsed as Record<string, unknown>;
  for (const key of POSTURE_CONFIG_KEYS) {
    if (!(key in obj)) continue;
    const value = obj[key];
    if (key === 'sensitivity') {
      if (typeof value === 'string' && SENSITIVITY_SET.has(value as Sensitivity)) {
        out.sensitivity = value as Sensitivity;
      }
      continue;
    }
    if (key === 'cooldown') {
      if (typeof value === 'number' && Number.isFinite(value)) {
        out.cooldown = normalizePostureCooldown(value);
      }
      continue;
    }
    if (typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return out;
}

export function loadPostureConfig(readFile: () => string, _configPath: string): PostureConfig {
  try {
    const raw = readFile();
    return mergePostureConfig(JSON.parse(raw));
  } catch (e) {
    const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : '';
    if (code === 'ENOENT') return { ...DEFAULT_POSTURE_CONFIG };
    return { ...DEFAULT_POSTURE_CONFIG };
  }
}

export function savePostureConfig(
  writeFile: (path: string, content: string) => void,
  configPath: string,
  cfg: PostureConfig,
): void {
  writeFile(configPath, JSON.stringify(cfg, null, 2));
}

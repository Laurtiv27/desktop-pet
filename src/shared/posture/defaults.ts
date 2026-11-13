export const THRESHOLD_DEFAULTS = {
  CALIB_SECONDS: 4,
  CALIB_MIN_FRAMES: 30,
  EAR_CLOSED: 0.18,
  EYE_CLOSED_SEC: 1.6,
  YAWN_MAR: 0.4,
  YAWN_SEC: 2,
  PERCLOS_WINDOW_SEC: 30,
  /** 闭眼帧占比；原 0.18 太敏感，低头/侧脸假闭眼易误报。 */
  PERCLOS_RATIO: 0.35,
  PITCH_NOD_DEG: 30,
  /** 低头持续秒数；原 1s 瞥键盘也会报瞌睡。 */
  NOD_SEC: 2,
  /** 归一化脸宽低于此值视为关键点不可靠，不计入闭眼。 */
  MIN_FACE_WIDTH_FOR_EYE: 0.08,
  POSE_EMA: 0.35,
  FWD_HEAD_OFF: 0.1,
  TILT_DEG: 12,
  /** 头往画面下方沉（耳中点 Y↑）相对校准基线的增量；与旧版符号相反（旧版易反）。 */
  HEAD_DROP: 0.35,
  NEAR_FACE_RATIO: 1.15,
  POSTURE_HOLD_SEC: 8,
  /** 下视 blendshape（左右眼 eyeLookDown 均值）超过此值视为在往下看。 */
  GAZE_DOWN_SCORE: 0.4,
  /** 持续下视多少秒才提醒。 */
  GAZE_DOWN_SEC: 2.5,
} as const;

export const SENSITIVITY_FACTOR = { strict: 0.8, standard: 1.0, loose: 1.3 } as const;
export const SENSITIVITY_HOLD = { strict: 5, standard: 8, loose: 12 } as const;

/** 冷却可选秒数；读盘遇到旧档位时就近归一到这里。 */
export const POSTURE_COOLDOWN_CHOICES = [5, 10, 30] as const;

export const DEFAULT_POSTURE_CONFIG = {
  enabled: false,
  paused: false,
  sensitivity: 'standard' as const,
  cooldown: 10,
  beep: true,
  /** 保留字段以兼容旧配置；提醒链路不再发系统通知。 */
  toast: false,
  petPerform: true,
};

/** 把冷却收成 5 / 10 / 30；旧的 60/120/300 等落到最近一档。 */
export function normalizePostureCooldown(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_POSTURE_CONFIG.cooldown;
  const choices = POSTURE_COOLDOWN_CHOICES as readonly number[];
  if (choices.includes(value)) return value;
  let best = choices[0]!;
  let bestDist = Math.abs(value - best);
  for (const choice of choices) {
    const dist = Math.abs(value - choice);
    if (dist < bestDist) {
      best = choice;
      bestDist = dist;
    }
  }
  return best;
}

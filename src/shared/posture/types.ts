import type { THRESHOLD_DEFAULTS } from './defaults.ts';

export type Sensitivity = 'strict' | 'standard' | 'loose';

export type PostureConfig = {
  enabled: boolean;
  paused: boolean;
  sensitivity: Sensitivity;
  cooldown: number;
  beep: boolean;
  toast: boolean;
  petPerform: boolean;
};

export type EffectiveThresholds = {
  [K in keyof typeof THRESHOLD_DEFAULTS]: number;
};

export type Landmark = { x: number; y: number; z?: number; visibility?: number };

export type FaceMetrics = {
  ear: number;
  mar: number;
  roll_deg: number;
  pitch_deg: number;
  face_width: number;
  eyes_closed: boolean;
  yawn_open: boolean;
  nodding: boolean;
  /** 左右眼下视 blendshape 均值 0–1；缺省表示本帧无朝向数据。 */
  gaze_down?: number;
  /**
   * 虹膜表观尺度（归一化），仅作瞳孔缩放代理预留；不是医学级瞳孔直径。
   * 缺省表示本帧无虹膜点。
   */
  iris_scale?: number;
};

export type PoseMetrics = {
  fwd_ratio: number;
  tilt_deg: number;
  head_h: number;
};

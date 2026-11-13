/**
 * 坐姿检测页（file:// 经典脚本）可用的浏览器入口。
 *
 * 只再导出阈值默认值、人脸/姿态指标和引擎。配置的磁盘读写、演出、告警、在离追踪
 * 留在主进程，不能打进页面包：config 走 Node 文件 API，演出与在离也不在隐藏窗里跑。
 * scripts/build-desktop-core.mjs 把本文件打成 runtime/electron-helper/posture/core.js（window.PostureCore）。
 * @module dsh-pet/src/shared/posture/browser-entry
 */
export { DEFAULT_POSTURE_CONFIG, SENSITIVITY_FACTOR, SENSITIVITY_HOLD, THRESHOLD_DEFAULTS } from './defaults.ts';
export {
  computeFaceMetrics,
  withGazeAndIris,
  gazeDownFromBlendshapes,
  estimateIrisScale,
} from './face-metrics.ts';
export { computePostureMetrics } from './posture-metrics.ts';
export { Engine } from './engine.ts';
export type { PostureEvent, PostureEventType } from './engine.ts';
export type { EffectiveThresholds, FaceMetrics, Landmark, PoseMetrics } from './types.ts';

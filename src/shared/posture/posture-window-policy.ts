/**
 * 坐姿隐藏窗启停策略：只看 enabled 与当前是否已有窗，不碰 Electron。
 *
 * 暂停不关窗（窗还在，只发 pause/resume）。主进程 `posture-window.js` 的
 * `bootPostureAction` / `reduceEnabled` 与这里同算法。
 * @module dsh-pet/src/shared/posture/posture-window-policy
 */

export type PosturePhase = 'stopped' | 'running';

export type PostureLifecycleAction = 'start' | 'stop' | 'noop';

/**
 * 进程就绪后按已保存的 enabled 决定要不要拉窗。
 *
 * @param enabled - posture-config.json 里的开关。
 * @returns enabled 为真则 start，否则不动。
 */
export function bootPostureAction(enabled: boolean): Exclude<PostureLifecycleAction, 'stop'> {
  return enabled ? 'start' : 'noop';
}

/**
 * enabled 相对当前窗的变化。
 *
 * 已经在目标状态时不再 start/stop，避免重复建窗或空关。
 *
 * @param phase - 隐藏窗是否还在。
 * @param enabled - 用户希望的开关。
 * @returns 下一阶段以及要执行的动作。
 */
export function reduceEnabled(
  phase: PosturePhase,
  enabled: boolean,
): { phase: PosturePhase; action: PostureLifecycleAction } {
  if (enabled && phase === 'stopped') return { phase: 'running', action: 'start' };
  if (!enabled && phase === 'running') return { phase: 'stopped', action: 'stop' };
  return { phase, action: 'noop' };
}

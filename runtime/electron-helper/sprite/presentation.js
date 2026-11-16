/**
 * 表现层工厂。
 *
 * kind === 'model3d' 时交给 createModel3dPresentation；video（以及尚未实现的 spine）返回 null，
 * 视频仍走 sprite 上的 videoA/videoB。必须在 presentation-model3d.js 之后加载。
 * @module dsh-pet/runtime/electron-helper/sprite-presentation
 */
'use strict';

function createPresentation(kind, opts) {
  if (kind === 'model3d') return createModel3dPresentation(opts);
  return null;
}

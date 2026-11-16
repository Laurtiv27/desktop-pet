/**
 * 行为执行器：把 Intent 编成 Plan 并逐步播放 / 位移。
 *
 * 骨骼 stub 没有 video.ended，clip-end 与 duration 都由本模块的定时器收尾。
 * arrive 步播 walk，并用 startSpeedMoveDrive 按像素速度走到 goal。
 * 须在 sprite.js、presentation、motion 之后加载。
 * @module dsh-pet/runtime/electron-helper/sprite-behavior-runner
 */
'use strict';

const CLIP_SLOTS = ['idle', 'walk', 'turn', 'sit', 'wave', 'happy', 'drag'];
const ROAM_MIN_MS = 8000;
const ROAM_MAX_MS = 15000;
const ROAM_IDLE_MS = 2000;
const CLIP_END_FALLBACK_MS = 1500;
const ROAM_MARGIN = 0.12;

function clipsOf(sprite) {
  const meta = sprite.pet && sprite.pet.spine && sprite.pet.spine.meta;
  const clips = meta && meta.clips;
  return clips && typeof clips === 'object' ? clips : {};
}

function allowedClipsOf(sprite) {
  const set = new Set(CLIP_SLOTS);
  const clips = clipsOf(sprite);
  for (const key of Object.keys(clips)) {
    set.add(key);
    if (typeof clips[key] === 'string' && clips[key]) set.add(clips[key]);
  }
  const idle = sprite.animations && sprite.animations.idle;
  if (Array.isArray(idle)) {
    for (const name of idle) if (name) set.add(name);
  }
  return set;
}

function walkSpeedPxOf(sprite) {
  const meta = sprite.pet && sprite.pet.spine && sprite.pet.spine.meta;
  if (meta && Number.isFinite(meta.walkSpeedPx) && meta.walkSpeedPx > 0) return meta.walkSpeedPx;
  return S.DEFAULT_WALK_SPEED_PX || 120;
}

function currentRatioOf(sprite) {
  const w = VIEW.w || 1;
  const h = VIEW.h || 1;
  return {
    xRatio: (sprite.pos.x + sprite.halfW) / w,
    yRatio: (sprite.pos.y + sprite.halfH) / h,
  };
}

function clampRatioGoal(xRatio, yRatio) {
  let x = xRatio;
  let y = yRatio;
  if (typeof AREAS !== 'undefined' && AREAS && AREAS.length && S.clampPointToRegion) {
    const c = S.clampPointToRegion(AREAS, x * VIEW.w, y * VIEW.h);
    x = c.x / VIEW.w;
    y = c.y / VIEW.h;
  }
  return { xRatio: x, yRatio: y };
}

function ratioToOrigin(sprite, goal) {
  const clamped = clampRatioGoal(goal.xRatio, goal.yRatio);
  return { x: clamped.xRatio * VIEW.w - sprite.halfW, y: clamped.yRatio * VIEW.h - sprite.halfH };
}

function randomRoamGoal(random) {
  const span = 1 - 2 * ROAM_MARGIN;
  return clampRatioGoal(ROAM_MARGIN + random() * span, ROAM_MARGIN + random() * span);
}

/**
 * @param {object} sprite
 * @param {{ random?: () => number, roamMinMs?: number, roamMaxMs?: number, clipEndMs?: number }} [opts]
 */
function createBehaviorRunner(sprite, opts) {
  const random = opts && typeof opts.random === 'function' ? opts.random : Math.random;
  const roamMinMs = opts && Number.isFinite(opts.roamMinMs) ? opts.roamMinMs : ROAM_MIN_MS;
  const roamMaxMs = opts && Number.isFinite(opts.roamMaxMs) ? opts.roamMaxMs : ROAM_MAX_MS;
  const clipEndMs = opts && Number.isFinite(opts.clipEndMs) && opts.clipEndMs > 0 ? opts.clipEndMs : CLIP_END_FALLBACK_MS;

  const runner = {
    currentPlan: null,
    currentPriority: 0,
    token: 0,
    _stepTimer: null,
    _roamTimer: null,
    _roamStarted: false,
    submitIntent(intent) {
      return submitIntent(intent);
    },
    cancelPlan(reason) {
      cancelPlan(reason);
    },
    startRoam() {
      startRoam();
    },
    stopRoam() {
      stopRoam();
    },
  };

  function clearStepTimer() {
    if (runner._stepTimer != null) {
      window.clearTimeout(runner._stepTimer);
      runner._stepTimer = null;
    }
  }

  function bumpToken() {
    runner.token += 1;
    clearStepTimer();
    if (typeof sprite.stopMove === 'function') sprite.stopMove();
    return runner.token;
  }

  function finishPlan() {
    runner.currentPlan = null;
    runner.currentPriority = 0;
  }

  function playClip(clip, loop) {
    if (sprite.presentation && typeof sprite.presentation.play === 'function') {
      sprite.presentation.play(clip, { loop: !!loop });
    }
  }

  function waitThen(ms, myToken, then) {
    runner._stepTimer = window.setTimeout(() => {
      runner._stepTimer = null;
      if (myToken !== runner.token) return;
      then();
    }, ms);
  }

  function runStep(index, myToken) {
    if (myToken !== runner.token) return;
    const plan = runner.currentPlan;
    if (!plan || index >= plan.steps.length) {
      finishPlan();
      return;
    }
    const step = plan.steps[index];
    const next = () => runStep(index + 1, myToken);

    if (step.until === 'arrive' && step.goal) {
      const goalPx = ratioToOrigin(sprite, step.goal);
      if (goalPx.x > sprite.pos.x) sprite.facing = 'right';
      else if (goalPx.x < sprite.pos.x) sprite.facing = 'left';
      playClip(step.clip, step.loop);
      if (typeof sprite.startSpeedMoveDrive === 'function') {
        sprite.startSpeedMoveDrive({
          goal: goalPx,
          speedPx: walkSpeedPxOf(sprite),
          onArrive() {
            if (myToken !== runner.token) return;
            next();
          },
        });
      } else {
        next();
      }
      return;
    }

    playClip(step.clip, step.loop);
    const timed =
      step.until === 'duration' && Number.isFinite(step.durationMs) && step.durationMs > 0
        ? step.durationMs
        : Number.isFinite(step.durationMs) && step.durationMs > 0
          ? step.durationMs
          : clipEndMs;
    waitThen(timed, myToken, next);
  }

  function submitIntent(intent) {
    if (!intent || typeof intent !== 'object') return false;
    if (sprite.frozen || sprite.sleeping) return false;
    if (runner.currentPlan && !S.canInterrupt(runner.currentPriority, intent)) return false;
    const clips = clipsOf(sprite);
    const walkClip = S.mapPresentationClip('walk', clips);
    const planned = S.planBehavior({
      intent,
      allowedClips: allowedClipsOf(sprite),
      clips,
      walkClip,
      hasWalkClip: true,
      current: currentRatioOf(sprite),
    });
    if (!planned.ok) {
      console.warn(
        '[dsh-pet] planBehavior 失败 pet=' + (sprite.pet && sprite.pet.id) + '：' + planned.reason,
      );
      return false;
    }
    const myToken = bumpToken();
    runner.currentPlan = planned.plan;
    runner.currentPriority = planned.plan.priority;
    if (planned.plan.facing === 'left' || planned.plan.facing === 'right') {
      sprite.facing = planned.plan.facing;
    }
    runStep(0, myToken);
    return true;
  }

  function cancelPlan(_reason) {
    bumpToken();
    finishPlan();
  }

  function submitRoam() {
    if (sprite.frozen || sprite.sleeping) return;
    if (sprite.dragState && sprite.dragState.active) return;
    const intent = {
      source: 'roam',
      sequence: [{ clip: 'idle', until: 'duration', durationMs: ROAM_IDLE_MS }],
    };
    if (!(sprite.pet && sprite.pet.fixedEnabled)) {
      intent.goal = randomRoamGoal(random);
    }
    submitIntent(intent);
  }

  function scheduleNextRoam() {
    if (!runner._roamStarted) return;
    const span = Math.max(0, roamMaxMs - roamMinMs);
    const wait = roamMinMs + Math.floor(random() * (span || 1));
    runner._roamTimer = window.setTimeout(() => {
      runner._roamTimer = null;
      submitRoam();
      scheduleNextRoam();
    }, wait);
  }

  function startRoam() {
    if (runner._roamStarted) return;
    runner._roamStarted = true;
    submitRoam();
    scheduleNextRoam();
  }

  function stopRoam() {
    runner._roamStarted = false;
    if (runner._roamTimer != null) {
      window.clearTimeout(runner._roamTimer);
      runner._roamTimer = null;
    }
  }

  return runner;
}

Object.assign(PetSprite.prototype, {
  ensureBehaviorRunner() {
    if (!this.behaviorRunner) this.behaviorRunner = createBehaviorRunner(this);
    return this.behaviorRunner;
  },

  submitIntent(intent) {
    return this.ensureBehaviorRunner().submitIntent(intent);
  },

  cancelPlan(reason) {
    if (!this.behaviorRunner) return;
    this.behaviorRunner.cancelPlan(reason);
  },

  startRoam() {
    this.ensureBehaviorRunner().startRoam();
  },

  stopRoam() {
    if (!this.behaviorRunner) return;
    this.behaviorRunner.stopRoam();
  },
});

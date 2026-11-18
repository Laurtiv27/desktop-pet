/**
 * 三维行为执行器：把 Intent 编成 Plan，再逐步播放 / 按像素速度走到目标。
 *
 * model3d 没有 video.ended，duration 与 clip-end 都由本模块的定时器收尾。
 * arrive 步播走路并调用 startSpeedMoveDrive（goal 是 xRatio/yRatio，不是像素原点）。
 * autoBehavior === true：定时漫游（walk 剪辑 + 窗口位移）。
 * autoBehavior !== true：定时原地表演（可播 walk/wave 等剪辑，不移动窗口）——剪辑与位移是两回事。
 * 须在 sprite.js、presentation、motion 之后加载。
 * @module dsh-pet/runtime/electron-helper/sprite-behavior-runner
 */
'use strict';

const CLIP_SLOTS = ['idle', 'walk', 'turn', 'sit', 'wave', 'happy', 'drag'];
const ROAM_MIN_MS = 5000;
const ROAM_MAX_MS = 9000;
const INPLACE_MIN_MS = 4000;
const INPLACE_MAX_MS = 7000;
const CLIP_END_FALLBACK_MS = 1500;
const ROAM_MARGIN = 0.12;
/** 原地表演优先用这些槽；不含 idle（那是默认态），不含 death/drag。 */
const INPLACE_PREF = ['walk', 'wave', 'happy', 'dance', 'run', 'jump', 'cheer', 'punch'];
/** 这些槽按一段时长循环播；其余一次性播到 clip-end。 */
const INPLACE_LOOP = new Set(['walk', 'run', 'wave', 'happy', 'dance', 'cheer', 'fall']);

/**
 * 漫游与白名单只读已解析的 model3d meta（init 里 parseModel3dMeta 的结果，或配置内联原文）。
 * @param {object} sprite
 */
function model3dMetaOf(sprite) {
  const raw = sprite.model3dMeta || (sprite.pet && sprite.pet.model3d && sprite.pet.model3d.meta);
  if (!raw || typeof raw !== 'object') return null;
  // 解析失败不得回退原文：脏 meta 会被当成 autoBehavior 开启。
  if (typeof S.parseModel3dMeta === 'function') {
    return S.parseModel3dMeta(raw);
  }
  return raw;
}

/**
 * @param {object} sprite
 */
function clipsOf(sprite) {
  const meta = model3dMetaOf(sprite);
  const clips = meta && meta.clips;
  return clips && typeof clips === 'object' ? clips : {};
}

/**
 * 槽位名 ∪ meta.clips 的 key/value ∪ animations.idle。
 * @param {object} sprite
 */
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

/**
 * @param {object} sprite
 */
function walkSpeedPxOf(sprite) {
  const meta = model3dMetaOf(sprite);
  if (meta && Number.isFinite(meta.walkSpeedPx) && meta.walkSpeedPx > 0) return meta.walkSpeedPx;
  return S.DEFAULT_WALK_SPEED_PX || 120;
}

/**
 * @param {object} sprite
 */
function currentRatioOf(sprite) {
  const w = typeof VIEW !== 'undefined' && VIEW && VIEW.w > 0 ? VIEW.w : 1;
  const h = typeof VIEW !== 'undefined' && VIEW && VIEW.h > 0 ? VIEW.h : 1;
  const pos = sprite.pos || { x: 0, y: 0 };
  return {
    xRatio: ((pos.x || 0) + (sprite.halfW || 0)) / w,
    yRatio: ((pos.y || 0) + (sprite.halfH || 0)) / h,
  };
}

/**
 * 把目标夹进工作区并集。startSpeedMoveDrive 吃的是归一化中心，不是窗口左上角像素。
 * @param {number} xRatio
 * @param {number} yRatio
 */
function clampRatioGoal(xRatio, yRatio) {
  let x = Math.min(1, Math.max(0, xRatio));
  let y = Math.min(1, Math.max(0, yRatio));
  const viewOk = typeof VIEW !== 'undefined' && VIEW && VIEW.w > 0 && VIEW.h > 0;
  if (viewOk && typeof AREAS !== 'undefined' && AREAS && AREAS.length && typeof S.clampPointToRegion === 'function') {
    const c = S.clampPointToRegion(AREAS, x * VIEW.w, y * VIEW.h);
    x = c.x / VIEW.w;
    y = c.y / VIEW.h;
  }
  return { xRatio: x, yRatio: y };
}

/**
 * @param {() => number} random
 */
function randomRoamGoal(random) {
  const span = 1 - 2 * ROAM_MARGIN;
  return clampRatioGoal(ROAM_MARGIN + random() * span, ROAM_MARGIN + random() * span);
}

/**
 * 同优先级不能打断自己。shared 尚未导出 canInterrupt 时用 INTENT_PRIORITY 本地判断。
 * @param {number} currentPriority
 * @param {object} intent
 */
function canInterrupt(currentPriority, intent) {
  if (typeof S.canInterrupt === 'function') return S.canInterrupt(currentPriority, intent);
  const table = S.INTENT_PRIORITY || { user: 100, menu: 100, posture: 50, ai: 30, roam: 10 };
  const explicit = intent && intent.priority;
  const next = Number.isFinite(explicit) ? explicit : table[intent && intent.source];
  return Number.isFinite(next) && next > currentPriority;
}

/**
 * @param {object} sprite
 * @param {{ random?: () => number, roamMinMs?: number, roamMaxMs?: number, clipEndMs?: number }} [opts]
 */
function createBehaviorRunner(sprite, opts) {
  const random = opts && typeof opts.random === 'function' ? opts.random : Math.random;
  const roamMinMs = opts && Number.isFinite(opts.roamMinMs) ? opts.roamMinMs : ROAM_MIN_MS;
  const roamMaxMs = opts && Number.isFinite(opts.roamMaxMs) ? opts.roamMaxMs : ROAM_MAX_MS;
  const clipEndMs =
    opts && Number.isFinite(opts.clipEndMs) && opts.clipEndMs > 0 ? opts.clipEndMs : CLIP_END_FALLBACK_MS;

  const runner = {
    currentPlan: null,
    currentPriority: 0,
    token: 0,
    _stepTimer: null,
    _roamTimer: null,
    _roamStarted: false,
    _inplaceTimer: null,
    _inplaceStarted: false,
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
    startInPlaceActs() {
      startInPlaceActs();
    },
    stopInPlaceActs() {
      stopInPlaceActs();
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

  /**
   * 播片段并同步 sprite.anim（供 startSpeedMoveDrive 判断是否已在 walk）。
   * 非循环默认吞掉 finished，避免误进 handleEnded；clip-end 路径可传入 onEnded。
   */
  function playClip(clip, loop, onEnded) {
    sprite.anim = clip;
    sprite.once = !loop;
    if (!sprite.presentation || typeof sprite.presentation.play !== 'function') return;
    const opts = { loop: !!loop };
    if (!loop) {
      opts.onEnded = typeof onEnded === 'function' ? onEnded : () => {};
    }
    sprite.presentation.play(clip, opts);
    if (typeof sprite.presentation.setFacing === 'function') {
      sprite.presentation.setFacing(sprite.facing === 'right' ? 'right' : 'left');
    }
  }

  function waitThen(ms, myToken, then) {
    runner._stepTimer = window.setTimeout(() => {
      runner._stepTimer = null;
      if (myToken !== runner.token) return;
      then();
    }, ms);
  }

  function finishAndIdle(myToken) {
    if (myToken !== runner.token) return;
    finishPlan();
    if (typeof sprite.playIdle === 'function') sprite.playIdle();
  }

  function runStep(index, myToken) {
    if (myToken !== runner.token) return;
    const plan = runner.currentPlan;
    if (!plan || index >= plan.steps.length) {
      finishAndIdle(myToken);
      return;
    }
    const step = plan.steps[index];
    const next = () => runStep(index + 1, myToken);

    if (step.until === 'arrive' && step.goal) {
      const goal = clampRatioGoal(step.goal.xRatio, step.goal.yRatio);
      const w = typeof VIEW !== 'undefined' && VIEW && VIEW.w > 0 ? VIEW.w : 1;
      const tx = goal.xRatio * w;
      const cx = ((sprite.pos && sprite.pos.x) || 0) + (sprite.halfW || 0);
      if (tx > cx + 1) sprite.facing = 'right';
      else if (tx + 1 < cx) sprite.facing = 'left';
      // 优先 switchTo：写入 anim，且 walk 循环不会挂 handleEnded。
      if (typeof sprite.switchTo === 'function') {
        sprite.switchTo(step.clip, !step.loop);
      } else {
        playClip(step.clip, step.loop);
      }
      if (typeof sprite.startSpeedMoveDrive === 'function') {
        sprite.startSpeedMoveDrive({
          goal,
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

    if (step.until === 'clip-end' && !step.loop) {
      let advanced = false;
      const advance = () => {
        if (advanced || myToken !== runner.token) return;
        advanced = true;
        clearStepTimer();
        next();
      };
      playClip(step.clip, false, advance);
      const fallback =
        Number.isFinite(step.durationMs) && step.durationMs > 0 ? step.durationMs : clipEndMs;
      waitThen(fallback, myToken, advance);
      return;
    }

    playClip(step.clip, step.loop);
    const timed =
      Number.isFinite(step.durationMs) && step.durationMs > 0 ? step.durationMs : clipEndMs;
    waitThen(timed, myToken, next);
  }

  function submitIntent(intent) {
    if (sprite.playbackKind !== 'model3d') return false;
    if (!intent || typeof intent !== 'object' || !Array.isArray(intent.sequence)) return false;
    if (sprite.frozen || sprite.sleeping) return false;
    if (sprite.dragState && sprite.dragState.active && intent.source !== 'user') return false;
    if (runner.currentPlan && !canInterrupt(runner.currentPriority, intent)) return false;
    if (typeof S.planBehavior !== 'function') {
      console.warn('[dsh-pet] planBehavior 不可用，已忽略意图 pet=' + (sprite.pet && sprite.pet.id));
      return false;
    }
    const clips = clipsOf(sprite);
    const allowed = allowedClipsOf(sprite);
    if (typeof S.validateIntent === 'function') {
      const validated = S.validateIntent(intent, allowed);
      if (!validated.ok) {
        console.warn('[dsh-pet] validateIntent 失败 pet=' + (sprite.pet && sprite.pet.id) + '：' + validated.reason);
        return false;
      }
    }
    const walkClip =
      typeof S.mapPresentationClip === 'function' ? S.mapPresentationClip('walk', clips) : clips.walk || 'walk';
    const planned = S.planBehavior({
      intent,
      allowedClips: allowed,
      clips,
      walkClip,
      hasWalkClip: Boolean(clips && clips.walk),
      current: currentRatioOf(sprite),
    });
    if (!planned.ok) {
      console.warn('[dsh-pet] planBehavior 失败 pet=' + (sprite.pet && sprite.pet.id) + '：' + planned.reason);
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

  /** 显式 false 才关。缺 meta 时不把漫游打开（解析失败不乱走）。 */
  function roamEnabled() {
    if (sprite.playbackKind !== 'model3d') return false;
    const meta = model3dMetaOf(sprite);
    if (!meta) return false;
    return meta.autoBehavior !== false;
  }

  function roamBlocked() {
    if (sprite.frozen || sprite.sleeping) return true;
    if (sprite.dragState && sprite.dragState.active) return true;
    if (sprite.menuOpen || sprite.chatOpen || sprite.todoOpen) return true;
    if (sprite.throwRef !== null) return true;
    return false;
  }

  function submitRoam() {
    if (!roamEnabled() || roamBlocked()) return;
    submitIntent({
      source: 'roam',
      goal: randomRoamGoal(random),
      sequence: [{ clip: 'walk', until: 'arrive', loop: true }],
    });
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
    // 开漫游时关掉原地表演，避免两套定时器抢意图。
    if (roamEnabled()) stopInPlaceActs();
    if (!roamEnabled()) {
      stopRoam();
      // 不位移时改走原地表演：仍可播 walk 等剪辑。
      startInPlaceActs();
      return;
    }
    if (runner._roamStarted) return;
    runner._roamStarted = true;
    scheduleNextRoam();
  }

  function stopRoam() {
    runner._roamStarted = false;
    if (runner._roamTimer != null) {
      window.clearTimeout(runner._roamTimer);
      runner._roamTimer = null;
    }
  }

  /** 从 meta.clips 里挑可原地表演的槽（有映射才算有）。 */
  function inplaceSlotsOf() {
    const clips = clipsOf(sprite);
    const out = [];
    for (const slot of INPLACE_PREF) {
      if (typeof clips[slot] === 'string' && clips[slot]) out.push(slot);
    }
    return out;
  }

  function submitInPlaceAct() {
    if (roamEnabled() || roamBlocked()) return;
    if (runner.currentPlan) return;
    const slots = inplaceSlotsOf();
    if (!slots.length) return;
    const clip = slots[Math.floor(random() * slots.length)] || slots[0];
    if (INPLACE_LOOP.has(clip)) {
      const durationMs = 2200 + Math.floor(random() * 1800);
      submitIntent({
        source: 'roam',
        sequence: [{ clip, until: 'duration', durationMs, loop: true }],
      });
      return;
    }
    submitIntent({
      source: 'roam',
      sequence: [{ clip, until: 'clip-end', loop: false }],
    });
  }

  function scheduleNextInPlace() {
    if (!runner._inplaceStarted) return;
    const span = Math.max(0, INPLACE_MAX_MS - INPLACE_MIN_MS);
    const wait = INPLACE_MIN_MS + Math.floor(random() * (span || 1));
    runner._inplaceTimer = window.setTimeout(() => {
      runner._inplaceTimer = null;
      submitInPlaceAct();
      scheduleNextInPlace();
    }, wait);
  }

  function startInPlaceActs() {
    if (roamEnabled()) {
      stopInPlaceActs();
      return;
    }
    if (runner._inplaceStarted) return;
    if (!inplaceSlotsOf().length) return;
    runner._inplaceStarted = true;
    // 首拍稍晚，先让 idle 露一小会儿。
    runner._inplaceTimer = window.setTimeout(() => {
      runner._inplaceTimer = null;
      submitInPlaceAct();
      scheduleNextInPlace();
    }, 1500 + Math.floor(random() * 1500));
  }

  function stopInPlaceActs() {
    runner._inplaceStarted = false;
    if (runner._inplaceTimer != null) {
      window.clearTimeout(runner._inplaceTimer);
      runner._inplaceTimer = null;
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
    if (this.playbackKind !== 'model3d') return false;
    return this.ensureBehaviorRunner().submitIntent(intent);
  },

  cancelPlan(reason) {
    if (!this.behaviorRunner) return;
    this.behaviorRunner.cancelPlan(reason);
  },

  startRoam() {
    if (this.playbackKind !== 'model3d') return;
    this.ensureBehaviorRunner().startRoam();
  },

  stopRoam() {
    if (!this.behaviorRunner) return;
    this.behaviorRunner.stopRoam();
    this.behaviorRunner.stopInPlaceActs();
  },

  /** 拖拽成立后：有 drag 槽才换片段；Fox 演示没有该槽，保持当前画面。 */
  playModel3dDrag() {
    if (this.playbackKind !== 'model3d' || this.sleeping) return;
    const clips = this.model3dMeta && this.model3dMeta.clips;
    if (!clips || typeof clips.drag !== 'string' || !clips.drag) return;
    if (!this.presentation || typeof this.presentation.play !== 'function') return;
    this.presentation.play('drag', {
      loop: true,
      onEnded() {},
    });
  },
});

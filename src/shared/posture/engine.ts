import { isEyeSampleReliable } from './face-metrics.ts';
import type { EffectiveThresholds, FaceMetrics, PoseMetrics } from './types.ts';

export type PostureEventType =
  | 'fatigue'
  | 'yawn'
  | 'nod'
  | 'perclos'
  | 'slouch'
  | 'tilt'
  | 'slump'
  | 'near'
  | 'gaze_down';

export type PostureEvent = { type: PostureEventType; message: string };

type BaselineKey = 'face' | 'fwd' | 'tilt' | 'head_h';
type Baseline = Partial<Record<BaselineKey, number>>;

class Hold {
  private readonly seconds: number;
  private _since: number | null = null;

  constructor(seconds: number) {
    this.seconds = seconds;
  }

  update(cond: boolean, now: number): boolean {
    if (!cond) {
      this._since = null;
      return false;
    }
    if (this._since === null) {
      this._since = now;
      return false;
    }
    if (now - this._since + 1e-9 >= this.seconds) {
      this._since = null;
      return true;
    }
    return false;
  }
}

function median(vals: number[]): number | undefined {
  if (vals.length === 0) return undefined;
  const sorted = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export class Engine {
  private _mode: 'calib' | 'monitor' = 'calib';
  private _calibStart: number;
  private _calibSamples: Array<[BaselineKey, number]> = [];
  private _baseline: Baseline | null = null;
  private _ema: Partial<Record<BaselineKey, number>> = {};
  private readonly _holdEye: Hold;
  private readonly _holdYawn: Hold;
  private readonly _holdNod: Hold;
  private readonly _holdFwd: Hold;
  private readonly _holdTilt: Hold;
  private readonly _holdDrop: Hold;
  private readonly _holdNear: Hold;
  private readonly _holdGaze: Hold;
  private readonly _perclos: Array<[number, boolean]> = [];
  /** 虹膜表观尺度最近值（C 预留，不产生事件）。 */
  private _lastIrisScale: number | undefined;
  private readonly _thr: EffectiveThresholds;
  private readonly _now: () => number;

  constructor(thr: EffectiveThresholds, now?: () => number) {
    this._thr = thr;
    this._now = now ?? (() => Date.now() / 1000);
    this._calibStart = this._now();
    this._holdEye = new Hold(thr.EYE_CLOSED_SEC);
    this._holdYawn = new Hold(thr.YAWN_SEC);
    this._holdNod = new Hold(thr.NOD_SEC);
    this._holdGaze = new Hold(thr.GAZE_DOWN_SEC);
    const postureHold = thr.POSTURE_HOLD_SEC;
    this._holdFwd = new Hold(postureHold);
    this._holdTilt = new Hold(postureHold);
    this._holdDrop = new Hold(postureHold);
    this._holdNear = new Hold(postureHold);
  }

  /** 测试/诊断：最近一帧虹膜表观尺度。 */
  get lastIrisScale(): number | undefined {
    return this._lastIrisScale;
  }

  get mode(): 'calib' | 'monitor' {
    return this._mode;
  }

  recalibrate(): void {
    this._mode = 'calib';
    this._calibStart = this._now();
    this._calibSamples = [];
    this._ema = {};
  }

  private _finishCalibration(): void {
    const base: Baseline = {};
    for (const key of ['face', 'fwd', 'tilt', 'head_h'] as const) {
      const vals = this._calibSamples.filter(([k]) => k === key).map(([, v]) => v);
      const m = median(vals);
      if (m !== undefined) base[key] = m;
    }
    this._baseline = base;
    this._mode = 'monitor';
  }

  private _calibrating(now: number): boolean {
    if (this._mode !== 'calib') return false;
    const dt = now - this._calibStart;
    const n = this._calibSamples.length;
    if (dt >= this._thr.CALIB_SECONDS && n >= this._thr.CALIB_MIN_FRAMES) {
      this._finishCalibration();
    }
    return this._mode === 'calib';
  }

  private _feedCalibration(face: FaceMetrics | null, pose: PoseMetrics | null): void {
    if (face) this._calibSamples.push(['face', face.face_width]);
    if (pose) {
      this._calibSamples.push(['fwd', pose.fwd_ratio]);
      this._calibSamples.push(['tilt', pose.tilt_deg]);
      this._calibSamples.push(['head_h', pose.head_h]);
    }
  }

  private _smooth(key: 'fwd' | 'tilt' | 'head_h', val: number): number {
    const prev = this._ema[key];
    if (prev === undefined) {
      this._ema[key] = val;
      return val;
    }
    const next = prev + this._thr.POSE_EMA * (val - prev);
    this._ema[key] = next;
    return next;
  }

  update(face: FaceMetrics | null, pose: PoseMetrics | null): PostureEvent[] {
    const now = this._now();
    const events: PostureEvent[] = [];

    let poseM = pose;
    if (poseM) {
      poseM = {
        fwd_ratio: this._smooth('fwd', poseM.fwd_ratio),
        tilt_deg: this._smooth('tilt', poseM.tilt_deg),
        head_h: this._smooth('head_h', poseM.head_h),
      };
    }

    if (!face) {
      // 离开镜头：丢掉闭眼窗口，避免打水回来还带着旧占比。
      this._perclos.length = 0;
      this._holdEye.update(false, now);
      this._holdYawn.update(false, now);
      this._holdNod.update(false, now);
      this._holdGaze.update(false, now);
      this._lastIrisScale = undefined;
    } else if (isEyeSampleReliable(face, this._thr)) {
      this._perclos.push([now, face.eyes_closed]);
      while (this._perclos.length > 0 && now - this._perclos[0]![0] > this._thr.PERCLOS_WINDOW_SEC) {
        this._perclos.shift();
      }
    } else {
      // 低头/脸过小：打断「持续闭眼」，但不往 PERCLOS 记假闭眼。
      this._holdEye.update(false, now);
    }

    if (this._mode === 'calib') {
      this._feedCalibration(face, poseM);
      this._calibrating(now);
      return events;
    }

    const b = this._baseline;

    if (face) {
      const eyeOk = isEyeSampleReliable(face, this._thr);
      if (this._holdEye.update(eyeOk && face.eyes_closed, now)) {
        events.push({ type: 'fatigue', message: '检测到持续闭眼，休息一下！' });
      }
      if (this._holdYawn.update(face.yawn_open, now)) {
        events.push({ type: 'yawn', message: '检测到打哈欠，是不是困了？' });
      }
      if (this._holdNod.update(face.nodding, now)) {
        events.push({ type: 'nod', message: '检测到低头打瞌睡！' });
      }
      if (typeof face.iris_scale === 'number' && Number.isFinite(face.iris_scale)) {
        this._lastIrisScale = face.iris_scale;
      }
      // 闭眼时 lookDown 不可信；只在睁眼时计下视。
      const lookingDown =
        !face.eyes_closed &&
        typeof face.gaze_down === 'number' &&
        face.gaze_down >= this._thr.GAZE_DOWN_SCORE;
      if (this._holdGaze.update(lookingDown, now)) {
        events.push({ type: 'gaze_down', message: '看屏幕下方太久啦，抬抬头' });
      }
      if (this._perclos.length > 100) {
        const ratio =
          this._perclos.filter(([, c]) => c).length / this._perclos.length;
        if (ratio > this._thr.PERCLOS_RATIO) {
          const windowSec = Math.round(this._thr.PERCLOS_WINDOW_SEC);
          events.push({
            type: 'perclos',
            message: `${windowSec}秒内闭眼占比 ${Math.round(ratio * 100)}%，过度疲劳`,
          });
          this._perclos.length = 0;
        }
      }
    }

    if (poseM && face && b) {
      if (b.fwd != null) {
        const fwdOff = Math.abs(poseM.fwd_ratio - b.fwd);
        if (this._holdFwd.update(fwdOff > this._thr.FWD_HEAD_OFF, now)) {
          events.push({ type: 'slouch', message: '头前伸/驼背啦，坐直一点' });
        }
      }
      if (b.tilt != null) {
        const tiltOff = Math.abs(poseM.tilt_deg - b.tilt);
        if (this._holdTilt.update(tiltOff > this._thr.TILT_DEG, now)) {
          events.push({ type: 'tilt', message: '头歪了，注意颈椎' });
        }
      }
      if (b.head_h != null) {
        // 头往画面下方沉：ear Y↑ → head_h↑；旧版用 baseline-current 方向反了。
        const headSink = poseM.head_h - b.head_h;
        const faceGrow = b.face != null && b.face > 0 ? face.face_width / b.face : 1;
        const pitchDown = face.nodding || face.pitch_deg > this._thr.PITCH_NOD_DEG * 0.5;
        const strongSink = headSink > this._thr.HEAD_DROP;
        const softSink =
          headSink > this._thr.HEAD_DROP * 0.6 && faceGrow > this._thr.NEAR_FACE_RATIO;
        const pitchAssist =
          headSink > this._thr.HEAD_DROP * 0.5 && pitchDown && faceGrow > 1.05;
        if (this._holdDrop.update(strongSink || softSink || pitchAssist, now)) {
          events.push({ type: 'slump', message: '坐姿塌陷（趴桌/瘫坐），挺起来' });
        }
      }
      if (b.face != null) {
        const near = face.face_width / b.face > this._thr.NEAR_FACE_RATIO;
        if (this._holdNear.update(near, now)) {
          events.push({ type: 'near', message: '离屏幕太近了，注意眼睛' });
        }
      }
    }

    return events;
  }
}

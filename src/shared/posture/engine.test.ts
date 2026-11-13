import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { applySensitivity, DEFAULT_POSTURE_CONFIG } from './config.ts';
import { Engine } from './engine.ts';

describe('Engine', () => {
  test('校准未满不产出事件', () => {
    let t = 0;
    const eng = new Engine(applySensitivity(DEFAULT_POSTURE_CONFIG), () => t);
    const face = {
      ear: 0.3,
      mar: 0,
      roll_deg: 0,
      pitch_deg: 0,
      face_width: 0.2,
      eyes_closed: false,
      yawn_open: false,
      nodding: false,
    };
    const pose = { fwd_ratio: 0.2, tilt_deg: 2, head_h: 1.0 };
    assert.deepEqual(eng.update(face, pose), []);
    assert.equal(eng.mode, 'calib');
  });

  test('持续闭眼超过阈值触发 fatigue', () => {
    let t = 0;
    const eng = new Engine(applySensitivity(DEFAULT_POSTURE_CONFIG), () => t);
    const open = {
      ear: 0.3,
      mar: 0,
      roll_deg: 0,
      pitch_deg: 0,
      face_width: 0.2,
      eyes_closed: false,
      yawn_open: false,
      nodding: false,
    };
    const closed = { ...open, ear: 0.05, eyes_closed: true };
    const pose = { fwd_ratio: 0.2, tilt_deg: 2, head_h: 1.0 };
    // 喂满校准
    for (let i = 0; i < 40; i++) {
      t = i * 0.1;
      eng.update(open, pose);
    }
    t = 5;
    eng.update(open, pose);
    assert.equal(eng.mode, 'monitor');
    eng.update(closed, pose);
    t = 5 + 1.6;
    const ev = eng.update(closed, pose);
    assert.equal(ev.some((e) => e.type === 'fatigue'), true);
  });

  test('低头或脸过小时假闭眼不触发 fatigue', () => {
    let t = 0;
    const eng = new Engine(applySensitivity(DEFAULT_POSTURE_CONFIG), () => t);
    const open = {
      ear: 0.3,
      mar: 0,
      roll_deg: 0,
      pitch_deg: 0,
      face_width: 0.2,
      eyes_closed: false,
      yawn_open: false,
      nodding: false,
    };
    const pose = { fwd_ratio: 0.2, tilt_deg: 2, head_h: 1.0 };
    for (let i = 0; i < 40; i++) {
      t = i * 0.1;
      eng.update(open, pose);
    }
    t = 5;
    eng.update(open, pose);
    const fakeClosedNod = {
      ...open,
      ear: 0.05,
      eyes_closed: true,
      pitch_deg: 40,
      nodding: true,
    };
    const types: string[] = [];
    for (let i = 0; i < 30; i++) {
      t = 5 + i * 0.2;
      for (const e of eng.update(fakeClosedNod, pose)) types.push(e.type);
    }
    assert.equal(types.includes('fatigue'), false);
  });

  test('人脸丢失后清空闭眼窗口，回来不会立刻 perclos', () => {
    let t = 0;
    const eng = new Engine(applySensitivity(DEFAULT_POSTURE_CONFIG), () => t);
    const open = {
      ear: 0.3,
      mar: 0,
      roll_deg: 0,
      pitch_deg: 0,
      face_width: 0.2,
      eyes_closed: false,
      yawn_open: false,
      nodding: false,
    };
    const closed = { ...open, ear: 0.05, eyes_closed: true };
    const pose = { fwd_ratio: 0.2, tilt_deg: 2, head_h: 1.0 };
    for (let i = 0; i < 40; i++) {
      t = i * 0.1;
      eng.update(open, pose);
    }
    t = 5;
    eng.update(open, pose);
    // 堆一批闭眼样本
    for (let i = 0; i < 120; i++) {
      t = 5 + i * 0.05;
      eng.update(closed, pose);
    }
    // 离开镜头
    t += 1;
    eng.update(null, null);
    // 回来睁眼：不应带着旧窗口报 perclos
    const types: string[] = [];
    for (let i = 0; i < 20; i++) {
      t += 0.1;
      for (const e of eng.update(open, pose)) types.push(e.type);
    }
    assert.equal(types.includes('perclos'), false);
  });

  test('头往画面下方沉且持续会触发 slump（修正后的方向）', () => {
    let t = 0;
    const thr = applySensitivity(DEFAULT_POSTURE_CONFIG);
    const eng = new Engine(thr, () => t);
    const face = {
      ear: 0.3,
      mar: 0,
      roll_deg: 0,
      pitch_deg: 10,
      face_width: 0.2,
      eyes_closed: false,
      yawn_open: false,
      nodding: false,
    };
    const upright = { fwd_ratio: 0.2, tilt_deg: 2, head_h: 1.0 };
    for (let i = 0; i < 40; i++) {
      t = i * 0.1;
      eng.update(face, upright);
    }
    t = 5;
    eng.update(face, upright);
    assert.equal(eng.mode, 'monitor');
    const slumped = { ...upright, head_h: 1.0 + thr.HEAD_DROP + 0.05 };
    const types: string[] = [];
    for (let i = 0; i < 80; i++) {
      t = 5 + i * 0.2;
      for (const e of eng.update(face, slumped)) types.push(e.type);
    }
    assert.equal(types.includes('slump'), true);
  });

  test('闭眼时即使 gaze_down 很高也不报下视', () => {
    let t = 0;
    const thr = applySensitivity(DEFAULT_POSTURE_CONFIG);
    const eng = new Engine(thr, () => t);
    const open = {
      ear: 0.3,
      mar: 0,
      roll_deg: 0,
      pitch_deg: 0,
      face_width: 0.2,
      eyes_closed: false,
      yawn_open: false,
      nodding: false,
      gaze_down: 0,
    };
    const pose = { fwd_ratio: 0.2, tilt_deg: 2, head_h: 1.0 };
    for (let i = 0; i < 40; i++) {
      t = i * 0.1;
      eng.update(open, pose);
    }
    t = 5;
    eng.update(open, pose);
    const closedLookingDown = {
      ...open,
      ear: 0.1,
      eyes_closed: true,
      gaze_down: thr.GAZE_DOWN_SCORE + 0.4,
    };
    const types: string[] = [];
    for (let i = 0; i < 40; i++) {
      t = 5 + i * 0.2;
      for (const e of eng.update(closedLookingDown, pose)) types.push(e.type);
    }
    assert.equal(types.includes('gaze_down'), false);
    assert.equal(types.includes('fatigue'), true);
  });

  test('持续下视触发 gaze_down；iris_scale 只记录不报警', () => {
    let t = 0;
    const thr = applySensitivity(DEFAULT_POSTURE_CONFIG);
    const eng = new Engine(thr, () => t);
    const open = {
      ear: 0.3,
      mar: 0,
      roll_deg: 0,
      pitch_deg: 0,
      face_width: 0.2,
      eyes_closed: false,
      yawn_open: false,
      nodding: false,
      gaze_down: 0,
      iris_scale: 0.02,
    };
    const pose = { fwd_ratio: 0.2, tilt_deg: 2, head_h: 1.0 };
    for (let i = 0; i < 40; i++) {
      t = i * 0.1;
      eng.update(open, pose);
    }
    t = 5;
    eng.update(open, pose);
    const down = { ...open, gaze_down: thr.GAZE_DOWN_SCORE + 0.1, iris_scale: 0.03 };
    const types: string[] = [];
    for (let i = 0; i < 40; i++) {
      t = 5 + i * 0.2;
      for (const e of eng.update(down, pose)) types.push(e.type);
    }
    assert.equal(types.includes('gaze_down'), true);
    assert.equal(eng.lastIrisScale, 0.03);
    assert.equal(types.includes('perclos'), false);
  });

  test('基线仅 face 时不触发 slouch/tilt/slump', () => {
    let t = 0;
    const eng = new Engine(applySensitivity(DEFAULT_POSTURE_CONFIG), () => t);
    const face = {
      ear: 0.3,
      mar: 0,
      roll_deg: 0,
      pitch_deg: 0,
      face_width: 0.2,
      eyes_closed: false,
      yawn_open: false,
      nodding: false,
    };
    for (let i = 0; i < 40; i++) {
      t = i * 0.1;
      eng.update(face, null);
    }
    t = 5;
    eng.update(face, null);
    assert.equal(eng.mode, 'monitor');

    const badPose = { fwd_ratio: 0.9, tilt_deg: 45, head_h: 0.1 };
    const types: string[] = [];
    for (let i = 0; i < 100; i++) {
      t = 5 + i * 0.2;
      for (const e of eng.update(face, badPose)) {
        types.push(e.type);
      }
    }
    assert.equal(types.includes('slouch'), false);
    assert.equal(types.includes('tilt'), false);
    assert.equal(types.includes('slump'), false);
  });
});

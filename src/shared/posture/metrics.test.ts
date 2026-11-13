import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeFaceMetrics,
  estimateIrisScale,
  gazeDownFromBlendshapes,
  withGazeAndIris,
} from './face-metrics.ts';
import { computePostureMetrics } from './posture-metrics.ts';

function L(x: number, y: number, visibility = 1): { x: number; y: number; visibility: number } {
  return { x, y, visibility };
}

describe('gazeDownFromBlendshapes / estimateIrisScale', () => {
  test('下视 blendshape 取左右均值', () => {
    assert.equal(
      gazeDownFromBlendshapes([
        { categoryName: 'eyeLookDownLeft', score: 0.5 },
        { categoryName: 'eyeLookDownRight', score: 0.7 },
      ]),
      0.6,
    );
    assert.equal(estimateIrisScale(undefined), undefined);
    assert.equal(estimateIrisScale([]), undefined);
  });

  test('高 blink 时下视压成 0，并补强闭眼', () => {
    assert.equal(
      gazeDownFromBlendshapes([
        { categoryName: 'eyeLookDownLeft', score: 0.9 },
        { categoryName: 'eyeLookDownRight', score: 0.9 },
        { categoryName: 'eyeBlinkLeft', score: 0.8 },
        { categoryName: 'eyeBlinkRight', score: 0.7 },
      ]),
      0,
    );
    const face = {
      ear: 0.25,
      mar: 0,
      roll_deg: 0,
      pitch_deg: 0,
      face_width: 0.2,
      eyes_closed: false,
      yawn_open: false,
      nodding: false,
    };
    const merged = withGazeAndIris(face, {
      blendshapes: [
        { categoryName: 'eyeBlinkLeft', score: 0.7 },
        { categoryName: 'eyeBlinkRight', score: 0.6 },
        { categoryName: 'eyeLookDownLeft', score: 0.9 },
        { categoryName: 'eyeLookDownRight', score: 0.9 },
      ],
    });
    assert.equal(merged.eyes_closed, true);
    assert.equal(merged.gaze_down, 0);
  });
});

describe('computeFaceMetrics', () => {
  test('睁眼 EAR 高于闭眼阈值', () => {
    const lms = Array.from({ length: 400 }, () => L(0, 0));
    lms[33] = L(0, 0); lms[133] = L(0.2, 0);
    lms[159] = L(0.1, -0.05); lms[145] = L(0.1, 0.05);
    lms[263] = L(0.4, 0); lms[362] = L(0.6, 0);
    lms[386] = L(0.5, -0.05); lms[374] = L(0.5, 0.05);
    lms[13] = L(0.3, 0); lms[14] = L(0.3, 0.01);
    lms[61] = L(0.2, 0); lms[291] = L(0.4, 0);
    lms[10] = L(0.3, 0); lms[152] = L(0.3, 0.4);
    lms[127] = L(0.1, 0.1); lms[356] = L(0.5, 0.1);
    const m = computeFaceMetrics(lms);
    assert.ok(m.ear > 0.18);
    assert.equal(m.eyes_closed, false);
  });
});

describe('computePostureMetrics', () => {
  test('肩不可见返回 null', () => {
    const lms = Array.from({ length: 33 }, () => L(0, 0, 0.1));
    assert.equal(computePostureMetrics(lms), null);
  });
});

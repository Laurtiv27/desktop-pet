import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { normalizePresentation, resolvePetPresentation } from './pet-presentation.ts';
import type { Pet } from '../types.ts';

describe('normalizePresentation', () => {
  test('仅字面量 spine → spine', () => {
    assert.equal(normalizePresentation('spine'), 'spine');
  });

  test('其它值一律 video', () => {
    assert.equal(normalizePresentation('video'), 'video');
    assert.equal(normalizePresentation(undefined), 'video');
    assert.equal(normalizePresentation(null), 'video');
    assert.equal(normalizePresentation('SPINE'), 'video');
    assert.equal(normalizePresentation(42), 'video');
    assert.equal(normalizePresentation({}), 'video');
  });
});

describe('resolvePetPresentation', () => {
  test('读取 pet.presentation 并归一化', () => {
    const spinePet = { id: 'a', presentation: 'spine' } as Pet;
    const videoPet = { id: 'b', presentation: 'video' } as Pet;
    const defaultPet = { id: 'c' } as Pet;
    assert.equal(resolvePetPresentation(spinePet), 'spine');
    assert.equal(resolvePetPresentation(videoPet), 'video');
    assert.equal(resolvePetPresentation(defaultPet), 'video');
  });
});
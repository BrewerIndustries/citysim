import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAYERS, MAX_LAYERS, RAMPS, buildLut, toggleLayer } from '../src/app/palette.ts';

test('single-select replaces, and re-clicking the active layer clears it', () => {
  assert.deepEqual(toggleLayer([], 3, false), [3]);
  assert.deepEqual(toggleLayer([3], 7, false), [7], 'a second click replaces');
  assert.deepEqual(toggleLayer([3], 3, false), [], 'the same layer again turns it off');
});

test('multi-select adds and removes without disturbing the rest', () => {
  assert.deepEqual(toggleLayer([], 3, true), [3]);
  assert.deepEqual(toggleLayer([3], 7, true), [3, 7]);
  assert.deepEqual(toggleLayer([3, 7], 3, true), [7], 'removing one keeps the others');
});

test('selection order is preserved, because it decides the legend and the 3D ground', () => {
  assert.deepEqual(toggleLayer(toggleLayer(toggleLayer([], 9, true), 2, true), 5, true), [9, 2, 5]);
});

test(`no more than ${MAX_LAYERS} layers can be shown at once`, () => {
  let sel: number[] = [];
  for (let i = 0; i < MAX_LAYERS; i++) sel = toggleLayer(sel, i, true);
  assert.equal(sel.length, MAX_LAYERS);
  const refused = toggleLayer(sel, MAX_LAYERS, true);
  assert.deepEqual(refused, sel, 'one past the cap must change nothing at all');
  // Turning one off must make room again, or the cap becomes a dead end.
  assert.deepEqual(toggleLayer(toggleLayer(sel, 0, true), MAX_LAYERS, true).length, MAX_LAYERS);
});

test('every layer has a distinct key colour', () => {
  // The key colour is the only thing tying a colour on the map to a name in the legend,
  // so two layers sharing one would be a silent mislabelling.
  const seen = new Map<string, string>();
  for (const l of LAYERS) {
    const k = l.key.join(',');
    assert.equal(seen.get(k), undefined, `${l.label} and ${seen.get(k)} share the colour ${k}`);
    seen.set(k, l.label);
  }
});

test('key colours are bright enough to read against the dark map', () => {
  for (const l of LAYERS) {
    const lum = 0.2126 * l.key[0] + 0.7152 * l.key[1] + 0.0722 * l.key[2];
    assert.ok(lum > 90, `${l.label} is too dark to see at ${Math.round(lum)}`);
  }
});

test('every layer names a ramp that exists', () => {
  for (const l of LAYERS) {
    assert.ok(RAMPS[l.ramp], `${l.label} wants a ramp '${l.ramp}' that isn't defined`);
    assert.ok(l.max > 0, `${l.label} needs a positive display maximum`);
  }
});

test('a built LUT covers the whole byte range and ends where the ramp does', () => {
  const lut = buildLut(RAMPS.nuisance);
  assert.equal(lut.length, 256 * 4);
  const last = RAMPS.nuisance[RAMPS.nuisance.length - 1];
  assert.deepEqual([lut[255 * 4], lut[255 * 4 + 1], lut[255 * 4 + 2]], [...last]);
  assert.equal(lut[3], 255, 'every entry must be opaque');
});

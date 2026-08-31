import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Grid, CELL_METRES } from '../src/sim/grid.ts';
import { Fields } from '../src/sim/fields.ts';
import { blur } from '../src/sim/diffuse.ts';
import { Simulation } from '../src/sim/sim.ts';
import { Rng } from '../src/sim/rng.ts';

test('grid index math round-trips', () => {
  const g = new Grid(128, 64);
  for (const [x, y] of [[0, 0], [127, 63], [5, 17], [64, 32]]) {
    const i = g.index(x, y);
    assert.equal(g.xOf(i), x);
    assert.equal(g.yOf(i), y);
  }
  assert.equal(g.size, 128 * 64);
  assert.equal(g.areaKm2(), (128 * 64 * CELL_METRES * CELL_METRES) / 1e6);
});

test('grid rejects sizes that do not chunk evenly', () => {
  assert.throws(() => new Grid(100, 100), /power of two/);
  assert.throws(() => new Grid(64, 48 + 1), /chunks/);
});

test('rng is deterministic and reproducible from a seed', () => {
  const a = new Rng(12345);
  const b = new Rng(12345);
  const c = new Rng(12346);
  const seqA = Array.from({ length: 50 }, () => a.next());
  const seqB = Array.from({ length: 50 }, () => b.next());
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, Array.from({ length: 50 }, () => c.next()));
  for (const v of seqA) assert.ok(v >= 0 && v < 1);
});

test('blur produces a symmetric linear falloff reaching zero at 2r', () => {
  const w = 128, h = 128, r = 10;
  const g = new Grid(w, h);
  const f = new Fields(g);
  const src = f.get('emission');
  const dst = f.get('pollution');
  const c = g.index(64, 64);
  src[c] = 10_000;

  blur(src, dst, w, h, r, f.scratchA, f.scratchB, f.scratchRow);

  // Monotonically decreasing away from the source.
  let prev = dst[c];
  for (let d = 1; d <= 2 * r; d++) {
    const v = dst[g.index(64 + d, 64)];
    assert.ok(v < prev, `expected falloff at distance ${d}, got ${v} >= ${prev}`);
    prev = v;
  }
  // Zero beyond the effective reach of 2r.
  assert.equal(dst[g.index(64 + 2 * r + 1, 64)], 0);
  // Symmetric on both axes.
  for (const d of [3, 7, 15]) {
    const east = dst[g.index(64 + d, 64)];
    assert.ok(Math.abs(dst[g.index(64 - d, 64)] - east) < 1e-4);
    assert.ok(Math.abs(dst[g.index(64, 64 + d)] - east) < 1e-4);
    assert.ok(Math.abs(dst[g.index(64, 64 - d)] - east) < 1e-4);
  }
});

test('blur roughly conserves total mass', () => {
  const w = 128, h = 128;
  const g = new Grid(w, h);
  const f = new Fields(g);
  const src = f.get('emission');
  const dst = f.get('pollution');
  src[g.index(64, 64)] = 1000;

  blur(src, dst, w, h, 9, f.scratchA, f.scratchB, f.scratchRow);

  let total = 0;
  for (let i = 0; i < dst.length; i++) total += dst[i];
  // Diffusion redistributes, it does not create or destroy. Away from the clamped
  // edges this should hold tightly.
  assert.ok(Math.abs(total - 1000) < 1, `mass drifted to ${total}`);
});

test('simulation is deterministic: same seed, byte-identical city', () => {
  const run = () => {
    const s = new Simulation({ width: 128, height: 128, seed: 7 });
    const e = s.fields.get('emission');
    const a = s.fields.get('amenity');
    for (let i = 0; i < 400; i++) {
      e[s.rng.int(s.grid.size)] = s.rng.range(10, 90);
      a[s.rng.int(s.grid.size)] = s.rng.range(10, 90);
    }
    for (let t = 0; t < 40; t++) s.step();
    return s.hash();
  };
  assert.equal(run(), run());
});

test('staggered passes never all land on the same tick', () => {
  const s = new Simulation({ width: 128, height: 128, seed: 1 });
  s.fields.get('emission')[s.grid.index(64, 64)] = 500;

  const costs: number[] = [];
  for (let t = 0; t < 40; t++) {
    const before = performance.now();
    s.step();
    costs.push(performance.now() - before);
  }
  costs.sort((a, b) => a - b);
  const median = costs[costs.length >> 1];
  const worst = costs[costs.length - 1];
  // Before phase-offsetting, tick 0/20/40 ran every pass at once and cost ~3x median.
  assert.ok(worst < median * 2.5, `spiky tick cost: median ${median.toFixed(2)}ms, worst ${worst.toFixed(2)}ms`);
});

test('land value falls with pollution and rises with amenity', () => {
  const s = new Simulation({ width: 128, height: 128, seed: 3 });
  s.fields.get('emission')[s.grid.index(32, 64)] = 4000;
  s.fields.get('amenity')[s.grid.index(96, 64)] = 4000;
  for (let t = 0; t < 12; t++) s.step();

  const lv = s.fields.get('landValue');
  const dirty = lv[s.grid.index(32, 64)];
  const nice = lv[s.grid.index(96, 64)];
  const neutral = lv[s.grid.index(64, 8)];
  assert.ok(dirty < neutral, `polluted land value ${dirty} should be below neutral ${neutral}`);
  assert.ok(nice > neutral, `amenity land value ${nice} should be above neutral ${neutral}`);
});

test('field storage is one contiguous buffer and allocates nothing per tick', () => {
  const s = new Simulation({ width: 256, height: 256, seed: 1 });
  const bufBefore = s.fields.buffer;
  const bytesBefore = s.fields.bytes;
  for (let t = 0; t < 25; t++) s.step();
  assert.equal(s.fields.buffer, bufBefore, 'field buffer was reallocated during ticks');
  assert.equal(s.fields.bytes, bytesBefore);
  for (const [, plane] of s.fields.byName) {
    assert.equal(plane.buffer, bufBefore, 'a field plane escaped the shared buffer');
  }
});

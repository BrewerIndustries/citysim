import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Grid, CELL_METRES } from '../src/sim/grid.ts';
import { Fields, DIFFUSED, FIELD_MAX } from '../src/sim/fields.ts';
import { blur, scaleField, gainFor } from '../src/sim/diffuse.ts';
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
  // Structural, not timed. The first version of this test asserted on wall-clock
  // (worst < 2.5x median) and was flaky on CI, where a 1.4ms median and 3.8ms outlier
  // is just runner noise. What actually matters is the SCHEDULE: with distinct phases
  // no tick may run every pass at once, which is a property we can check exactly.
  const cycle = DIFFUSED.reduce((acc, d) => lcm(acc, d.every), 1);
  const counts: number[] = [];
  for (let tick = 0; tick < cycle; tick++) {
    counts.push(DIFFUSED.filter((d) => tick % d.every === d.phase % d.every).length);
  }

  const always = DIFFUSED.filter((d) => d.every === 1).length;
  const worst = Math.max(...counts);
  const best = Math.min(...counts);

  assert.ok(
    worst < DIFFUSED.length,
    `some tick runs all ${DIFFUSED.length} passes at once — phases have collided`,
  );
  // Every tick pays for the every-1 passes; beyond that, no tick should carry more
  // than two extra. Before phase-offsetting, tick 0 carried all eight.
  assert.ok(worst <= always + 2, `a tick runs ${worst} passes, expected at most ${always + 2}`);
  assert.ok(best >= always, `a tick runs only ${best} passes, expected at least ${always}`);
  // And the load must actually be spread, not bunched into a few heavy ticks.
  assert.ok(worst - best <= 1, `pass count varies ${best}..${worst}, too bunched`);
});

function lcm(a: number, b: number): number {
  const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y));
  return (a * b) / gcd(a, b);
}

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

test('gain restores peak amplitude so influence is not diluted by reach', () => {
  // Regression test for a real bug: a mass-conserving blur divides a station's coverage
  // across every cell it reaches, so a source of 140 peaked at 0.2 and every derived
  // field came out flat. gainFor() must bring the peak back to the source's own value.
  const w = 128, h = 128;
  const g = new Grid(w, h);
  const f = new Fields(g);
  const src = f.get('policeSrc');
  const dst = f.get('policeCover');
  const c = g.index(64, 64);
  src[c] = 140;

  for (const r of [4, 10, 20]) {
    blur(src, dst, w, h, r, f.scratchA, f.scratchB, f.scratchRow);
    scaleField(dst, gainFor(r));
    assert.ok(
      Math.abs(dst[c] - 140) < 0.5,
      `radius ${r}: peak should return to the source value 140, got ${dst[c].toFixed(2)}`,
    );
  }
});

test('every diffused field lands on the shared 0-255 scale', () => {
  const s = new Simulation({ width: 256, height: 256, seed: 5 });
  const rng = new Rng(99);
  for (const d of DIFFUSED) {
    const src = s.fields.get(d.src);
    for (let k = 0; k < 300; k++) src[rng.int(s.grid.size)] = rng.range(20, 160);
  }
  for (let t = 0; t < 30; t++) s.step();

  for (const d of DIFFUSED) {
    const plane = s.fields.get(d.dst);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < plane.length; i++) {
      if (plane[i] < min) min = plane[i];
      if (plane[i] > max) max = plane[i];
    }
    assert.ok(min >= 0, `${d.dst} went negative: ${min}`);
    assert.ok(max <= FIELD_MAX, `${d.dst} exceeded ${FIELD_MAX}: ${max}`);
  }
});

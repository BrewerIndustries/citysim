import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Grid } from '../src/sim/grid.ts';
import { Fields } from '../src/sim/fields.ts';
import { blur, blurRect } from '../src/sim/diffuse.ts';
import { Rng } from '../src/sim/rng.ts';

test('blur-rect matches a full pass exactly', () => {
  const w = 256, h = 256;
  const g = new Grid(w, h);
  const f = new Fields(g);
  const src = f.get('emission');
  const rng = new Rng(11);
  for (let k = 0; k < 3000; k++) src[rng.int(g.size)] = rng.range(5, 90);

  const full = new Float32Array(g.size);
  const partial = new Float32Array(g.size);

  for (const r of [1, 3, 8, 12, 24]) {
    blur(src, full, w, h, r, f.scratchA, f.scratchB, f.scratchRow);

    // Rects at the interior, at an edge, at a corner, and the whole grid.
    for (const [x0, y0, x1, y1] of [
      [80, 90, 140, 150],
      [0, 0, 40, 40],
      [w - 30, h - 30, w - 1, h - 1],
      [0, 100, w - 1, 120],
      [0, 0, w - 1, h - 1],
    ]) {
      partial.fill(-999);
      blurRect(src, partial, w, h, r, x0, y0, x1, y1, f.scratchA, f.scratchB, f.scratchRow);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = y * w + x;
          assert.equal(
            partial[i], full[i],
            `r=${r} rect ${x0},${y0}..${x1},${y1} differs at ${x},${y}: ${partial[i]} vs ${full[i]}`,
          );
        }
      }
    }
  }
});

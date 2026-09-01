/**
 * Diffusion kernels — the hot loop of the whole simulation.
 *
 * A separable box blur run twice approximates a Gaussian closely enough for a city sim
 * and costs O(cells) per pass regardless of radius, because both passes slide a running
 * sum. Edges clamp (repeat the boundary value). Two passes give a tent: influence falls
 * off LINEARLY to zero at 2*r, which is both the cheapest useful shape and the most
 * explainable one, since the Why Panel has to attribute every number to a cause.
 *
 * Both passes walk memory sequentially: the vertical pass keeps a row-wide running sum
 * so it never strides by `width`, which is the difference between fitting in cache and
 * thrashing it at Tier 3 sizes.
 *
 * ## Block-aligned accumulation
 *
 * Every pass can be restricted to a rect, so a field is only recomputed where its source
 * changed. That creates a hazard: a running sum started at x=0 and one started at x=900
 * accumulate different floating-point rounding, so the same cell would get a slightly
 * different value depending on which rect happened to cover it — and the simulation
 * would stop being reproducible.
 *
 * The fix is to restart the running sum at fixed multiples of BLUR_BLOCK. Any rect
 * containing a cell begins accumulating at the same block boundary, so every cell gets a
 * bit-identical result no matter how it was reached. Full-grid and rect passes are the
 * same code with different bounds, so they cannot drift apart.
 *
 * Zero allocation: every buffer is passed in.
 */

/** Running sums restart here. Smaller = tighter rects, more re-accumulation overhead. */
export const BLUR_BLOCK = 64;

const blockStart = (v: number) => v - (v % BLUR_BLOCK);

/**
 * Horizontal pass over rows [y0, y1], writing columns [x0, x1].
 * Accumulation begins at the block boundary at or before x0.
 */
export function boxBlurH(
  src: Float32Array, dst: Float32Array, w: number, h: number, r: number,
  x0 = 0, x1 = w - 1, y0 = 0, y1 = h - 1,
): void {
  const norm = 1 / (2 * r + 1);
  const last = w - 1;
  const from = blockStart(x0);
  for (let y = y0; y <= y1; y++) {
    const row = y * w;
    let sum = 0;
    for (let i = from - r; i <= from + r; i++) {
      sum += src[row + (i < 0 ? 0 : i > last ? last : i)];
    }
    for (let x = from; x <= x1; x++) {
      if (x % BLUR_BLOCK === 0 && x !== from) {
        // Re-seed at every block boundary so the accumulation path is fixed.
        sum = 0;
        for (let i = x - r; i <= x + r; i++) {
          sum += src[row + (i < 0 ? 0 : i > last ? last : i)];
        }
      }
      if (x >= x0) dst[row + x] = sum * norm;
      const out = x - r;
      const inc = x + r + 1;
      sum += src[row + (inc > last ? last : inc)] - src[row + (out < 0 ? 0 : out)];
    }
  }
}

/**
 * Vertical pass over columns [x0, x1], writing rows [y0, y1].
 * Accumulation begins at the block boundary at or before y0.
 */
export function boxBlurV(
  src: Float32Array, dst: Float32Array, w: number, h: number, r: number,
  rowSum: Float32Array, x0 = 0, x1 = w - 1, y0 = 0, y1 = h - 1,
): void {
  const norm = 1 / (2 * r + 1);
  const last = h - 1;
  const from = blockStart(y0);

  const seed = (centre: number) => {
    for (let x = x0; x <= x1; x++) rowSum[x] = 0;
    for (let i = centre - r; i <= centre + r; i++) {
      const row = (i < 0 ? 0 : i > last ? last : i) * w;
      for (let x = x0; x <= x1; x++) rowSum[x] += src[row + x];
    }
  };

  seed(from);
  for (let y = from; y <= y1; y++) {
    if (y % BLUR_BLOCK === 0 && y !== from) seed(y);
    if (y >= y0) {
      const row = y * w;
      for (let x = x0; x <= x1; x++) dst[row + x] = rowSum[x] * norm;
    }
    const out = (y - r < 0 ? 0 : y - r) * w;
    const inc = (y + r + 1 > last ? last : y + r + 1) * w;
    for (let x = x0; x <= x1; x++) rowSum[x] += src[inc + x] - src[out + x];
  }
}

/**
 * Full double blur, optionally restricted to a rect.
 *
 * Each of the four passes needs a wider input window than it produces, so the bounds
 * grow working backwards from the output: pass 4 over R needs pass 3 over R grown by r
 * in y, which needs pass 2 grown by r in x and y, which needs pass 1 grown by r in x
 * and 2r in y. Reads clamp to the grid exactly as an unrestricted pass would, so a rect
 * touching the map edge behaves identically.
 */
export function blurRect(
  src: Float32Array, dst: Float32Array, w: number, h: number, r: number,
  rx0: number, ry0: number, rx1: number, ry1: number,
  scratchA: Float32Array, scratchB: Float32Array, rowSum: Float32Array,
): void {
  const cx = (v: number) => (v < 0 ? 0 : v > w - 1 ? w - 1 : v);
  const cy = (v: number) => (v < 0 ? 0 : v > h - 1 ? h - 1 : v);

  // Each stage reads a halo of r AND backtracks to its block boundary before that, so
  // the bounds are chained backwards from the output. Getting this wrong is silent: the
  // earlier stage simply doesn't write far enough and the later one reads stale scratch.
  const y4a = cy(blockStart(ry0) - r), y4b = cy(ry1 + r);       // stage 4 reads scratchA
  const x3a = cx(blockStart(rx0) - r), x3b = cx(rx1 + r);       // stage 3 reads scratchB
  const y2a = cy(blockStart(y4a) - r), y2b = cy(y4b + r);       // stage 2 reads scratchA

  boxBlurH(src, scratchA, w, h, r, x3a, x3b, y2a, y2b);
  boxBlurV(scratchA, scratchB, w, h, r, rowSum, x3a, x3b, y4a, y4b);
  boxBlurH(scratchB, scratchA, w, h, r, rx0, rx1, y4a, y4b);
  boxBlurV(scratchA, dst, w, h, r, rowSum, rx0, rx1, ry0, ry1);
}

/** Whole-grid double blur. */
export function blur(
  src: Float32Array, dst: Float32Array, w: number, h: number, r: number,
  scratchA: Float32Array, scratchB: Float32Array, rowSum: Float32Array,
): void {
  blurRect(src, dst, w, h, r, 0, 0, w - 1, h - 1, scratchA, scratchB, rowSum);
}

/**
 * dst = dst * k, clamped, over a rect.
 *
 * Used to restore amplitude after diffusion. The blur conserves MASS — a point source
 * of total M spreads out so the sum stays M, which means the peak drops to M/(2r+1)^2.
 * That is correct physics for a dispersing plume and completely wrong for influence: a
 * police station's coverage should be strong next door and fade with distance, not be
 * divided across the 1,150 cells it reaches.
 */
export function scaleRect(
  dst: Float32Array, w: number, k: number, max: number,
  x0: number, y0: number, x1: number, y1: number,
): void {
  for (let y = y0; y <= y1; y++) {
    const row = y * w;
    for (let x = x0; x <= x1; x++) {
      const v = dst[row + x] * k;
      dst[row + x] = v < 0 ? 0 : v > max ? max : v;
    }
  }
}

/** Gain that restores a point source's peak amplitude after a double box blur. */
export function gainFor(r: number): number {
  const w = 2 * r + 1;
  return w * w;
}

/** dst = dst * factor, whole grid. */
export function decay(dst: Float32Array, factor: number): void {
  if (factor === 1) return;
  for (let i = 0; i < dst.length; i++) dst[i] *= factor;
}

/** dst = clamp(dst, 0, max), whole grid. */
export function clampField(dst: Float32Array, max: number): void {
  for (let i = 0; i < dst.length; i++) {
    const v = dst[i];
    dst[i] = v < 0 ? 0 : v > max ? max : v;
  }
}

/** dst = dst * k, whole grid. */
export function scaleField(dst: Float32Array, k: number): void {
  if (k === 1) return;
  for (let i = 0; i < dst.length; i++) dst[i] *= k;
}

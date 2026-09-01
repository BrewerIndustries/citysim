/**
 * Diffusion kernels — the hot loop of the whole simulation.
 *
 * A separable box blur run twice approximates a Gaussian closely enough for a
 * city sim and costs O(cells) per pass regardless of radius, because both passes
 * slide a running sum. Edges clamp (repeat the boundary value).
 *
 * Both passes walk memory sequentially: the vertical pass keeps a row-wide running
 * sum so it never strides by `width`, which is the difference between fitting in
 * cache and thrashing it at Tier 3 sizes.
 *
 * Zero allocation: every buffer is passed in.
 */

export function boxBlurH(
  src: Float32Array, dst: Float32Array, w: number, h: number, r: number,
): void {
  const norm = 1 / (2 * r + 1);
  const last = w - 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let i = -r; i <= r; i++) {
      sum += src[row + (i < 0 ? 0 : i > last ? last : i)];
    }
    for (let x = 0; x < w; x++) {
      dst[row + x] = sum * norm;
      const out = x - r;
      const inc = x + r + 1;
      sum += src[row + (inc > last ? last : inc)] - src[row + (out < 0 ? 0 : out)];
    }
  }
}

export function boxBlurV(
  src: Float32Array, dst: Float32Array, w: number, h: number, r: number, rowSum: Float32Array,
): void {
  const norm = 1 / (2 * r + 1);
  const last = h - 1;
  rowSum.fill(0);
  for (let i = -r; i <= r; i++) {
    const row = (i < 0 ? 0 : i > last ? last : i) * w;
    for (let x = 0; x < w; x++) rowSum[x] += src[row + x];
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) dst[row + x] = rowSum[x] * norm;
    const out = (y - r < 0 ? 0 : y - r) * w;
    const inc = (y + r + 1 > last ? last : y + r + 1) * w;
    for (let x = 0; x < w; x++) rowSum[x] += src[inc + x] - src[out + x];
  }
}

/**
 * Full separable blur: src -> dst, using two scratch planes.
 *
 * ONE separable box pass spreads a point source into a flat square plateau — every cell
 * inside the radius gets an identical value, which is useless for a city sim (a park
 * would be worth the same 20 cells away as next door). TWO passes convolve the box with
 * itself into a tent: influence falls off LINEARLY to zero at 2*r.
 *
 * Linear falloff is also the most explainable shape we could pick, which matters because
 * the Why Panel has to attribute every number to a cause ("park 6 cells away, +18").
 * Three passes would approximate a Gaussian more smoothly for 50% more cost; not worth it.
 *
 * Effective reach is 2*r, so callers pass HALF the radius they want.
 */
export function blur(
  src: Float32Array, dst: Float32Array, w: number, h: number, r: number,
  scratchA: Float32Array, scratchB: Float32Array, rowSum: Float32Array,
): void {
  boxBlurH(src, scratchA, w, h, r);
  boxBlurV(scratchA, scratchB, w, h, r, rowSum);
  boxBlurH(scratchB, scratchA, w, h, r);
  boxBlurV(scratchA, dst, w, h, r, rowSum);
}

/** dst = dst * factor. Used for per-tick decay of accumulating fields. */
export function decay(dst: Float32Array, factor: number): void {
  if (factor === 1) return;
  for (let i = 0; i < dst.length; i++) dst[i] *= factor;
}

/**
 * dst = dst * k.
 *
 * Used to restore amplitude after diffusion. blur() conserves MASS — a point source of
 * total M spreads out so the sum stays M, which means the peak drops to M/(2r+1)^2. That
 * is correct physics for a dispersing plume and completely wrong for influence: a police
 * station's coverage should be strong next door and fade with distance, not be divided
 * across the 1,150 cells it reaches.
 *
 * Multiplying by gainFor(r) restores the peak to the source's own value, turning the
 * kernel from "spread this mass out" into "this is my influence, falling linearly to zero
 * at 2r". Overlapping sources then add, which is the behaviour every field here wants.
 */
export function scaleField(dst: Float32Array, k: number): void {
  if (k === 1) return;
  for (let i = 0; i < dst.length; i++) dst[i] *= k;
}

/** Gain that restores a point source's peak amplitude after a double box blur of radius r. */
export function gainFor(r: number): number {
  const w = 2 * r + 1;
  return w * w;
}

/** dst = clamp(dst, 0, max). */
export function clampField(dst: Float32Array, max: number): void {
  for (let i = 0; i < dst.length; i++) {
    const v = dst[i];
    dst[i] = v < 0 ? 0 : v > max ? max : v;
  }
}

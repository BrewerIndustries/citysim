/**
 * Dirty-region tracking.
 *
 * Every diffused field is a PURE FUNCTION of its source field — `blur(src) * gain`,
 * with no accumulation across ticks. So a source that hasn't changed produces an output
 * that hasn't changed, and the whole pass can be skipped; and a source that changed only
 * in one neighbourhood only needs recomputing within the blur's reach of it.
 *
 * That property is what makes Tier 3 affordable. It is also fragile: a missed mark
 * leaves a stale field with no visible symptom until much later, so the simulation can
 * be run in a full-recompute mode and a test asserts the two agree bit for bit.
 */
export interface Rect { x0: number; y0: number; x1: number; y1: number }

/**
 * Which chunks of a source field have changed.
 *
 * A single bounding rectangle was the first attempt and it collapsed on real cities:
 * a polycentric map growing in several places at once produces a bbox covering
 * everything, so nothing is saved. Tracking chunks instead keeps the cost proportional
 * to the area that actually changed.
 *
 * Chunks are emitted as horizontal runs — consecutive dirty chunks in a row become one
 * rect — because city development clusters along streets, and because each rect carries
 * a fixed padding overhead that is better amortised over a long run than a single chunk.
 */
export const DIRTY_CHUNK = 64;

export class DirtyRegion {
  private readonly chunksX: number;
  private readonly chunksY: number;
  private readonly bits: Uint8Array;
  /** Marks chunks already covered by an emitted rect, so they aren't emitted twice. */
  private readonly scratch: Uint8Array;
  private count = 0;
  private all = false;

  constructor(width: number, height: number) {
    this.chunksX = Math.ceil(width / DIRTY_CHUNK);
    this.chunksY = Math.ceil(height / DIRTY_CHUNK);
    this.bits = new Uint8Array(this.chunksX * this.chunksY);
    this.scratch = new Uint8Array(this.chunksX * this.chunksY);
  }

  get isDirty(): boolean { return this.all || this.count > 0; }

  markAll(): void { this.all = true; }

  mark(x: number, y: number): void {
    if (this.all) return;
    const c = ((y / DIRTY_CHUNK) | 0) * this.chunksX + ((x / DIRTY_CHUNK) | 0);
    if (this.bits[c] === 0) { this.bits[c] = 1; this.count++; }
  }

  markRect(x0: number, y0: number, x1: number, y1: number): void {
    if (this.all) return;
    const cx0 = (x0 / DIRTY_CHUNK) | 0;
    const cx1 = (x1 / DIRTY_CHUNK) | 0;
    const cy0 = (y0 / DIRTY_CHUNK) | 0;
    const cy1 = (y1 / DIRTY_CHUNK) | 0;
    for (let cy = cy0; cy <= cy1; cy++) {
      const row = cy * this.chunksX;
      for (let cx = cx0; cx <= cx1; cx++) {
        if (this.bits[row + cx] === 0) { this.bits[row + cx] = 1; this.count++; }
      }
    }
  }

  /**
   * Rects to recompute, each padded by `pad` and clipped to the grid.
   *
   * Past a threshold of dirty chunks the padded rects overlap so heavily that one full
   * pass is cheaper than many partial ones, so we stop pretending and do the whole grid.
   */
  rects(width: number, height: number, pad: number): Rect[] {
    const whole = [{ x0: 0, y0: 0, x1: width - 1, y1: height - 1 }];
    if (this.all) return whole;
    if (this.count === 0) return [];
    if (this.count > this.bits.length * 0.35) return whole;

    const out: Rect[] = [];
    const claimed = this.scratch;
    claimed.fill(0);

    for (let cy = 0; cy < this.chunksY; cy++) {
      const row = cy * this.chunksX;
      let cx = 0;
      while (cx < this.chunksX) {
        if (this.bits[row + cx] === 0 || claimed[row + cx] === 1) { cx++; continue; }

        // Extend right along this row...
        let end = cx;
        while (end + 1 < this.chunksX && this.bits[row + end + 1] === 1 && claimed[row + end + 1] === 0) end++;

        // ...then down, while the row below carries exactly the same span. Emitting one
        // rect per chunk ROW made a tall dirty region pay the vertical padding once for
        // every row it spanned, which for a city block is most of the work.
        let bottom = cy;
        for (let ny = cy + 1; ny < this.chunksY; ny++) {
          const nrow = ny * this.chunksX;
          let same = true;
          for (let k = cx; k <= end; k++) {
            if (this.bits[nrow + k] === 0 || claimed[nrow + k] === 1) { same = false; break; }
          }
          if (!same) break;
          bottom = ny;
        }

        for (let ny = cy; ny <= bottom; ny++) {
          const nrow = ny * this.chunksX;
          for (let k = cx; k <= end; k++) claimed[nrow + k] = 1;
        }

        out.push({
          x0: Math.max(0, cx * DIRTY_CHUNK - pad),
          y0: Math.max(0, cy * DIRTY_CHUNK - pad),
          x1: Math.min(width - 1, (end + 1) * DIRTY_CHUNK - 1 + pad),
          y1: Math.min(height - 1, (bottom + 1) * DIRTY_CHUNK - 1 + pad),
        });
        cx = end + 1;
      }
    }
    return out;
  }

  clear(): void {
    this.all = false;
    if (this.count > 0) { this.bits.fill(0); this.count = 0; }
  }
}

/** Union of rects, used to bound the derived (land value, desirability) passes. */
export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

/**
 * Cells whose authored state changed this tick.
 *
 * Bounded: past the cap we stop recording individuals and mark everything dirty, which
 * is slower but never wrong.
 */
export class ChangeLog {
  private readonly cells: Int32Array;
  count = 0;
  overflowed = false;

  /** Bounds of the changed cells, so marking is one call per field, not one per cell. */
  x0 = 0; y0 = 0; x1 = -1; y1 = -1;

  constructor(capacity = 8192) {
    this.cells = new Int32Array(capacity);
  }

  addAt(i: number, x: number, y: number): void {
    this.add(i);
    if (this.x1 < this.x0) { this.x0 = this.x1 = x; this.y0 = this.y1 = y; return; }
    if (x < this.x0) this.x0 = x;
    if (x > this.x1) this.x1 = x;
    if (y < this.y0) this.y0 = y;
    if (y > this.y1) this.y1 = y;
  }

  add(i: number): void {
    if (this.overflowed) return;
    if (this.count >= this.cells.length) { this.overflowed = true; return; }
    this.cells[this.count++] = i;
  }

  at(n: number): number { return this.cells[n]; }

  reset(): void {
    this.count = 0;
    this.overflowed = false;
    this.x0 = 0; this.y0 = 0; this.x1 = -1; this.y1 = -1;
  }

  get empty(): boolean { return this.count === 0 && !this.overflowed; }
}

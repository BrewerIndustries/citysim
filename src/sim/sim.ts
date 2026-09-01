/**
 * The simulation. Pure typed arrays in, pure typed arrays out — no DOM, no renderer,
 * no browser APIs. Runs headless in Node for tests and benchmarks, in a Web Worker in
 * the game, and could be lifted to WASM without touching game logic.
 */
import { Grid } from './grid.ts';
import { Fields, DIFFUSED, FIELD_MAX } from './fields.ts';
import { blurRect, scaleRect, gainFor, BLUR_BLOCK } from './diffuse.ts';
import { DirtyRegion, unionRect, type Rect } from './dirty.ts';
import { Rng } from './rng.ts';

export interface SimOptions {
  width: number;
  height: number;
  seed?: number;
  /** Ignore the per-field `every` stagger and run every pass every tick (worst case). */
  forceAllPasses?: boolean;
  /**
   * Disable dirty-region tracking and recompute every field over the whole grid.
   * Slow, and used as the reference the incremental path is checked against.
   */
  fullRecompute?: boolean;
}

export class Simulation {
  readonly grid: Grid;
  readonly fields: Fields;
  readonly rng: Rng;
  tick = 0;
  private readonly forceAllPasses: boolean;
  readonly fullRecompute: boolean;
  /** One per source field: where has this source changed since it was last diffused. */
  private readonly dirty = new Map<string, DirtyRegion>();

  constructor(opts: SimOptions) {
    this.grid = new Grid(opts.width, opts.height);
    this.fields = new Fields(this.grid);
    this.rng = new Rng(opts.seed ?? 1);
    this.forceAllPasses = opts.forceAllPasses ?? false;
    this.fullRecompute = opts.fullRecompute ?? false;
    for (const d of DIFFUSED) {
      if (!this.dirty.has(d.src)) this.dirty.set(d.src, new DirtyRegion(opts.width, opts.height));
    }
    this.markAllDirty();
  }

  /** Record that a source field changed at one cell. */
  markSource(field: string, x: number, y: number): void {
    this.dirty.get(field)?.mark(x, y);
    for (const dep of DEPENDENTS[field] ?? []) this.dirty.get(dep)?.mark(x, y);
  }

  /**
   * The DirtyRegions a set of source fields writes into, including their dependents.
   *
   * Resolved once and reused, so a caller can mark thousands of individual cells without
   * paying a Map lookup per cell per field.
   */
  sourceRegions(fields: readonly string[]): DirtyRegion[] {
    const out: DirtyRegion[] = [];
    for (const name of fields) {
      const r = this.dirty.get(name);
      if (r && !out.includes(r)) out.push(r);
      for (const dep of DEPENDENTS[name] ?? []) {
        const d = this.dirty.get(dep);
        if (d && !out.includes(d)) out.push(d);
      }
    }
    return out;
  }

  markSourceRect(field: string, x0: number, y0: number, x1: number, y1: number): void {
    this.dirty.get(field)?.markRect(x0, y0, x1, y1);
    for (const dep of DEPENDENTS[field] ?? []) this.dirty.get(dep)?.markRect(x0, y0, x1, y1);
  }

  markSourceAll(field: string): void {
    this.dirty.get(field)?.markAll();
    for (const dep of DEPENDENTS[field] ?? []) this.dirty.get(dep)?.markAll();
  }

  markAllDirty(): void {
    for (const region of this.dirty.values()) region.markAll();
  }

  step(): void {
    const { width: w, height: h } = this.grid;
    const f = this.fields;
    let touched: Rect | null = null;

    const ran = new Set<string>();
    const skipped = new Set<string>();

    for (const d of DIFFUSED) {
      if (!this.forceAllPasses && this.tick % d.every !== d.phase % d.every) {
        skipped.add(d.src);
        continue;
      }
      ran.add(d.src);

      const region = this.dirty.get(d.src)!;
      // A source that hasn't changed produces an output that hasn't changed. This is
      // where nearly all of the saving comes from: in a settled city almost every pass
      // is skipped outright.
      //
      // Influence reaches 2r — but a cell's VALUE also depends on the running sum
      // accumulated from its block boundary, which reaches a further BLUR_BLOCK back.
      // Padding by only 2r left cells holding a value computed against older sources.
      const rects = this.fullRecompute
        ? [{ x0: 0, y0: 0, x1: w - 1, y1: h - 1 }]
        : region.rects(w, h, 2 * d.radius + BLUR_BLOCK);
      if (rects.length === 0) continue;

      const src = f.get(d.src);
      const dst = f.get(d.dst);
      const scale = (gainFor(d.radius) * d.decay * FIELD_MAX) / d.norm;
      for (const rect of rects) {
        blurRect(src, dst, w, h, d.radius, rect.x0, rect.y0, rect.x1, rect.y1,
          f.scratchA, f.scratchB, f.scratchRow);
        scaleRect(dst, w, scale, FIELD_MAX, rect.x0, rect.y0, rect.x1, rect.y1);
        // Crime suppression multiplies the field IN PLACE, so it must run exactly once
        // per recompute and over exactly the rect that was recomputed. Applying it to
        // the union of every field's rect compounded the multiplication tick after tick
        // and set the whole city oscillating.
        if (d.dst === 'crime') this.suppressCrime(rect);
      if (d.dst === 'pollution') this.suppressPollution(rect);
        touched = unionRect(touched, rect);
      }
    }

    // Only clear what was actually consumed. Passes are staggered, so a source marked
    // on a tick when its pass doesn't run must stay dirty until it does — clearing
    // everything here silently dropped changes to the every-4 and every-10 fields.
    if (!this.fullRecompute) {
      for (const src of ran) {
        if (!skipped.has(src)) this.dirty.get(src)!.clear();
      }
    }

    if (touched) {
      this.deriveLandValue(touched);
      this.deriveDesirability(touched);
    }
    this.tick++;
  }

  /**
   * Police coverage suppresses crime rather than merely offsetting it in land value.
   * Without this a police station was cosmetic — it nudged land value slightly while the
   * crime field it was supposed to fight went on climbing, so no amount of policing let
   * a neighbourhood densify. A fully covered area keeps 20% of its base crime.
   */
  /**
   * Cleanup stations scrub pollution out of the ground, the way police suppress crime.
   *
   * This is remediation, not prevention: it works on what is already there, so a city
   * that industrialised heavily can be cleaned up rather than only demolished. Full
   * coverage removes 85% of the pollution on a tile.
   */
  private suppressPollution(r: Rect): void {
    const pollution = this.fields.get('pollution');
    const cleanup = this.fields.get('cleanupCover');
    const w = this.grid.width;
    for (let y = r.y0; y <= r.y1; y++) {
      const row = y * w;
      for (let x = r.x0; x <= r.x1; x++) {
        const i = row + x;
        pollution[i] *= 1 - 0.85 * (cleanup[i] / FIELD_MAX);
      }
    }
  }

  private suppressCrime(r: Rect): void {
    const crime = this.fields.get('crime');
    const police = this.fields.get('policeCover');
    const w = this.grid.width;
    for (let y = r.y0; y <= r.y1; y++) {
      const row = y * w;
      for (let x = r.x0; x <= r.x1; x++) {
        const i = row + x;
        crime[i] *= 1 - 0.8 * (police[i] / FIELD_MAX);
      }
    }
  }

  /**
   * Land value: amenities and access push up, nuisances push down.
   * Deliberately a plain readable formula — every term here is a number the Why Panel
   * can name and attribute (docs/SIMULATION-MODEL.md rule 4).
   */
  /**
   * Flat land value added everywhere by the world works that stand. It raises the FLOOR
   * rather than joining LAND_VALUE_TERMS, because a term has to be a real field the Why
   * Panel can read per cell, and this one is uniform by definition.
   */
  worksLandValue = 0;

  private deriveLandValue(r: Rect): void {
    const f = this.fields;
    const lv = f.get('landValue');
    const amenity = f.get('amenityAccess');
    const transit = f.get('transitAccess');
    const school = f.get('schoolCover');
    const police = f.get('policeCover');
    const recycle = f.get('recycleCover');
    const pollution = f.get('pollution');
    const crime = f.get('crime');
    const w = this.grid.width;
    // Hoisted: this is a per-cell loop over the whole dirty rect, and reading a property
    // off `this` inside it is not free at Tier 3.
    const base = LAND_VALUE_BASE + this.worksLandValue;
    for (let y = r.y0; y <= r.y1; y++) {
    for (let x = r.x0; x <= r.x1; x++) {
      const i = y * w + x;
      let v = base;
      v += amenity[i] * 0.45;
      v += transit[i] * 0.30;
      v += school[i] * 0.20;
      v += police[i] * 0.10;
      v += recycle[i] * 0.08;
      v -= pollution[i] * 0.55;
      v -= crime[i] * 0.40;
      lv[i] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
    }
  }

  private deriveDesirability(r: Rect): void {
    const f = this.fields;
    const lv = f.get('landValue');
    const pollution = f.get('pollution');
    const crime = f.get('crime');
    const jobs = f.get('jobAccess');
    const transit = f.get('transitAccess');
    const dR = f.get('desirabilityR');
    const dC = f.get('desirabilityC');
    const dI = f.get('desirabilityI');
    const w = this.grid.width;

    for (let y = r.y0; y <= r.y1; y++) {
    for (let x = r.x0; x <= r.x1; x++) {
      const i = y * w + x;
      const p = pollution[i];
      const c = crime[i];
      const j = jobs[i];
      const t = transit[i];
      const v = lv[i];
      // Residents want jobs, safety, clean air. Commerce wants footfall and access.
      // Industry mostly wants transport and doesn't care about pollution or land value.
      // Land value is the dominant driver: it already aggregates amenities, schools and
      // nuisances, so weighting it lightly (0.25) left desirability too flat for anything
      // to ever reach level 2. Industry is largely indifferent to all of it.
      dR[i] = clamp255(v * 0.50 + j * 0.35 + t * 0.20 - p * 0.45 - c * 0.45);
      dC[i] = clamp255(v * 0.35 + j * 0.25 + t * 0.35 - c * 0.40 - p * 0.15);
      dI[i] = clamp255(t * 0.45 + j * 0.10 + 30 - c * 0.10);
    }
    }
  }

  /**
   * FNV-1a over every field plane. Used to assert determinism in CI: the same seed and
   * the same inputs must produce a byte-identical city after N ticks.
   */
  hash(): string {
    const bytes = new Uint8Array(this.fields.buffer);
    let h = 0x811c9dc5;
    // Stride to keep the hash cheap on a 4M-cell grid while still covering every plane.
    const stride = bytes.length > 1 << 22 ? 7 : 1;
    for (let i = 0; i < bytes.length; i += stride) {
      h ^= bytes[i];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/**
 * The land-value formula, published as data.
 *
 * The Why Panel renders these exact terms. Exporting them rather than letting the UI
 * hard-code its own copy is what stops the explanation drifting from the behaviour —
 * a panel that confidently misreports the model would be worse than no panel at all.
 * deriveLandValue() above is kept as an unrolled loop for speed, and the test
 * 'the Why Panel terms reproduce land value exactly' pins the two together.
 */
/**
 * Fields whose output depends on a source other than their own.
 *
 * Crime is suppressed by police coverage, so changing where the police are must force
 * crime to be recomputed even though no crime SOURCE moved. Without this, adding a
 * station left the old crime figures standing until something else happened to dirty
 * that neighbourhood.
 */
const DEPENDENTS: Record<string, string[]> = {
  policeSrc: ['crimeGen'],
  // Cleanup suppresses pollution, so moving a station has to force pollution to be
  // recomputed even though no emission source moved.
  cleanupSrc: ['emission'],
};

export const LAND_VALUE_BASE = 20;

export const LAND_VALUE_TERMS: ReadonlyArray<{ field: string; label: string; weight: number }> = [
  { field: 'amenityAccess', label: 'amenity access', weight: 0.45 },
  { field: 'transitAccess', label: 'transit access', weight: 0.30 },
  { field: 'schoolCover', label: 'school coverage', weight: 0.20 },
  { field: 'policeCover', label: 'police coverage', weight: 0.10 },
  { field: 'recycleCover', label: 'recycling', weight: 0.08 },
  { field: 'pollution', label: 'pollution', weight: -0.55 },
  { field: 'crime', label: 'crime', weight: -0.40 },
];

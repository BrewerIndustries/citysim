/**
 * The simulation. Pure typed arrays in, pure typed arrays out — no DOM, no renderer,
 * no browser APIs. Runs headless in Node for tests and benchmarks, in a Web Worker in
 * the game, and could be lifted to WASM without touching game logic.
 */
import { Grid } from './grid.ts';
import { Fields, DIFFUSED, FIELD_MAX } from './fields.ts';
import { blur, scaleField, clampField, gainFor } from './diffuse.ts';
import { Rng } from './rng.ts';

export interface SimOptions {
  width: number;
  height: number;
  seed?: number;
  /** Ignore the per-field `every` stagger and run every pass every tick (worst case). */
  forceAllPasses?: boolean;
}

export class Simulation {
  readonly grid: Grid;
  readonly fields: Fields;
  readonly rng: Rng;
  tick = 0;
  private readonly forceAllPasses: boolean;

  constructor(opts: SimOptions) {
    this.grid = new Grid(opts.width, opts.height);
    this.fields = new Fields(this.grid);
    this.rng = new Rng(opts.seed ?? 1);
    this.forceAllPasses = opts.forceAllPasses ?? false;
  }

  step(): void {
    const { width: w, height: h } = this.grid;
    const f = this.fields;

    for (const d of DIFFUSED) {
      if (!this.forceAllPasses && this.tick % d.every !== d.phase % d.every) continue;
      const src = f.get(d.src);
      const dst = f.get(d.dst);
      blur(src, dst, w, h, d.radius, f.scratchA, f.scratchB, f.scratchRow);
      // Restore amplitude (diffusion spreads influence, it must not dilute it), then
      // normalise onto the shared 0-255 scale so every field is comparable.
      scaleField(dst, (gainFor(d.radius) * d.decay * FIELD_MAX) / d.norm);
      clampField(dst, FIELD_MAX);
    }

    this.suppressCrime();
    this.deriveLandValue();
    this.deriveDesirability();
    this.tick++;
  }

  /**
   * Police coverage suppresses crime rather than merely offsetting it in land value.
   * Without this a police station was cosmetic — it nudged land value slightly while the
   * crime field it was supposed to fight went on climbing, so no amount of policing let
   * a neighbourhood densify. A fully covered area keeps 20% of its base crime.
   */
  private suppressCrime(): void {
    const crime = this.fields.get('crime');
    const police = this.fields.get('policeCover');
    for (let i = 0; i < crime.length; i++) {
      crime[i] *= 1 - 0.8 * (police[i] / FIELD_MAX);
    }
  }

  /**
   * Land value: amenities and access push up, nuisances push down.
   * Deliberately a plain readable formula — every term here is a number the Why Panel
   * can name and attribute (docs/SIMULATION-MODEL.md rule 4).
   */
  private deriveLandValue(): void {
    const f = this.fields;
    const lv = f.get('landValue');
    const amenity = f.get('amenityAccess');
    const transit = f.get('transitAccess');
    const school = f.get('schoolCover');
    const police = f.get('policeCover');
    const pollution = f.get('pollution');
    const crime = f.get('crime');
    const n = lv.length;

    for (let i = 0; i < n; i++) {
      let v = LAND_VALUE_BASE;
      v += amenity[i] * 0.45;
      v += transit[i] * 0.30;
      v += school[i] * 0.20;
      v += police[i] * 0.10;
      v -= pollution[i] * 0.55;
      v -= crime[i] * 0.40;
      lv[i] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }

  private deriveDesirability(): void {
    const f = this.fields;
    const lv = f.get('landValue');
    const pollution = f.get('pollution');
    const crime = f.get('crime');
    const jobs = f.get('jobAccess');
    const transit = f.get('transitAccess');
    const dR = f.get('desirabilityR');
    const dC = f.get('desirabilityC');
    const dI = f.get('desirabilityI');
    const n = lv.length;

    for (let i = 0; i < n; i++) {
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
export const LAND_VALUE_BASE = 20;

export const LAND_VALUE_TERMS: ReadonlyArray<{ field: string; label: string; weight: number }> = [
  { field: 'amenityAccess', label: 'amenity access', weight: 0.45 },
  { field: 'transitAccess', label: 'transit access', weight: 0.30 },
  { field: 'schoolCover', label: 'school coverage', weight: 0.20 },
  { field: 'policeCover', label: 'police coverage', weight: 0.10 },
  { field: 'pollution', label: 'pollution', weight: -0.55 },
  { field: 'crime', label: 'crime', weight: -0.40 },
];

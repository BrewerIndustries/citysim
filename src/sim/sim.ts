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

    this.deriveLandValue();
    this.deriveDesirability();
    this.tick++;
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
      let v = 20;
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
      dR[i] = clamp255(j * 0.40 + t * 0.20 + v * 0.25 - p * 0.70 - c * 0.60);
      dC[i] = clamp255(j * 0.30 + t * 0.35 + v * 0.30 - c * 0.45 - p * 0.20);
      dI[i] = clamp255(t * 0.55 + j * 0.15 + 30 - c * 0.10);
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

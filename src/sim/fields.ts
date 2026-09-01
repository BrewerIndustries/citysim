/**
 * Field storage. Struct-of-arrays over ONE ArrayBuffer, allocated once at startup.
 *
 * Two rules from docs/SIMULATION-MODEL.md are enforced by this design:
 *  - zero allocation in the tick loop (everything, including scratch, is preallocated)
 *  - the sim is a pure typed-array module (one buffer = trivially transferable to a
 *    Worker, and a straightforward path to WASM later)
 */
import type { Grid } from './grid.ts';

/** Every field in the simulation. Order is stable — it's part of the save format. */
export const FIELD_NAMES = [
  // --- sources: written by buildings/infrastructure, read by diffusion ---
  'emission',        // pollution generated here (industry, traffic, power)
  'crimeGen',        // crime generated here (density + unemployment + low land value)
  'amenity',         // parks, waterfront, landmarks
  'popR',            // residents living on this cell
  'jobsC',           // commercial jobs on this cell
  'jobsI',           // industrial jobs on this cell
  'policeSrc',       // police station output
  'fireSrc',         // fire station output
  'schoolSrc',       // school output
  'transitSrc',      // stop/station output
  'cleanupSrc',      // environmental remediation output

  // --- diffused: spread outward from sources, decay with distance ---
  'pollution',
  'crime',
  'policeCover',
  'fireCover',
  'schoolCover',
  'transitAccess',
  'cleanupCover',
  'amenityAccess',
  'jobAccess',

  // --- derived: computed per-cell from the above ---
  'landValue',
  'desirabilityR',
  'desirabilityC',
  'desirabilityI',
  'fireRisk',
] as const;

export type FieldName = (typeof FIELD_NAMES)[number];

/**
 * Fields that get a diffusion pass.
 *  radius — box radius in cells; effective REACH is 2x this (see diffuse.ts blur()),
 *           so radius 12 means influence fades linearly to zero at 24 cells / ~192m.
 *  decay  — multiplier applied after diffusion, for fields that accumulate over time.
 *  every  — run this pass every N ticks. Slow-moving social stats don't need fast
 *           updates; this is the staggering mitigation from docs/TECH-STACK.md.
 *  norm   — the raw accumulated value that should read as 255. Diffusion accumulates a
 *           real quantity (jobs reachable, emissions nearby), and those quantities live on
 *           wildly different scales — raw job access peaks near 4,500 while fire coverage
 *           peaks near 120. Normalising each to a documented 0-255 range makes the fields
 *           comparable, keeps the derived formulas tunable, and makes the Why Panel
 *           readable: "crime 72" means something on a fixed scale. These values are
 *           calibrated against a PLAYER-SCALE city, not the benchmark fixture.
 *           Two earlier attempts were wrong: p99 of the benchmark city saturated 1% of
 *           the map at 255, and its maxima were calibrated against 73,000 built cells —
 *           so a real starter city of ~90 cells read jobAccess 1.7 out of 255 and could
 *           never densify. These are set from a played city; the benchmark fixture just
 *           saturates, which is fine because it only measures cost.
 *  phase  — WHICH tick in the `every` cycle this pass runs on. Without distinct phases
 *           the staggered passes all align on tick 0, 20, 40... and that one tick costs
 *           as much as running everything every tick — measured as a 3x p95 spike over
 *           median. Phases spread the load so no tick runs more than ~4 passes.
 */
export const DIFFUSED: ReadonlyArray<{
  src: FieldName; dst: FieldName; radius: number; decay: number; norm: number;
  every: number; phase: number;
}> = [
  // Fast-moving, matters immediately — every tick.
  { src: 'emission',   dst: 'pollution',      radius: 12, decay: 0.94, norm: 600, every: 1,  phase: 0 },
  { src: 'crimeGen',   dst: 'crime',          radius: 8,  decay: 0.90, norm: 500,  every: 1,  phase: 0 },
  // Service coverage changes only when you build something — quarter rate, one per tick.
  { src: 'policeSrc',  dst: 'policeCover',    radius: 20, decay: 1.0,  norm: 200,  every: 4,  phase: 0 },
  { src: 'fireSrc',    dst: 'fireCover',      radius: 18, decay: 1.0,  norm: 200,  every: 4,  phase: 1 },
  { src: 'transitSrc', dst: 'transitAccess',  radius: 10, decay: 1.0,  norm: 200,  every: 4,  phase: 2 },
  { src: 'amenity',    dst: 'amenityAccess',  radius: 14, decay: 1.0,  norm: 500,  every: 4,  phase: 3 },
  // Slow social stats — see docs/FEATURES.md, education moves over decades.
  // Phases 5 and 7 are odd, so they never collide with the every-4 passes on phase 0.
  { src: 'schoolSrc',  dst: 'schoolCover',    radius: 24, decay: 1.0,  norm: 200,  every: 10, phase: 5 },
  // Remediation: scrubs pollution already in the ground, so a city that industrialised
  // heavily can be cleaned up rather than only demolished. On an eight-tick rota because
  // all four every-4 phases were taken, and cleanup coverage only changes when the
  // player builds a station.
  { src: 'cleanupSrc', dst: 'cleanupCover',   radius: 22, decay: 1.0,  norm: 220,  every: 8,  phase: 6 },
  { src: 'jobsC',      dst: 'jobAccess',      radius: 30, decay: 1.0,  norm: 1200, every: 10, phase: 7 },
];

/** Every diffused field is normalised to this range. One scale for the whole sim. */
export const FIELD_MAX = 255;

export class Fields {
  readonly buffer: ArrayBuffer;
  readonly byName: Map<FieldName, Float32Array>;
  /** Preallocated scratch for the separable blur. Never allocate inside a tick. */
  readonly scratchA: Float32Array;
  readonly scratchB: Float32Array;
  readonly scratchRow: Float32Array;
  readonly bytes: number;

  constructor(grid: Grid) {
    const n = grid.size;
    const planes = FIELD_NAMES.length + 2; // + scratchA, scratchB
    this.bytes = planes * n * 4 + grid.width * 4;
    this.buffer = new ArrayBuffer(this.bytes);

    this.byName = new Map();
    let offset = 0;
    for (const name of FIELD_NAMES) {
      this.byName.set(name, new Float32Array(this.buffer, offset, n));
      offset += n * 4;
    }
    this.scratchA = new Float32Array(this.buffer, offset, n);
    offset += n * 4;
    this.scratchB = new Float32Array(this.buffer, offset, n);
    offset += n * 4;
    this.scratchRow = new Float32Array(this.buffer, offset, grid.width);
  }

  get(name: FieldName): Float32Array {
    const f = this.byName.get(name);
    if (!f) throw new Error(`unknown field: ${name}`);
    return f;
  }

  clear(name: FieldName): void {
    this.get(name).fill(0);
  }
}

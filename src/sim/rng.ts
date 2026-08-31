/**
 * Seeded PRNG. Determinism is a hard requirement (see docs/SIMULATION-MODEL.md rule 3):
 * save/load, replay, timelapse and reproducible bug reports all depend on it.
 * mulberry32 — small state, fast, good enough distribution for simulation jitter.
 */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return (this.next() * n) | 0;
  }

  /** Uniform float in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }

  state(): number {
    return this.s;
  }

  restore(s: number): void {
    this.s = s >>> 0;
  }
}

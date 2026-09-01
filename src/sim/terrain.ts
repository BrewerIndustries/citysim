/**
 * Terrain.
 *
 * Generated, not authored — so it is NOT stored in saves. The map seed is, and the
 * terrain is regenerated from it, which keeps a save at about a kilobyte. (If
 * terraforming is ever added, terrain becomes authored state and has to move into the
 * save file; the format is versioned for exactly that kind of change.)
 *
 * Fractal value noise: cheap, deterministic, and smooth enough that coastlines look
 * like coastlines rather than static.
 */
import type { Grid } from './grid.ts';

/** Height below which a cell is water. */
export const SEA_LEVEL = 78;
/** Map seed that produces a completely flat, water-free map. */
export const FLAT_MAP = 0;
const FLAT_HEIGHT = 150;

export class Terrain {
  readonly height: Uint8Array;
  readonly water: Uint8Array;
  /** 1 where a land cell touches water — the waterfront. */
  readonly shore: Uint8Array;
  waterCells = 0;

  constructor(grid: Grid, seed: number) {
    const n = grid.size;
    this.height = new Uint8Array(n);
    this.water = new Uint8Array(n);
    this.shore = new Uint8Array(n);
    if (seed === FLAT_MAP) {
      // A featureless plain. Used by tests that build at fixed coordinates, and
      // available in-game for anyone who'd rather plan without a coastline.
      this.height.fill(FLAT_HEIGHT);
      return;
    }
    this.generate(grid, seed);
  }

  private generate(grid: Grid, seed: number): void {
    const { width, height: h } = grid;
    const raw = new Float32Array(grid.size);
    let min = Infinity;
    let max = -Infinity;

    // Four octaves is enough for a readable coast without turning into noise.
    const octaves = [
      { scale: 0.014, amp: 1.0 },
      { scale: 0.031, amp: 0.5 },
      { scale: 0.070, amp: 0.25 },
      { scale: 0.150, amp: 0.12 },
    ];

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < width; x++) {
        let v = 0;
        for (let o = 0; o < octaves.length; o++) {
          const { scale, amp } = octaves[o];
          v += amp * valueNoise(x * scale, y * scale, seed + o * 8191);
        }
        const i = y * width + x;
        raw[i] = v;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }

    const span = max - min || 1;
    for (let i = 0; i < raw.length; i++) {
      this.height[i] = Math.round(((raw[i] - min) / span) * 255);
      if (this.height[i] < SEA_LEVEL) { this.water[i] = 1; this.waterCells++; }
    }

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (this.water[i]) continue;
        const touches =
          (x > 0 && this.water[i - 1]) ||
          (x < width - 1 && this.water[i + 1]) ||
          (y > 0 && this.water[i - width]) ||
          (y < h - 1 && this.water[i + width]);
        if (touches) this.shore[i] = 1;
      }
    }
  }

  get waterFraction(): number {
    return this.waterCells / this.height.length;
  }
}

/** Smooth 2D value noise on an integer lattice, hashed from the seed. */
function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function hash2(x: number, y: number, seed: number): number {
  let n = Math.imul(x, 0x1f1f1f1f) ^ Math.imul(y, 0x27d4eb2d) ^ Math.imul(seed, 0x9e3779b1);
  n = Math.imul(n ^ (n >>> 15), 0x85ebca6b);
  n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

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
/** A pump needs ground at least this productive, or open water beside it. */
export const WATER_TABLE_MIN = 110;

/** Cells further than this from water cannot flood. */
export const FLOOD_REACH = 12;
/** Height above sea level at which flood risk reaches zero. */
export const FLOOD_RISE = 26;

/** Map seed that produces a completely flat, water-free map. */
export const FLAT_MAP = 0;
const FLAT_HEIGHT = 150;

export class Terrain {
  readonly height: Uint8Array;
  readonly water: Uint8Array;
  /** 1 where a land cell touches water — the waterfront. */
  readonly shore: Uint8Array;
  /**
   * How exposed each land cell is to flooding, 0–255.
   *
   * Low ground close to water is at risk; high ground and inland is not. Static for the
   * life of a map, which is what lets floods be a decision rather than a punishment:
   * the risk is visible as a data layer before you build anything on it.
   */
  readonly floodRisk: Uint8Array;
  /**
   * Underground water, 0–255. A pump can be built on ground above about
   * {@link WATER_TABLE_MIN}, which is what gives a city built away from a river
   * somewhere to draw from. Static for the life of a map.
   */
  readonly waterTable: Uint8Array;
  waterCells = 0;

  constructor(grid: Grid, seed: number) {
    const n = grid.size;
    this.height = new Uint8Array(n);
    this.water = new Uint8Array(n);
    this.shore = new Uint8Array(n);
    this.floodRisk = new Uint8Array(n);
    this.waterTable = new Uint8Array(n);
    if (seed === FLAT_MAP) {
      // A flat map still needs somewhere to draw water from, or nothing can be built.
      this.waterTable.fill(200);
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

    this.computeFloodRisk(grid);
    this.computeWaterTable(grid, seed);
  }

  /**
   * Aquifers: broad, smooth patches of underground water, biased toward low ground
   * because that is where water collects. Deliberately coarse — the player should be
   * looking for a REGION to put a pump in, not hunting a single lucky tile.
   */
  private computeWaterTable(grid: Grid, seed: number): void {
    const { width, height: h } = grid;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (this.water[i]) { this.waterTable[i] = 255; continue; }
        const n =
          0.68 * valueNoise(x * 0.011, y * 0.011, seed + 4211) +
          0.32 * valueNoise(x * 0.027, y * 0.027, seed + 9137);
        // Low ground holds more water than a hilltop.
        const rise = Math.max(0, this.height[i] - SEA_LEVEL) / (255 - SEA_LEVEL);
        const v = n * (1 - 0.55 * rise);
        this.waterTable[i] = Math.round(Math.max(0, Math.min(1, (v - 0.22) / 0.5)) * 255);
      }
    }
  }

  /**
   * Distance to water by multi-source BFS, combined with height above sea level.
   * Both matter: a cell right on the shore but high up is safe, and so is low ground
   * far inland.
   */
  private computeFloodRisk(grid: Grid): void {
    const { width, height: h } = grid;
    const n = grid.size;
    const dist = new Uint8Array(n).fill(255);
    const queue = new Int32Array(n);
    let tail = 0;
    for (let i = 0; i < n; i++) if (this.water[i]) { dist[i] = 0; queue[tail++] = i; }

    let head = 0;
    while (head < tail) {
      const i = queue[head++];
      const d = dist[i];
      if (d >= FLOOD_REACH) continue;
      const x = i % width;
      const y = (i / width) | 0;
      if (x > 0 && dist[i - 1] > d + 1) { dist[i - 1] = d + 1; queue[tail++] = i - 1; }
      if (x < width - 1 && dist[i + 1] > d + 1) { dist[i + 1] = d + 1; queue[tail++] = i + 1; }
      if (y > 0 && dist[i - width] > d + 1) { dist[i - width] = d + 1; queue[tail++] = i - width; }
      if (y < h - 1 && dist[i + width] > d + 1) { dist[i + width] = d + 1; queue[tail++] = i + width; }
    }

    for (let i = 0; i < n; i++) {
      if (this.water[i] || dist[i] > FLOOD_REACH) continue;
      const nearness = 1 - dist[i] / (FLOOD_REACH + 1);
      const rise = this.height[i] - SEA_LEVEL;
      const lowness = Math.max(0, 1 - rise / FLOOD_RISE);
      this.floodRisk[i] = Math.round(255 * nearness * lowness);
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

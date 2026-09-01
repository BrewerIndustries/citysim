/**
 * Utility networks — power and water.
 *
 * One implementation serves both, because they are the same shape: a set of source
 * buildings inject capacity, a network of conductors carries it, and everything within
 * UTILITY_REACH of a live conductor is served, up to the supply available.
 *
 * The reach is the same three tiles that governs road access, so a plot a road can serve
 * is a plot a line and a pipe can serve. One rule to learn, not three.
 *
 * Connectivity changes only when the player builds; building LEVELS change constantly and
 * do not affect it at all. So the flood is cached and only the accounting runs each tick —
 * re-flooding every tick was the single largest expense in the simulation before it was.
 */
import type { Grid } from './grid.ts';
import { Tiles, CIVIC_BY_ID, type CivicDef } from './tiles.ts';

/** The same three-tile rule as roads. */
export const UTILITY_REACH = 3;

export interface UtilityReport {
  supply: number;
  demand: number;
  servedCells: number;
  unservedCells: number;
  shortfall: boolean;
  /**
   * Source buildings with nothing attached to them.
   *
   * A plant or pump counts toward supply whether or not anything is connected, so an
   * isolated one leaves the readout looking healthy — "0 / 2400" — while not a single
   * building is served. That is the most confusing state the system can be in, so it is
   * reported explicitly rather than left for the player to deduce.
   */
  isolatedSources: Array<{ x: number; y: number }>;
}

export interface UtilitySpec {
  /** The tile plane that carries this utility. */
  conductor: (t: Tiles) => Uint8Array;
  /** Capacity a source building provides, or 0 if it isn't one. */
  capacityOf: (def: CivicDef) => number;
  /** How much a developed cell draws at a given level. */
  draw: (level: number) => number;
  /** Where the served flag is written. */
  served: (t: Tiles) => Uint8Array;
}

export const POWER: UtilitySpec = {
  conductor: (t) => t.powerLine,
  capacityOf: (d) => d.supply ?? 0,
  draw: (level) => level * 3,
  served: (t) => t.powered,
};

export const WATER: UtilitySpec = {
  conductor: (t) => t.pipe,
  capacityOf: (d) => d.water ?? 0,
  draw: (level) => level * 2,
  served: (t) => t.watered,
};

export class UtilityGrid {
  readonly depth: Uint8Array;
  /** Reached cells in flood order, so a shortfall starves the far end first. */
  readonly order: Int32Array;
  orderCount = 0;
  supply = 0;
  private isolated: Array<{ x: number; y: number }> = [];
  private stale = true;
  private readonly spec: UtilitySpec;

  constructor(size: number, spec: UtilitySpec) {
    this.spec = spec;
    this.depth = new Uint8Array(size);
    this.order = new Int32Array(size);
    this.depth.fill(255);
  }

  markDirty(): void { this.stale = true; }

  step(grid: Grid, tiles: Tiles): UtilityReport {
    if (this.stale) {
      const r = flood(grid, tiles, this.spec, this.order, this.depth);
      this.orderCount = r.count;
      this.supply = r.supply;
      this.isolated = r.isolated;
      this.stale = false;
    }
    return this.account(tiles);
  }

  private account(tiles: Tiles): UtilityReport {
    const { level } = tiles;
    const served = this.spec.served(tiles);
    const { order, orderCount, depth } = this;
    let demand = 0;
    let servedCells = 0;
    let remaining = this.supply;

    for (let q = 0; q < orderCount; q++) {
      const i = order[q];
      const lvl = level[i];
      if (lvl === 0) { served[i] = 1; continue; }
      const d = this.spec.draw(lvl);
      demand += d;
      if (remaining >= d) { remaining -= d; served[i] = 1; servedCells++; }
      else served[i] = 0;
    }

    // Anything the flood never reached still counts toward demand, so the player sees
    // the shortfall itself rather than only its symptoms.
    let unservedCells = 0;
    for (let i = 0; i < level.length; i++) {
      if (level[i] > 0 && depth[i] === 255) {
        demand += this.spec.draw(level[i]);
        unservedCells++;
        served[i] = 0;
      }
    }

    return {
      supply: this.supply, demand, servedCells, unservedCells,
      shortfall: demand > this.supply,
      isolatedSources: this.isolated,
    };
  }
}

/**
 * Two-phase flood: through the conductor network from every source, then out
 * UTILITY_REACH onto the land beside it.
 *
 * Every cell is enqueued exactly ONCE. A version that re-pushed cells on finding a
 * shorter depth could overrun the array it wrote into — typed-array writes past the end
 * vanish silently, the count kept climbing, and the accounting then read `undefined` and
 * produced a NaN demand.
 */
function flood(
  grid: Grid, tiles: Tiles, spec: UtilitySpec, queue: Int32Array, depth: Uint8Array,
): { count: number; supply: number; isolated: Array<{ x: number; y: number }> } {
  const { width, height } = grid;
  const { civic, civicAnchor } = tiles;
  const conductor = spec.conductor(tiles);
  const mask = width - 1;
  const limit = queue.length;
  depth.fill(255);

  let supply = 0;
  let tail = 0;
  const anchors: Array<{ i: number; size: number }> = [];

  // Source buildings seed the flood and conduct across their own footprint, so a line
  // touching any part of a plant connects to it.
  for (let i = 0; i < civic.length; i++) {
    const id = civic[i];
    if (!id) continue;
    const def = CIVIC_BY_ID.get(id);
    if (!def || spec.capacityOf(def) === 0) continue;
    if (civicAnchor[i]) { supply += spec.capacityOf(def); anchors.push({ i, size: def.size }); }
    if (depth[i] === 255 && tail < limit) { depth[i] = 0; queue[tail++] = i; }
  }

  const conducts = (j: number) => conductor[j] === 1 || isSource(tiles, spec, j);

  let head = 0;
  while (head < tail) {
    const i = queue[head++];
    const x = i & mask;
    const y = i >>> grid.shift;
    if (x > 0) { const j = i - 1; if (depth[j] === 255 && conducts(j)) { depth[j] = 0; queue[tail++] = j; } }
    if (x < width - 1) { const j = i + 1; if (depth[j] === 255 && conducts(j)) { depth[j] = 0; queue[tail++] = j; } }
    if (y > 0) { const j = i - width; if (depth[j] === 255 && conducts(j)) { depth[j] = 0; queue[tail++] = j; } }
    if (y < height - 1) { const j = i + width; if (depth[j] === 255 && conducts(j)) { depth[j] = 0; queue[tail++] = j; } }
  }

  head = 0;
  while (head < tail) {
    const i = queue[head++];
    const d = depth[i];
    if (d >= UTILITY_REACH) continue;
    const nd = d + 1;
    const x = i & mask;
    const y = i >>> grid.shift;
    if (x > 0) { const j = i - 1; if (depth[j] === 255) { depth[j] = nd; queue[tail++] = j; } }
    if (x < width - 1) { const j = i + 1; if (depth[j] === 255) { depth[j] = nd; queue[tail++] = j; } }
    if (y > 0) { const j = i - width; if (depth[j] === 255) { depth[j] = nd; queue[tail++] = j; } }
    if (y < height - 1) { const j = i + width; if (depth[j] === 255) { depth[j] = nd; queue[tail++] = j; } }
  }

  // A source with no conductor touching its footprint can only ever serve the ground
  // immediately around itself.
  const isolated: Array<{ x: number; y: number }> = [];
  for (const a of anchors) {
    const ax = a.i & mask;
    const ay = a.i >>> grid.shift;
    let attached = false;
    for (let y = ay - 1; y <= ay + a.size && !attached; y++) {
      for (let x = ax - 1; x <= ax + a.size && !attached; x++) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const inside = x >= ax && x < ax + a.size && y >= ay && y < ay + a.size;
        if (!inside && conductor[y * width + x] === 1) attached = true;
      }
    }
    if (!attached) isolated.push({ x: ax, y: ay });
  }

  return { count: tail, supply, isolated };
}

function isSource(tiles: Tiles, spec: UtilitySpec, i: number): boolean {
  const id = tiles.civic[i];
  if (!id) return false;
  const def = CIVIC_BY_ID.get(id);
  return !!def && spec.capacityOf(def) > 0;
}

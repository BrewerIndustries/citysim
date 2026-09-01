/**
 * Power distribution.
 *
 * Plants energise the road network; roads then supply everything within ROAD_REACH of
 * them — the same reach that governs road access, so a plot that can be reached by a
 * road can always be powered by one. Roads carrying power is a deliberate simplification
 * of separate power lines: it keeps the mechanic legible and removes a whole tool from
 * the slice without removing the constraint.
 *
 * Connectivity changes only when roads or civic buildings change; building levels change
 * constantly and do not affect it at all. So the flood is CACHED and only the supply
 * accounting runs each tick — re-flooding every tick cost 550ms at Tier 3 and was the
 * single largest expense in the whole simulation.
 */
import type { Grid } from './grid.ts';
import { Tiles, CIVIC_BY_ID } from './tiles.ts';
import { ROAD_REACH } from './roads.ts';

export interface PowerReport {
  supply: number;
  demand: number;
  litCells: number;
  unservedCells: number;
  brownout: boolean;
}

/** Megawatts drawn by a developed cell at a given level. */
export function powerDraw(level: number): number {
  return level * 3;
}

export class PowerGrid {
  readonly depth: Uint8Array;
  /** Connected cells in flood order, so a shortfall browns out the far end first. */
  readonly order: Int32Array;
  orderCount = 0;
  supply = 0;
  private stale = true;

  constructor(size: number) {
    this.depth = new Uint8Array(size);
    this.order = new Int32Array(size);
    this.depth.fill(255);
  }

  markDirty(): void { this.stale = true; }

  step(grid: Grid, tiles: Tiles): PowerReport {
    if (this.stale) {
      const r = flood(grid, tiles, this.order, this.depth);
      this.orderCount = r.count;
      this.supply = r.supply;
      this.stale = false;
    }
    return this.account(tiles);
  }

  /** Spend the supply in flood order and report the balance. */
  private account(tiles: Tiles): PowerReport {
    const { level, powered } = tiles;
    const { order, orderCount, depth } = this;
    let demand = 0;
    let litCells = 0;
    let remaining = this.supply;

    for (let q = 0; q < orderCount; q++) {
      const i = order[q];
      const lvl = level[i];
      if (lvl === 0) { powered[i] = 1; continue; }
      const draw = powerDraw(lvl);
      demand += draw;
      if (remaining >= draw) { remaining -= draw; powered[i] = 1; litCells++; }
      else powered[i] = 0;
    }

    // Anything the flood never reached still counts toward demand, so the player sees
    // the shortfall itself rather than only its symptoms.
    let unservedCells = 0;
    for (let i = 0; i < level.length; i++) {
      if (level[i] > 0 && depth[i] === 255) {
        demand += powerDraw(level[i]);
        unservedCells++;
        powered[i] = 0;
      }
    }

    return { supply: this.supply, demand, litCells, unservedCells, brownout: demand > this.supply };
  }
}

/**
 * Two-phase flood.
 *
 * Phase one spreads through the conducting network (roads and civic buildings) from
 * every plant. Phase two radiates ROAD_REACH cells outward from that network onto the
 * land beside it.
 *
 * Every cell is enqueued exactly ONCE. The first version re-pushed a cell whenever it
 * was reached at a shorter depth, so the queue could overrun the array it was written
 * into: writes past the end of a typed array vanish silently, the count kept climbing,
 * and the accounting pass then read `undefined` and produced a NaN power demand.
 * Visiting once is both correct and considerably faster.
 */
function flood(
  grid: Grid, tiles: Tiles, queue: Int32Array, depth: Uint8Array,
): { count: number; supply: number } {
  const { width, height } = grid;
  const { road, civic, civicAnchor } = tiles;
  const mask = width - 1;
  const limit = queue.length;
  depth.fill(255);

  let supply = 0;
  let tail = 0;

  // --- phase 1: the conducting network -------------------------------------
  for (let i = 0; i < civic.length; i++) {
    const id = civic[i];
    if (!id) continue;
    const def = CIVIC_BY_ID.get(id);
    if (!def?.supply) continue;
    if (civicAnchor[i]) supply += def.supply;
    if (depth[i] === 255 && tail < limit) { depth[i] = 0; queue[tail++] = i; }
  }

  let head = 0;
  while (head < tail) {
    const i = queue[head++];
    const x = i & mask;
    const y = i >>> grid.shift;
    if (x > 0) { const j = i - 1; if (depth[j] === 255 && (road[j] === 1 || civic[j] !== 0)) { depth[j] = 0; queue[tail++] = j; } }
    if (x < width - 1) { const j = i + 1; if (depth[j] === 255 && (road[j] === 1 || civic[j] !== 0)) { depth[j] = 0; queue[tail++] = j; } }
    if (y > 0) { const j = i - width; if (depth[j] === 255 && (road[j] === 1 || civic[j] !== 0)) { depth[j] = 0; queue[tail++] = j; } }
    if (y < height - 1) { const j = i + width; if (depth[j] === 255 && (road[j] === 1 || civic[j] !== 0)) { depth[j] = 0; queue[tail++] = j; } }
  }

  // --- phase 2: the land within reach of it --------------------------------
  head = 0;
  while (head < tail) {
    const i = queue[head++];
    const d = depth[i];
    if (d >= ROAD_REACH) continue;
    const nd = d + 1;
    const x = i & mask;
    const y = i >>> grid.shift;
    if (x > 0) { const j = i - 1; if (depth[j] === 255) { depth[j] = nd; queue[tail++] = j; } }
    if (x < width - 1) { const j = i + 1; if (depth[j] === 255) { depth[j] = nd; queue[tail++] = j; } }
    if (y > 0) { const j = i - width; if (depth[j] === 255) { depth[j] = nd; queue[tail++] = j; } }
    if (y < height - 1) { const j = i + width; if (depth[j] === 255) { depth[j] = nd; queue[tail++] = j; } }
  }

  return { count: tail, supply };
}

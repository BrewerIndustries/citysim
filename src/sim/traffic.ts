/**
 * Traffic: how much the roads are being asked to carry, and where that hurts.
 *
 * This is emphatically NOT pathfinding. Cities: Skylines computes a route per vehicle at
 * spawn time and spends its whole frame budget doing it (docs/DO-NOT-DO.md #4); once the
 * city is big enough, the simulation *is* the traffic solver. The question a city builder
 * actually needs answered is not "which way does this car go" but "is this corridor wide
 * enough for what fronts onto it", and that can be answered in two cheap passes.
 *
 *   1. ASSIGNMENT. Every developed cell generates trips and hands them to the nearest
 *      road cell with frontage — the road it would actually pull out onto. That alone
 *      captures the thing lanes are for: a street with six blocks of dense housing on it
 *      is carrying six blocks of housing.
 *
 *   2. RELAXATION. Load then spreads a few steps along the network, pulled towards
 *      neighbours with spare capacity. This is what makes a wider road *relieve* the
 *      streets around it instead of merely existing beside them, and it is why a motorway
 *      with no frontage of its own is still worth building. It is a diffusion, not a
 *      route: nothing is ever tracked from an origin to a destination.
 *
 * Congestion is then load over capacity, per tile, and that is the number everything
 * downstream reads.
 */
import type { Grid } from './grid.ts';
import type { Tiles } from './tiles.ts';
import { ZONE_RES, ZONE_COM, ZONE_IND } from './tiles.ts';
import { capacityOf, hasFrontage, levelsConnect, passesUnder } from './roads.ts';

/**
 * Trips generated per level-density step, by zone.
 *
 * Commerce generates most per unit of building — every customer is a trip, and they all
 * arrive at once — which is why a strip of shops on a two-lane street snarls long before
 * the housing behind it does.
 */
export const TRIPS_PER_STEP: Readonly<Record<number, number>> = {
  [ZONE_RES]: 1.0,
  [ZONE_COM]: 1.6,
  [ZONE_IND]: 1.3,
};

/**
 * How many spreading passes to run.
 *
 * Three is enough for a wide road to pull load from the streets feeding it without the
 * whole network averaging into one flat number, which is what happens if you relax to
 * convergence. Traffic is local; a motorway does not relieve a street thirty tiles away.
 */
export const RELAX_PASSES = 3;

/** Fraction of a tile's load that can move to its neighbours in one pass. */
export const RELAX_SHARE = 0.5;

/** Congestion at and above this is bad enough to be worth telling the player about. */
export const CONGESTED = 1.0;

export interface TrafficReport {
  /** Total trips the city generates per tick. */
  trips: number;
  /** Road tiles carrying more than they can. */
  congestedTiles: number;
  /** Road tiles in total, for the share. */
  roadTiles: number;
  /** The worst tile's load over capacity. */
  worst: number;
}

export const EMPTY_TRAFFIC: TrafficReport = {
  trips: 0, congestedTiles: 0, roadTiles: 0, worst: 0,
};

/** Trips one developed cell generates. Pure, so the manual can quote it. */
export function tripsAt(zone: number, level: number, density: number): number {
  if (level === 0) return 0;
  return (TRIPS_PER_STEP[zone] ?? 0) * level * (density + 1);
}

/**
 * Work out what every road tile is carrying, and how congested that makes it.
 *
 * `load` and `congestSrc` are scratch arrays owned by the caller so this allocates
 * nothing per tick. `congestSrc` is left holding each road tile's congestion scaled to
 * the shared 0-255 field range, ready to be diffused into the land around it.
 */
export function stepTraffic(
  grid: Grid,
  tiles: Tiles,
  load: Float32Array,
  next: Float32Array,
  congestSrc: Float32Array,
  nearestRoad: Int32Array,
  /** Indices of the road tiles, and how many are live. See `listRoads`. */
  roads: Int32Array,
  roadCount: number,
): TrafficReport {
  const { width, height, size } = grid;
  const { zone, level, density, road, roadClass, junction, roadLevel } = tiles;
  // Cleared and walked through the compacted list, not the grid: roads are a thin
  // skeleton over a mostly empty map, and scanning every cell three times a tick to find
  // them cost more than the whole rest of the pass.
  for (let k = 0; k < roadCount; k++) {
    load[roads[k]] = 0;
    congestSrc[roads[k]] = 0;
  }

  // --- 1. assignment -------------------------------------------------------
  let trips = 0;
  for (let i = 0; i < size; i++) {
    if (level[i] === 0) continue;
    const t = tripsAt(zone[i], level[i], density[i]);
    if (t === 0) continue;
    trips += t;
    const r = nearestRoad[i];
    if (r >= 0) load[r] += t;
  }

  // --- 2. relaxation -------------------------------------------------------
  // Each pass moves a share of every tile's load to its road neighbours, split in
  // proportion to their capacity. Capacity-weighted is the whole point: a motorway beside
  // an arterial takes most of what moves, which is what "relief" means.
  for (let pass = 0; pass < RELAX_PASSES; pass++) {
    for (let k = 0; k < roadCount; k++) next[roads[k]] = load[roads[k]];
    for (let k = 0; k < roadCount; k++) {
      const i = roads[k];
      if (load[i] === 0) continue;
      const x = i & (width - 1);
      const y = i >>> grid.shift;
      // Where a neighbour is a deck two or more levels up, traffic does not join it —
      // it carries on UNDERNEATH to the tile beyond, which is what an overpass is for.
      // Without this, every elevated crossing would sever the road it crossed.
      const mine = roadLevel[i];
      const step = (dir: number, limit: boolean): number => {
        if (!limit) return -1;
        const n = i + dir;
        if (!road[n]) return -1;
        if (levelsConnect(mine, roadLevel[n])) return n;
        if (!passesUnder(mine, roadLevel[n])) return -1;
        const beyond = n + dir;
        const inBounds = dir === -1 ? (n & (width - 1)) > 0
          : dir === 1 ? (n & (width - 1)) < width - 1
          : dir === -width ? n >= width
          : n < size - width;
        if (!inBounds || !road[beyond] || !levelsConnect(mine, roadLevel[beyond])) return -1;
        return beyond;
      };
      const n0 = step(-1, x > 0);
      const n1 = step(1, x < width - 1);
      const n2 = step(-width, y > 0);
      const n3 = step(width, y < height - 1);
      const c0 = n0 >= 0 ? capacityOf(roadClass[n0], junction[n0]) : 0;
      const c1 = n1 >= 0 ? capacityOf(roadClass[n1], junction[n1]) : 0;
      const c2 = n2 >= 0 ? capacityOf(roadClass[n2], junction[n2]) : 0;
      const c3 = n3 >= 0 ? capacityOf(roadClass[n3], junction[n3]) : 0;
      const total = c0 + c1 + c2 + c3;
      if (total === 0) continue;
      const moving = load[i] * RELAX_SHARE;
      next[i] -= moving;
      if (c0) next[n0] += moving * (c0 / total);
      if (c1) next[n1] += moving * (c1 / total);
      if (c2) next[n2] += moving * (c2 / total);
      if (c3) next[n3] += moving * (c3 / total);
    }
    for (let k = 0; k < roadCount; k++) load[roads[k]] = next[roads[k]];
  }

  // --- 3. congestion -------------------------------------------------------
  let congestedTiles = 0;
  const roadTiles = roadCount;
  let worst = 0;
  for (let k = 0; k < roadCount; k++) {
    const i = roads[k];
    const cap = capacityOf(roadClass[i], junction[i]);
    if (cap === 0) continue;
    const ratio = load[i] / cap;
    if (ratio > worst) worst = ratio;
    if (ratio >= CONGESTED) congestedTiles++;
    // Scaled so a road at exactly capacity reads mid-range and a badly overloaded one
    // saturates, rather than everything pinning at 255 the moment a street is busy.
    congestSrc[i] = Math.min(255, ratio * 110);
  }

  return { trips, congestedTiles, roadTiles, worst };
}

/**
 * Compact the road tiles into a list. Rebuilt only when the network changes, which is
 * what makes the per-tick passes proportional to the roads rather than to the map.
 */
export function listRoads(grid: Grid, tiles: Tiles, out: Int32Array): number {
  const road = tiles.road;
  let n = 0;
  for (let i = 0; i < grid.size; i++) if (road[i]) out[n++] = i;
  return n;
}

/**
 * For every cell, the road tile it would pull out onto.
 *
 * Computed by the same BFS that produces roadDist — it is the parent pointer that search
 * already has and throws away — so assignment costs nothing extra. Motorways are excluded
 * because nothing fronts onto one.
 */
export function recomputeNearestRoad(grid: Grid, tiles: Tiles, nearest: Int32Array, queue: Int32Array): void {
  const { width, height, size } = grid;
  const { road, roadClass, roadLevel, roadDist } = tiles;
  nearest.fill(-1);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < size; i++) {
    if (road[i] && hasFrontage(roadClass[i]) && roadLevel[i] === 0) {
      nearest[i] = i;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++];
    if (roadDist[i] >= 255) continue;
    const x = i & (width - 1);
    const y = i >>> grid.shift;
    const push = (j: number) => {
      if (nearest[j] === -1 && roadDist[j] <= roadDist[i] + 1 && roadDist[j] < 255) {
        nearest[j] = nearest[i];
        queue[tail++] = j;
      }
    };
    if (x > 0) push(i - 1);
    if (x < width - 1) push(i + 1);
    if (y > 0) push(i - width);
    if (y < height - 1) push(i + width);
  }
}

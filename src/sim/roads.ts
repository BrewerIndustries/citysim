/**
 * Road network: a multi-source BFS from every road cell producing a distance field.
 *
 * Road access is the single hardest requirement in the game — nothing develops without
 * it — so it needs to be a NUMBER the Why Panel can quote ("nearest road 6 cells away,
 * needs 3"), not a boolean buried in a loop.
 *
 * Only recomputed when roads change, not every tick.
 */
import type { Grid } from './grid.ts';
import { throughputOf } from './junctions.ts';
import type { Tiles } from './tiles.ts';

/** A cell must be within this many cells of a road to develop. */
export const ROAD_REACH = 3;

/**
 * Road classes, narrowest first.
 *
 * A road is not just a road: a two-lane street and an eight-lane motorway do completely
 * different jobs, and the interesting decision is which one a given corridor needs. Cost
 * and upkeep rise faster than capacity does, so paving everything wide is a way to go
 * bankrupt rather than a way to win.
 *
 * `frontage` is the rule that makes the top of the ladder a real choice rather than a
 * strictly better street. A motorway carries enormous traffic and **nothing can be built
 * off it** — no property fronts onto a motorway. It has to be fed by arterials, which is
 * exactly the planning problem real cities have.
 */
export interface RoadClass {
  id: number;
  key: string;
  label: string;
  lanes: number;
  /** Per tile. */
  cost: number;
  /** Per tile per month. */
  upkeep: number;
  /** Trips per tick this tile can carry before it congests. */
  capacity: number;
  /** Whether buildings may take access from it. False for motorways. */
  frontage: boolean;
  colour: string;
  note: string;
}

export const ROAD_CLASSES: readonly RoadClass[] = [
  { id: 1, key: 'street', label: 'Street', lanes: 2, cost: 10, upkeep: 0.4, capacity: 45,
    frontage: true, colour: '#42464e',
    note: 'Two lanes. What a neighbourhood is made of' },
  { id: 2, key: 'avenue', label: 'Avenue', lanes: 4, cost: 28, upkeep: 1.1, capacity: 130,
    frontage: true, colour: '#585d68',
    note: 'Four lanes. For a street that has outgrown itself' },
  { id: 3, key: 'arterial', label: 'Arterial', lanes: 6, cost: 58, upkeep: 2.4, capacity: 300,
    frontage: true, colour: '#6e7482',
    note: 'Six lanes. Carries a district, and still has frontage' },
  { id: 4, key: 'motorway', label: 'Motorway', lanes: 8, cost: 125, upkeep: 5.0, capacity: 760,
    frontage: false, colour: '#8a91a2',
    note: 'Eight lanes, and NO frontage — nothing can be built off it' },
];

/**
 * How high a road sits.
 *
 * A tile holds one road, so two carriageways can never share a cell — but they can pass
 * one ANOTHER, and that is what levels are for. Roads only join a neighbour within one
 * level of themselves, so an elevated deck runs over a street without merging into it,
 * and a ground road carries straight on underneath a deck two levels up (see
 * `passesUnder`). Level 1 is the ramp height that gets you between the two.
 *
 * Nothing fronts onto a raised road: you cannot put a driveway on a flyover, so only
 * ground-level roads grant access to the land beside them.
 */
export const ROAD_LEVELS: ReadonlyArray<{
  level: number; label: string; costMul: number; note: string;
}> = [
  { level: 0, label: 'Ground', costMul: 1, note: 'On the ground, and the only height that gives frontage' },
  { level: 1, label: 'Ramp', costMul: 2.2, note: 'The height you climb through to get up or down' },
  { level: 2, label: 'Elevated', costMul: 3.8, note: 'Clears a ground road running underneath' },
  { level: 3, label: 'High', costMul: 5.4, note: 'Over an elevated road as well' },
];

export const MAX_ROAD_LEVEL = ROAD_LEVELS.length - 1;

/** Two adjacent road tiles are the same road only if they are within a level of each other. */
export function levelsConnect(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1;
}

/**
 * Whether a road at `below` passes underneath one at `above` rather than joining it.
 *
 * Two levels of clearance is a bridge over a road; one is a ramp meeting it. This is what
 * lets a street carry straight on through the cell an elevated carriageway occupies —
 * without it, an overpass would sever every road it crossed, which is the opposite of
 * what an overpass is for.
 */
export function passesUnder(below: number, above: number): boolean {
  return above - below >= 2;
}

/** What a tile of this class at this height costs to build. */
export function roadCost(cls: number, level: number): number {
  const c = ROAD_CLASS_BY_ID.get(cls);
  return c ? c.cost * (ROAD_LEVELS[level]?.costMul ?? 1) : 0;
}

/** And to keep. Height costs to maintain as well as to build. */
export function roadUpkeep(cls: number, level: number): number {
  const c = ROAD_CLASS_BY_ID.get(cls);
  return c ? c.upkeep * (ROAD_LEVELS[level]?.costMul ?? 1) : 0;
}

export const ROAD_CLASS_BY_ID = new Map(ROAD_CLASSES.map((c) => [c.id, c]));
export const ROAD_CLASS_BY_KEY = new Map(ROAD_CLASSES.map((c) => [c.key, c]));
export const DEFAULT_ROAD_CLASS = 1;

/**
 * Capacity of whatever is on this tile, or 0 if there is no road.
 *
 * A junction multiplies it, because a junction is worth more than the tiles it is made
 * of — which is the entire reason to build one rather than let two roads cross.
 */
export function capacityOf(cls: number, junction = 0): number {
  return (CAPACITY[cls] ?? 0) * throughputOf(junction);
}

/** Capacity by class id, flat for the same reason THROUGHPUT is. Index 0 is no road. */
const CAPACITY: number[] = (() => {
  const out = new Array<number>(Math.max(0, ...ROAD_CLASSES.map((c) => c.id)) + 1).fill(0);
  for (const c of ROAD_CLASSES) out[c.id] = c.capacity;
  return out;
})();

/** Frontage by class id, flat. Called once per cell by the road-distance search. */
const FRONTAGE: boolean[] = (() => {
  const out = new Array<boolean>(Math.max(0, ...ROAD_CLASSES.map((c) => c.id)) + 1).fill(false);
  for (const c of ROAD_CLASSES) out[c.id] = c.frontage;
  return out;
})();

/** Whether buildings may take access from the road on this tile. */
export function hasFrontage(cls: number): boolean {
  return FRONTAGE[cls] ?? false;
}

export function recomputeRoadDistance(grid: Grid, tiles: Tiles, queue: Int32Array): void {
  const { width, height } = grid;
  const dist = tiles.roadDist;
  const road = tiles.road;
  dist.fill(255);

  // Motorways are seeded at distance 0 so they are still *on* the network, but they are
  // never a source of frontage, so they do not start the search. A house next to a
  // motorway is not a house with road access; it is a house with a noise problem.
  const cls = tiles.roadClass;
  const lvl = tiles.roadLevel;
  let head = 0;
  let tail = 0;
  for (let i = 0; i < road.length; i++) {
    // Ground level only: nothing fronts onto a flyover.
    if (road[i] && hasFrontage(cls[i]) && lvl[i] === 0) {
      dist[i] = 0;
      queue[tail++] = i;
    }
  }

  while (head < tail) {
    const i = queue[head++];
    const d = dist[i];
    if (d >= ROAD_REACH) continue;
    const x = i & (width - 1);
    const y = i >>> grid.shift;
    if (x > 0 && dist[i - 1] > d + 1) { dist[i - 1] = d + 1; queue[tail++] = i - 1; }
    if (x < width - 1 && dist[i + 1] > d + 1) { dist[i + 1] = d + 1; queue[tail++] = i + 1; }
    if (y > 0 && dist[i - width] > d + 1) { dist[i - width] = d + 1; queue[tail++] = i - width; }
    if (y < height - 1 && dist[i + width] > d + 1) { dist[i + width] = d + 1; queue[tail++] = i + width; }
  }
}

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

export const ROAD_CLASS_BY_ID = new Map(ROAD_CLASSES.map((c) => [c.id, c]));
export const ROAD_CLASS_BY_KEY = new Map(ROAD_CLASSES.map((c) => [c.key, c]));
export const DEFAULT_ROAD_CLASS = 1;

/** Capacity of whatever is on this tile, or 0 if there is no road. */
export function capacityOf(cls: number): number {
  return ROAD_CLASS_BY_ID.get(cls)?.capacity ?? 0;
}

/** Whether buildings may take access from the road on this tile. */
export function hasFrontage(cls: number): boolean {
  return ROAD_CLASS_BY_ID.get(cls)?.frontage ?? false;
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
  let head = 0;
  let tail = 0;
  for (let i = 0; i < road.length; i++) {
    if (road[i] && hasFrontage(cls[i])) {
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

/**
 * Power distribution.
 *
 * Plants energise the road network; roads then supply everything within ROAD_REACH of
 * them — the same reach that governs road access, so a plot that can be reached by a
 * road can always be powered by one. (An earlier version only powered cells directly
 * adjacent to a road, which silently made two thirds of every zoned block undevelopable.)
 *
 * Roads carrying power is a deliberate simplification of separate power lines: it keeps
 * the mechanic legible and removes a whole tool from the S0 slice without removing the
 * constraint.
 *
 * When demand exceeds supply the BFS order decides who goes dark, so cells nearest a
 * plant stay lit. Deterministic, and explainable as "you are at the end of the grid".
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

export function distributePower(
  grid: Grid, tiles: Tiles, queue: Int32Array, depth: Uint8Array,
): PowerReport {
  const { width, height } = grid;
  const { road, civic, level, powered, civicAnchor } = tiles;
  powered.fill(0);
  depth.fill(255);

  let supply = 0;
  let head = 0;
  let tail = 0;

  for (let i = 0; i < civic.length; i++) {
    const id = civic[i];
    if (!id) continue;
    const def = CIVIC_BY_ID.get(id);
    if (!def?.supply) continue;
    if (civicAnchor[i]) supply += def.supply;
    if (depth[i] === 255) { depth[i] = 0; queue[tail++] = i; }
  }

  // Flood the grid: conducting cells (roads, civics) spread at depth 0 without limit,
  // then power radiates ROAD_REACH cells further into the land beside them.
  while (head < tail) {
    const i = queue[head++];
    const d = depth[i];
    const conducts = road[i] === 1 || civic[i] !== 0;
    const nextDepth = conducts ? 0 : d + 1;
    if (!conducts && d >= ROAD_REACH) continue;

    const x = i & (width - 1);
    const y = i >>> grid.shift;
    const push = (j: number) => {
      const nd = (road[j] === 1 || civic[j] !== 0) ? 0 : nextDepth + (conducts ? 1 : 0);
      if (nd <= ROAD_REACH && depth[j] > nd) { depth[j] = nd; queue[tail++] = j; }
    };
    if (x > 0) push(i - 1);
    if (x < width - 1) push(i + 1);
    if (y > 0) push(i - width);
    if (y < height - 1) push(i + width);
  }

  // Spend the supply in BFS order.
  let demand = 0;
  let litCells = 0;
  let unservedCells = 0;
  let remaining = supply;
  for (let q = 0; q < tail; q++) {
    const i = queue[q];
    if (powered[i]) continue;
    if (level[i] > 0) {
      const draw = powerDraw(level[i]);
      demand += draw;
      if (remaining >= draw) { remaining -= draw; powered[i] = 1; litCells++; }
    } else {
      powered[i] = 1; // empty lots and infrastructure cost nothing to energise
    }
  }

  // Anything the flood never reached still counts toward demand, so the player sees the
  // shortfall itself rather than only its symptoms.
  for (let i = 0; i < level.length; i++) {
    if (level[i] > 0 && depth[i] === 255) { demand += powerDraw(level[i]); unservedCells++; }
  }

  return { supply, demand, litCells, unservedCells, brownout: demand > supply };
}

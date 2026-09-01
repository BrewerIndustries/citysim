/**
 * Development and abandonment — how zoned land turns into a city.
 *
 * The key design decision: every cell stores WHY it is or isn't developing, as a reason
 * code written during the same pass that decides growth. The Why Panel reads that code
 * rather than re-deriving it in the UI, so the explanation can never drift from the
 * behaviour. This is the whole thesis of the project in one array.
 */
import type { Grid } from './grid.ts';
import type { Fields } from './fields.ts';
import { Tiles, ZONE_RES, ZONE_COM, ZONE_IND, MAX_LEVEL } from './tiles.ts';
import { ROAD_REACH } from './roads.ts';
import type { Demand } from './demand.ts';
import type { ChangeLog } from './dirty.ts';

export const REASON = {
  GROWING: 0,
  NO_ROAD: 1,
  NO_POWER: 2,
  NO_DEMAND: 3,
  LOW_DESIRABILITY: 4,
  AT_CAPACITY: 5,
  ABANDONING: 6,
  UNZONED: 7,
} as const;

export const REASON_TEXT: Record<number, string> = {
  0: 'developing',
  1: 'no road access',
  2: 'no power',
  3: 'no demand for this zone',
  4: 'desirability too low to densify',
  5: 'built out for this density',
  6: 'in decline',
  7: 'not zoned',
};

/**
 * Desirability needed to grow from `level` to `level + 1`.
 *
 * The floor of 6 exists to create HYSTERESIS against DECLINE_BELOW. The first version
 * let level 1 grow at desirability >= 0 while decline began below 4, so every cell in
 * that band grew and decayed forever — population oscillated by 20% with a quarter of
 * the city permanently "in decline". Growth and decline thresholds must never overlap.
 */
export function requiredDesirability(level: number): number {
  return 6 + level * 10;
}

/** Distress accumulated before a building loses a level. */
export const DISTRESS_LIMIT = 40;
/** Below this desirability a developed cell starts to decline. Must be < the growth floor. */
export const DECLINE_BELOW = 3;

export interface GrowthStats {
  population: number;
  jobsC: number;
  jobsI: number;
  developedCells: number;
  zonedCells: number;
  abandonedThisTick: number;
  grewThisTick: number;
}

export function residentsAt(level: number, density: number): number {
  return level * (density + 1) * 6;
}
export function jobsAt(level: number, density: number, zone: number): number {
  return level * (density + 1) * (zone === ZONE_IND ? 5 : 4);
}

/**
 * Count what exists without changing anything.
 *
 * stepGrowth() tallies as it goes, so a freshly loaded city reported a population of
 * zero until its first simulated tick. Loading must not make the city look empty.
 */
export function tallyCity(tiles: Tiles): GrowthStats {
  const { zone, density, level, civic } = tiles;
  let population = 0;
  let jobsC = 0;
  let jobsI = 0;
  let developedCells = 0;
  let zonedCells = 0;
  for (let i = 0; i < zone.length; i++) {
    const z = zone[i];
    if (z === 0 || civic[i] !== 0) continue;
    zonedCells++;
    const lvl = level[i];
    if (lvl === 0) continue;
    developedCells++;
    if (z === ZONE_RES) population += residentsAt(lvl, density[i]);
    else if (z === ZONE_COM) jobsC += jobsAt(lvl, density[i], z);
    else jobsI += jobsAt(lvl, density[i], z);
  }
  return { population, jobsC, jobsI, developedCells, zonedCells, abandonedThisTick: 0, grewThisTick: 0 };
}

/**
 * One growth pass over the whole grid.
 *
 * Reasons are evaluated for every zoned cell (cheap arithmetic, no RNG) but growth is
 * only APPLIED to a deterministic pseudo-random subset each tick, so cities fill in
 * organically instead of snapping to their final shape in one step.
 */
export function stepGrowth(
  grid: Grid, tiles: Tiles, fields: Fields, demand: Demand, tick: number, reason: Uint8Array,
  changes: ChangeLog,
): GrowthStats {
  const { zone, density, level, roadDist, powered, distress, civic } = tiles;
  const dR = fields.get('desirabilityR');
  const dC = fields.get('desirabilityC');
  const dI = fields.get('desirabilityI');

  let population = 0;
  let jobsC = 0;
  let jobsI = 0;
  let developedCells = 0;
  let zonedCells = 0;
  let abandonedThisTick = 0;
  let grewThisTick = 0;

  const n = zone.length;
  for (let i = 0; i < n; i++) {
    const z = zone[i];
    if (z === 0 || civic[i] !== 0) {
      reason[i] = REASON.UNZONED;
      continue;
    }
    zonedCells++;

    const lvl = level[i];
    const den = density[i];
    const max = MAX_LEVEL[den];

    // Tally what already exists.
    if (lvl > 0) {
      developedCells++;
      if (z === ZONE_RES) population += residentsAt(lvl, den);
      else if (z === ZONE_COM) jobsC += jobsAt(lvl, den, z);
      else jobsI += jobsAt(lvl, den, z);
    }

    const des = z === ZONE_RES ? dR[i] : z === ZONE_COM ? dC[i] : dI[i];
    const wants = z === ZONE_RES ? demand.r : z === ZONE_COM ? demand.c : demand.i;
    const hasRoad = roadDist[i] <= ROAD_REACH;
    const hasPower = powered[i] === 1;

    // --- decline ---------------------------------------------------------------
    if (lvl > 0 && (!hasRoad || !hasPower || des < DECLINE_BELOW)) {
      const d = distress[i] + (!hasRoad || !hasPower ? 3 : 1);
      if (d >= DISTRESS_LIMIT) {
        level[i] = lvl - 1;
        distress[i] = 0;
        abandonedThisTick++;
        changes.addAt(i, i & (grid.width - 1), i >>> grid.shift);
      } else {
        distress[i] = d;
      }
      reason[i] = !hasRoad ? REASON.NO_ROAD : !hasPower ? REASON.NO_POWER : REASON.ABANDONING;
      continue;
    }
    if (distress[i] > 0) distress[i]--;

    // --- growth ----------------------------------------------------------------
    if (!hasRoad) { reason[i] = REASON.NO_ROAD; continue; }
    if (!hasPower) { reason[i] = REASON.NO_POWER; continue; }
    if (lvl >= max) { reason[i] = REASON.AT_CAPACITY; continue; }
    if (wants <= 0.02) { reason[i] = REASON.NO_DEMAND; continue; }
    if (des < requiredDesirability(lvl)) { reason[i] = REASON.LOW_DESIRABILITY; continue; }

    reason[i] = REASON.GROWING;

    // Deterministic per-cell gate: hashing (index, tick) keeps the sim reproducible
    // without burning 260k RNG draws a tick or coupling cells to each other's order.
    const gate = hash32(i ^ Math.imul(tick, 0x9e3779b1)) / 4294967296;
    if (gate < 0.02 + wants * 0.05) {
      level[i] = lvl + 1;
      grewThisTick++;
      changes.addAt(i, i & (grid.width - 1), i >>> grid.shift);
      if (z === ZONE_RES) population += residentsAt(lvl + 1, den) - residentsAt(lvl, den);
      else if (z === ZONE_COM) jobsC += jobsAt(lvl + 1, den, z) - jobsAt(lvl, den, z);
      else jobsI += jobsAt(lvl + 1, den, z) - jobsAt(lvl, den, z);
    }
  }

  return { population, jobsC, jobsI, developedCells, zonedCells, abandonedThisTick, grewThisTick };
}

function hash32(x: number): number {
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

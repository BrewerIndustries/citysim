/**
 * Refuse: what the city throws away, and where it goes.
 *
 * Trash is deliberately NOT a fourth network. Power, water and sewage each need a
 * physical run of something from a source to your door, and a fourth set of lines to
 * draw would be tedium rather than a decision. Collection is by truck on the roads you
 * have already built, so what the city needs is not a network but somewhere to put it —
 * and the decision the player actually makes is *where*, because nobody wants to live
 * next to the tip.
 *
 * That gives two live constraints:
 *   - Citywide, disposal capacity must keep up with what the city produces, or refuse
 *     piles up in the streets: pollution on the developed cells themselves, and no
 *     further growth until it is dealt with.
 *   - Locally, the places that deal with it are unpleasant, so their siting matters.
 *
 * Recycling is the optional layer on top. It is never required, and it never unblocks
 * anything on its own — what it does is cut the waste stream at source so less disposal
 * is needed, cut the pollution that comes with it, and make its own neighbourhood
 * slightly more desirable rather than less. It is the one waste building you can put
 * near housing.
 */
import { ZONE_RES, ZONE_COM, ZONE_IND } from './tiles.ts';
import { FIELD_MAX } from './fields.ts';

/**
 * Waste produced per level-density step, by zone.
 *
 * Industry throws away far more than housing does, which is what makes an industrial
 * city expensive to keep clean and gives the recycling centre somewhere useful to go.
 */
export const WASTE_PER_STEP: Readonly<Record<number, number>> = {
  [ZONE_RES]: 1.0,
  [ZONE_COM]: 1.4,
  [ZONE_IND]: 2.6,
};

/**
 * The most a fully-covered cell's waste can be cut by recycling. Not 100%: recycling
 * diverts a stream, it does not abolish it, and a city that could recycle its way out
 * of ever building a tip would make the siting decision disappear.
 */
export const RECYCLE_MAX_CUT = 0.45;

/**
 * Extra emission per level-density step when refuse is going uncollected. Uncollected
 * rubbish is a nuisance in the street rather than an industrial process, so this sits
 * near the septic leak (0.5) rather than near heavy industry (3.2).
 */
export const OVERFLOW_EMISSION = 0.7;

/**
 * Refuse a city can absorb with no disposal at all.
 *
 * A hamlet's rubbish goes in the corner of a field and nobody minds. Without this a
 * brand-new city overflows on its first house, which would make the very first thing
 * you ever build a landfill — a bad opening move and a worse first lesson. It is the
 * same shape as septic tanks in the sewage model: small settlements manage informally,
 * and the service becomes real once you are a real town.
 */
export const FREE_DISPOSAL = 240;

/**
 * What one developed cell throws away, after recycling.
 *
 * Pure and exported because the manual quotes it and the Why Panel explains it — a
 * figure written out in prose beside a formula goes wrong the first time the formula is
 * tuned (docs/SIMULATION-MODEL.md rule 4).
 */
export function wasteAt(zone: number, level: number, density: number, recycleCover: number): number {
  if (level === 0) return 0;
  const raw = (WASTE_PER_STEP[zone] ?? 0) * level * (density + 1);
  return raw * (1 - recycleFraction(recycleCover));
}

/** How much of a cell's waste stream recycling diverts, from its coverage there. */
export function recycleFraction(recycleCover: number): number {
  const t = Math.max(0, Math.min(1, recycleCover / FIELD_MAX));
  return t * RECYCLE_MAX_CUT;
}

/** Whether a city with this much production and capacity is overflowing. */
export function isOverflowing(produced: number, capacity: number): boolean {
  return produced > capacity + FREE_DISPOSAL;
}

export interface WasteReport {
  /** What the city produces per tick, after recycling. */
  produced: number;
  /** What its landfills, incinerators and recycling plants can take. */
  capacity: number;
  /** True when production has outrun capacity and refuse is piling up. */
  overflow: boolean;
  /** How much of the stream is being recycled rather than buried or burned. */
  recycled: number;
  /** Disposal buildings with no power, which take nothing. */
  unpoweredSites: string[];
}

export const EMPTY_WASTE: WasteReport = {
  produced: 0, capacity: 0, overflow: false, recycled: 0, unpoweredSites: [],
};

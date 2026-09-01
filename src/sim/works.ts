/**
 * World works: the one-per-city buildings a mature city earns.
 *
 * These exist to give a large city decisions that a large city can only make once.
 * Ordinary buildings are quantitative — another school covers more ground — so the late
 * game becomes arithmetic. A world work is qualitative: you get one, the alternative is
 * closed off forever, and the city you end up with is different from the one you would
 * have had. That is what makes a hundred-thousand-resident city feel like a place with
 * a history rather than a bigger version of a town.
 *
 * Three rules make them work:
 *   - One per city. Never two, never a second for more of the bonus.
 *   - Most come in BRANCHES of two. Building one permanently locks its sibling — not
 *     until you demolish it, permanently, because a choice you can walk back is not a
 *     choice. Bulldozing yours does not give the other one back.
 *   - Every bonus is citywide and named. A wonder whose effect you cannot see is
 *     indistinguishable from an expensive statue.
 */
import { CIVIC_DEFS, CIVIC_BY_ID, type CivicDef } from './tiles.ts';

/**
 * What a world work does to the city as a whole.
 *
 * Deliberately a small closed set rather than arbitrary callbacks: each field below is
 * applied at exactly ONE place in the simulation, which is what makes the effects
 * testable and keeps a wonder from quietly becoming a special case scattered through
 * the codebase. Multipliers default to 1, flat bonuses to 0.
 */
export interface WorksBonus {
  /** Multiplier on every tax the city collects. */
  taxYield?: number;
  /** Flat addition to land value on every tile, before clamping. */
  landValue?: number;
  /** Multiplier on the emission every developed cell writes. */
  emission?: number;
  /** Multiplier on the crime every developed cell generates. */
  crime?: number;
  /** Multipliers on commercial and industrial demand. */
  demandC?: number;
  demandI?: number;
  /** Extra refuse the city can dispose of, on top of its disposal buildings. */
  waste?: number;
}

/** The aggregate of every world work standing, as the simulation reads it. */
export interface WorksEffects {
  taxYield: number;
  landValue: number;
  emission: number;
  crime: number;
  demandC: number;
  demandI: number;
  waste: number;
}

export const NO_EFFECTS: WorksEffects = {
  taxYield: 1, landValue: 0, emission: 1, crime: 1, demandC: 1, demandI: 1, waste: 0,
};

/** Every world work, in the order they become available. */
export const WORLD_WORKS: CivicDef[] = CIVIC_DEFS.filter((d) => d.works);

export const WORKS_IDS: ReadonlySet<number> = new Set(WORLD_WORKS.map((d) => d.id));

/**
 * "the Grand Park", but "The Monument" — some works carry their article in the name.
 * Without this the generated achievements read "Build the The Monument".
 */
export function theName(label: string): string {
  return /^The /.test(label) ? label : `the ${label}`;
}

/** The alternative you give up by building this one, if it has one. */
export function siblingOf(def: CivicDef): CivicDef | null {
  if (!def.works?.branch) return null;
  return WORLD_WORKS.find((d) => d.id !== def.id && d.works?.branch === def.works!.branch) ?? null;
}

/**
 * Combine the standing works into one set of numbers.
 *
 * Multipliers compose by multiplication and flats by addition, so two works that both
 * cut pollution genuinely stack — but since no two works in a branch can both be built,
 * the number of ways to stack is bounded by design rather than by a cap bolted on here.
 */
export function effectsOf(builtIds: Iterable<number>): WorksEffects {
  const e: WorksEffects = { ...NO_EFFECTS };
  for (const id of builtIds) {
    const bonus = CIVIC_BY_ID.get(id)?.works?.bonus;
    if (!bonus) continue;
    if (bonus.taxYield !== undefined) e.taxYield *= bonus.taxYield;
    if (bonus.emission !== undefined) e.emission *= bonus.emission;
    if (bonus.crime !== undefined) e.crime *= bonus.crime;
    if (bonus.demandC !== undefined) e.demandC *= bonus.demandC;
    if (bonus.demandI !== undefined) e.demandI *= bonus.demandI;
    if (bonus.landValue !== undefined) e.landValue += bonus.landValue;
    if (bonus.waste !== undefined) e.waste += bonus.waste;
  }
  return e;
}

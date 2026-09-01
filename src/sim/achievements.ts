/**
 * Achievements.
 *
 * Each one is a predicate over city state, evaluated once a month. They are goals as
 * much as rewards, so locked ones show their description rather than hiding it — an
 * achievement you can't see isn't something you can aim at.
 *
 * Ids are stable strings, and the save stores ids rather than bit positions, so
 * reordering or inserting achievements later can never silently re-award or revoke one.
 */
import type { City } from './city.ts';
import { CIVIC_BY_KEY } from './tiles.ts';
import { FIELD_MAX } from './fields.ts';

export interface Achievement {
  id: string;
  name: string;
  description: string;
  /** Grouping for the list. */
  group: 'Growth' | 'Economy' | 'Infrastructure' | 'Environment' | 'Adversity';
  /** True once earned. Evaluated monthly; never un-earned. */
  test: (c: City, s: Snapshot) => boolean;
}

/** Cheap derived figures, computed once per evaluation rather than per achievement. */
export interface Snapshot {
  population: number;
  jobs: number;
  cleanShare: number;
  avgLandValue: number;
  avgPollution: number;
  poweredShare: number;
  builtKeys: Set<string>;
  consecutiveSurplusMonths: number;
}

const has = (c: City, key: string) => c.everBuilt.has(CIVIC_BY_KEY.get(key)?.id ?? -1);

export const ACHIEVEMENTS: Achievement[] = [
  // --- growth ---------------------------------------------------------------
  { id: 'pop-1k', name: 'Small town', description: 'Reach 1,000 residents.', group: 'Growth',
    test: (_c, s) => s.population >= 1_000 },
  { id: 'pop-10k', name: 'Proper city', description: 'Reach 10,000 residents.', group: 'Growth',
    test: (_c, s) => s.population >= 10_000 },
  { id: 'pop-50k', name: 'Metropolis', description: 'Reach 50,000 residents.', group: 'Growth',
    test: (_c, s) => s.population >= 50_000 },
  { id: 'pop-250k', name: 'Capital', description: 'Reach 250,000 residents.', group: 'Growth',
    test: (_c, s) => s.population >= 250_000 },
  { id: 'skyscraper', name: 'Topping out', description: 'Grow a building to its highest level.', group: 'Growth',
    // A plain loop, not Math.max(...levels): spreading a typed array passes one argument
    // per cell, which blows the call stack the moment the map is bigger than a test's.
    test: (c) => { const l = c.tiles.level; for (let i = 0; i < l.length; i++) if (l[i] >= 6) return true; return false; } },
  { id: 'jobs-balance', name: 'Full employment', description: 'Support 10,000 residents with at least 5,000 jobs.', group: 'Growth',
    test: (_c, s) => s.population >= 10_000 && s.jobs >= 5_000 },

  // --- economy --------------------------------------------------------------
  { id: 'millionaire', name: 'In the black', description: 'Hold $1,000,000 in the treasury.', group: 'Economy',
    test: (c) => c.funds >= 1_000_000 },
  { id: 'surplus-5y', name: 'Prudent', description: 'Run a monthly surplus for five years straight.', group: 'Economy',
    test: (_c, s) => s.consecutiveSurplusMonths >= 60 },
  { id: 'low-tax', name: 'Light touch', description: 'Support 10,000 residents with every tax at 6% or less.', group: 'Economy',
    test: (c, s) => s.population >= 10_000 && c.tax.r <= 6 && c.tax.c <= 6 && c.tax.i <= 6 },
  { id: 'recovered', name: 'Back from the brink', description: 'Return to the black after going bankrupt.', group: 'Economy',
    test: (c) => c.wasBankrupt && c.funds > 0 },

  // --- infrastructure -------------------------------------------------------
  { id: 'transit', name: 'Mind the gap', description: 'Build a metro station.', group: 'Infrastructure',
    test: (c) => has(c, 'metro') },
  { id: 'rail', name: 'Grand terminus', description: 'Build a rail terminal.', group: 'Infrastructure',
    test: (c) => has(c, 'rail') },
  { id: 'university', name: 'Seat of learning', description: 'Build a university.', group: 'Infrastructure',
    test: (c) => has(c, 'university') },
  { id: 'all-services', name: 'Civic minded', description: 'Build a police HQ, a fire HQ and a university.', group: 'Infrastructure',
    test: (c) => has(c, 'policehq') && has(c, 'firehq') && has(c, 'university') },
  { id: 'fully-powered', name: 'Lights on', description: 'Power every building in a city of 20,000.', group: 'Infrastructure',
    test: (_c, s) => s.population >= 20_000 && s.poweredShare >= 0.999 },

  // --- environment ----------------------------------------------------------
  { id: 'wind', name: 'First breath', description: 'Build a wind turbine.', group: 'Environment',
    test: (c) => has(c, 'wind') },
  { id: 'clean-power', name: 'Off the coal', description: 'Supply a city of 10,000 entirely from clean power.', group: 'Environment',
    test: (_c, s) => s.population >= 10_000 && s.cleanShare >= 0.999 },
  { id: 'nuclear', name: 'Going critical', description: 'Build a nuclear plant.', group: 'Environment',
    test: (c) => has(c, 'nuclear') },
  { id: 'fusion', name: 'The last plant', description: 'Build a fusion plant.', group: 'Environment',
    test: (c) => has(c, 'fusion') },
  { id: 'garden-city', name: 'Garden city', description: 'Average land value above 120 with 20,000 residents.', group: 'Environment',
    test: (_c, s) => s.population >= 20_000 && s.avgLandValue >= 120 },
  { id: 'clean-air', name: 'Clean air', description: 'Keep average pollution under 20 with 25,000 residents.', group: 'Environment',
    test: (_c, s) => s.population >= 25_000 && s.avgPollution < 20 },

  // --- adversity ------------------------------------------------------------
  { id: 'survivor', name: 'Weathered it', description: 'Survive ten disasters.', group: 'Adversity',
    test: (c) => totalDisasters(c) >= 10 },
  { id: 'rebuilt', name: 'Rebuilt', description: 'Lose 200 buildings to disaster and still reach 20,000 residents.', group: 'Adversity',
    test: (c, s) => c.tilesLostToDisaster >= 200 && s.population >= 20_000 },
  { id: 'unshakeable', name: 'Unshakeable', description: 'Reach 50,000 residents with every disaster switched on.', group: 'Adversity',
    test: (c, s) => s.population >= 50_000 && Object.values(c.disasters).every(Boolean) },
];

export function totalDisasters(c: City): number {
  let n = 0;
  for (const v of Object.values(c.disasterCounts)) n += v;
  return n;
}

/** Build the derived figures the predicates share. */
export function snapshotFor(c: City): Snapshot {
  const { level, civic } = c.tiles;
  let developed = 0;
  let powered = 0;
  let lvSum = 0;
  let pollSum = 0;
  const lv = c.fields.get('landValue');
  const poll = c.fields.get('pollution');
  // Sampled on very large maps: these feed a threshold check, not the simulation.
  const stride = level.length > 1 << 20 ? 17 : 1;
  for (let i = 0; i < level.length; i += stride) {
    if (level[i] === 0) continue;
    developed++;
    if (c.tiles.powered[i]) powered++;
    lvSum += lv[i];
    pollSum += poll[i];
  }

  let cleanSupply = 0;
  let totalSupply = 0;
  for (let i = 0; i < civic.length; i++) {
    if (!c.tiles.civicAnchor[i]) continue;
    const def = CIVIC_BY_KEY.get(keyOf(c, i));
    if (!def?.supply) continue;
    totalSupply += def.supply;
    if (!def.pollution) cleanSupply += def.supply;
  }

  return {
    population: c.stats.population,
    jobs: c.stats.jobsC + c.stats.jobsI,
    cleanShare: totalSupply === 0 ? 0 : cleanSupply / totalSupply,
    avgLandValue: developed === 0 ? 0 : lvSum / developed,
    avgPollution: developed === 0 ? 0 : pollSum / developed,
    poweredShare: developed === 0 ? 0 : powered / developed,
    builtKeys: new Set(),
    consecutiveSurplusMonths: c.consecutiveSurplusMonths,
  };
}

function keyOf(c: City, i: number): string {
  for (const [key, def] of CIVIC_BY_KEY) if (def.id === c.tiles.civic[i]) return key;
  return '';
}

void FIELD_MAX;

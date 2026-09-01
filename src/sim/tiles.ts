/**
 * Tile state — what the player has built. Separate from Fields (which is what the
 * simulation *derives*): tiles are authored, fields are computed.
 *
 * Same discipline as Fields: one ArrayBuffer, allocated once, no per-tick allocation.
 */
import type { Grid } from './grid.ts';

export const ZONE_NONE = 0;
export const ZONE_RES = 1;
export const ZONE_COM = 2;
export const ZONE_IND = 3;
export type Zone = 0 | 1 | 2 | 3;

export const ZONE_LABEL: Record<number, string> = {
  0: 'unzoned',
  1: 'residential',
  2: 'commercial',
  3: 'industrial',
};

/** Civic buildings the player plops directly. id 0 means none. */
export const CIVIC = {
  NONE: 0,
  POLICE: 1,
  FIRE: 2,
  SCHOOL: 3,
  PARK: 4,
  POWER: 5,
  BUS: 6,
  METRO: 7,
} as const;

/**
 * What must be true before a building can be placed.
 *
 * `population` is measured against the city's PEAK population, not its current one —
 * losing residents shouldn't take away something you already earned.
 */
export interface UnlockRule {
  population?: number;
  /** Keys of buildings that must have been built at least once. */
  requires?: string[];
}

export interface CivicDef {
  id: number;
  key: string;
  label: string;
  cost: number;
  upkeep: number;
  size: number;
  /** Field this building writes into, and how much. */
  source?: { field: string; value: number };
  /** Megawatts supplied (power plant only). */
  supply?: number;
  /** Emission written per tile of footprint. This is what makes clean power matter. */
  pollution?: number;
  /** Absent means available from the start. */
  unlock?: UnlockRule;
  /** Short note shown in the tool rail and manual. */
  note?: string;
  colour: string;
}

export const CIVIC_DEFS: CivicDef[] = [
  // --- services -------------------------------------------------------------
  { id: 1, key: 'police', label: 'Police station', cost: 500, upkeep: 100, size: 2,
    source: { field: 'policeSrc', value: 140 }, colour: '#4f7fd0' },
  { id: 16, key: 'policehq', label: 'Police HQ', cost: 2200, upkeep: 320, size: 3,
    source: { field: 'policeSrc', value: 250 }, colour: '#3f63a8',
    unlock: { population: 5000, requires: ['police'] },
    note: 'Far wider reach than a station' },

  { id: 2, key: 'fire', label: 'Fire station', cost: 500, upkeep: 100, size: 2,
    source: { field: 'fireSrc', value: 130 }, colour: '#d05a4f' },
  { id: 17, key: 'firehq', label: 'Fire HQ', cost: 2200, upkeep: 320, size: 3,
    source: { field: 'fireSrc', value: 240 }, colour: '#a8443b',
    unlock: { population: 5000, requires: ['fire'] },
    note: 'Covers a whole district' },

  { id: 3, key: 'school', label: 'School', cost: 700, upkeep: 150, size: 3,
    source: { field: 'schoolSrc', value: 150 }, colour: '#c8a44f' },
  { id: 15, key: 'university', label: 'University', cost: 4000, upkeep: 600, size: 4,
    source: { field: 'schoolSrc', value: 270 }, colour: '#a3852f',
    unlock: { population: 8000, requires: ['school'] },
    note: 'Gateway to nuclear power' },

  { id: 4, key: 'park', label: 'Park', cost: 150, upkeep: 20, size: 2,
    source: { field: 'amenity', value: 110 }, colour: '#4fa86a' },
  { id: 14, key: 'bigpark', label: 'Botanical garden', cost: 600, upkeep: 70, size: 3,
    source: { field: 'amenity', value: 190 }, colour: '#3d8a55',
    unlock: { population: 3000 },
    note: 'The strongest land-value lift available' },

  // --- power ----------------------------------------------------------------
  // A ladder with a real trade-off at every rung: output, upkeep, land, and smoke.
  { id: 5, key: 'power', label: 'Coal power plant', cost: 2200, upkeep: 200, size: 4,
    supply: 3000, pollution: 40, colour: '#8a8f9c',
    note: 'Cheap and filthy' },
  { id: 8, key: 'wind', label: 'Wind turbine', cost: 400, upkeep: 30, size: 1,
    supply: 250, pollution: 0, colour: '#9fc8d0',
    unlock: { population: 800 },
    note: 'Clean, but you will need a lot of them' },
  { id: 9, key: 'oil', label: 'Oil power plant', cost: 5000, upkeep: 450, size: 4,
    supply: 6000, pollution: 24, colour: '#6f6a5c',
    unlock: { population: 2500 },
    note: 'Twice the output of coal, and cleaner' },
  { id: 10, key: 'gas', label: 'Gas power plant', cost: 7000, upkeep: 380, size: 3,
    supply: 7000, pollution: 9, colour: '#7f96a0',
    unlock: { population: 6000, requires: ['oil'] },
    note: 'Cleaner and cheaper to run than oil' },
  { id: 11, key: 'solar', label: 'Solar farm', cost: 9000, upkeep: 150, size: 5,
    supply: 3000, pollution: 0, colour: '#3f4f7a',
    unlock: { population: 9000, requires: ['wind'] },
    note: 'No emissions and cheap to run, but it eats land' },
  { id: 12, key: 'nuclear', label: 'Nuclear plant', cost: 22000, upkeep: 900, size: 4,
    supply: 20000, pollution: 0, colour: '#5fae9b',
    unlock: { population: 20000, requires: ['gas', 'university'] },
    note: 'Enormous clean output. Needs an educated city' },
  { id: 13, key: 'fusion', label: 'Fusion plant', cost: 60000, upkeep: 1800, size: 4,
    supply: 50000, pollution: 0, colour: '#8ad0c4',
    unlock: { population: 50000, requires: ['nuclear', 'solar'] },
    note: 'The end of the energy problem' },

  // --- transit ---------------------------------------------------------------
  { id: 6, key: 'bus', label: 'Bus stop', cost: 120, upkeep: 18, size: 1,
    source: { field: 'transitSrc', value: 65 }, colour: '#b06fc8' },
  { id: 7, key: 'metro', label: 'Metro station', cost: 950, upkeep: 90, size: 2,
    source: { field: 'transitSrc', value: 185 }, colour: '#8a5ad0' },
  { id: 18, key: 'rail', label: 'Rail terminal', cost: 3500, upkeep: 260, size: 3,
    source: { field: 'transitSrc', value: 300 }, colour: '#6f42b5',
    unlock: { population: 12000, requires: ['metro'] },
    note: 'Transit access across a whole quarter' },
];

export const CIVIC_BY_ID = new Map(CIVIC_DEFS.map((d) => [d.id, d]));
export const CIVIC_BY_KEY = new Map(CIVIC_DEFS.map((d) => [d.key, d]));

/** Max building level by zone density. Low-density caps early; high-density towers. */
export const MAX_LEVEL = [2, 4, 6];

export class Tiles {
  readonly buffer: ArrayBuffer;
  /** Zone painted by the player. */
  readonly zone: Uint8Array;
  /** Density tier of the zone: 0 low, 1 medium, 2 high. */
  readonly density: Uint8Array;
  /** 1 if a road occupies this cell. */
  readonly road: Uint8Array;
  /** Development level of the grown building, 0 = empty lot. */
  readonly level: Uint8Array;
  /** Civic building id occupying this cell (0 = none). */
  readonly civic: Uint8Array;
  /** 1 if this cell is the anchor (top-left) of a multi-cell civic building. */
  readonly civicAnchor: Uint8Array;
  /** 1 if powered this tick. */
  readonly powered: Uint8Array;
  /** Cells to the nearest road, saturating at 255. Recomputed when roads change. */
  readonly roadDist: Uint8Array;
  /** Ticks this cell has been failing its growth conditions. Drives abandonment. */
  readonly distress: Uint8Array;

  constructor(grid: Grid) {
    const n = grid.size;
    const planes = 9;
    this.buffer = new ArrayBuffer(n * planes);
    let o = 0;
    const plane = () => {
      const a = new Uint8Array(this.buffer, o, n);
      o += n;
      return a;
    };
    this.zone = plane();
    this.density = plane();
    this.road = plane();
    this.level = plane();
    this.civic = plane();
    this.civicAnchor = plane();
    this.powered = plane();
    this.roadDist = plane();
    this.distress = plane();
    this.roadDist.fill(255);
  }
}

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
  ROAD: 0, // roads live in their own array
  POLICE: 1,
  FIRE: 2,
  SCHOOL: 3,
  PARK: 4,
  POWER: 5,
} as const;

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
  colour: string;
}

export const CIVIC_DEFS: CivicDef[] = [
  { id: 1, key: 'police', label: 'Police station', cost: 500, upkeep: 100, size: 2,
    source: { field: 'policeSrc', value: 140 }, colour: '#4f7fd0' },
  { id: 2, key: 'fire', label: 'Fire station', cost: 500, upkeep: 100, size: 2,
    source: { field: 'fireSrc', value: 130 }, colour: '#d05a4f' },
  { id: 3, key: 'school', label: 'School', cost: 700, upkeep: 150, size: 3,
    source: { field: 'schoolSrc', value: 150 }, colour: '#c8a44f' },
  { id: 4, key: 'park', label: 'Park', cost: 150, upkeep: 20, size: 2,
    source: { field: 'amenity', value: 110 }, colour: '#4fa86a' },
  // The first plant is mandatory before anything can develop, so its upkeep sets the
  // floor on how small a viable city can be. At $400/mo a 200-person town ran a
  // permanent deficit and went bankrupt before it could grow into the bill.
  { id: 5, key: 'power', label: 'Coal power plant', cost: 2200, upkeep: 200, size: 4,
    supply: 3000, colour: '#8a8f9c' },
];

export const CIVIC_BY_ID = new Map(CIVIC_DEFS.map((d) => [d.id, d]));

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

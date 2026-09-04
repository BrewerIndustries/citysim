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
  /** How many world works must already stand. Used by the capstone. */
  worksBuilt?: number;
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
  /** Cubic metres of water supplied (pump only). */
  water?: number;
  /** Sewage a treatment works can process. */
  sewage?: number;
  /** Refuse a landfill, incinerator or recycling plant can take. */
  waste?: number;
  /** Kills the waterfront amenity nearby — raw discharge, not a place to walk. */
  foulsWaterfront?: boolean;
  /** Must sit beside open water, or on ground with a workable water table. */
  needsWaterSource?: boolean;
  /** Emission written per tile of footprint. This is what makes clean power matter. */
  pollution?: number;
  /** Absent means available from the start. */
  unlock?: UnlockRule;
  /**
   * Marks this as a WORLD WORK: one per city, forever. See works.ts.
   *
   * Its presence is what makes the building unique — there is no separate flag to keep
   * in step with it.
   */
  works?: {
    /**
     * Works sharing a branch are alternatives. Building one locks its sibling for good.
     * Absent means this work stands alone.
     */
    branch?: string;
    bonus: import('./works.ts').WorksBonus;
    /** One line naming what it gives, shown wherever the building is. */
    boon: string;
  };
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

  // --- water -----------------------------------------------------------------
  // Water and sewage are both close to mandatory, so their upkeep sets the floor on how
  // small a city can be and still pay its way — the same trap the coal plant fell into.
  { id: 19, key: 'pump', label: 'Water pump', cost: 800, upkeep: 55, size: 2,
    water: 2400, needsWaterSource: true, colour: '#4fa3c8',
    note: 'Must sit beside water, or on a good water table' },
  { id: 20, key: 'waterworks', label: 'Water works', cost: 4500, upkeep: 420, size: 4,
    water: 14000, needsWaterSource: true, colour: '#3a7ea0',
    unlock: { population: 7000, requires: ['pump'] },
    note: 'Six times a pump, on the same siting rule' },

  // --- sewage ----------------------------------------------------------------
  // A pipe into the river costs little to run — the price is paid in pollution, not
  // upkeep. At $110/mo it alone tipped a viable starter city into permanent deficit.
  { id: 21, key: 'sewage', label: 'Sewage outflow', cost: 900, upkeep: 40, size: 2,
    sewage: 2000, needsWaterSource: true, pollution: 40, foulsWaterfront: true,
    colour: '#8f7a4a',
    note: 'Dumps raw into open water. Cheap, filthy, and it ruins the shore around it' },
  { id: 22, key: 'treatment', label: 'Treatment works', cost: 6000, upkeep: 560, size: 4,
    sewage: 16000, needsWaterSource: true, pollution: 7, colour: '#6f6136',
    unlock: { population: 9000, requires: ['sewage'] },
    note: 'Eight times the capacity, and a quarter of the smell' },

  // --- environment -----------------------------------------------------------
  { id: 23, key: 'cleanup', label: 'Cleanup station', cost: 3200, upkeep: 380, size: 3,
    source: { field: 'cleanupSrc', value: 190 }, colour: '#5fb08a',
    unlock: { population: 6000 },
    note: 'Scrubs pollution out of the ground around it' },
  { id: 24, key: 'reclamation', label: 'Reclamation works', cost: 11000, upkeep: 900, size: 4,
    source: { field: 'cleanupSrc', value: 320 }, colour: '#3f8f68',
    unlock: { population: 18000, requires: ['cleanup'] },
    note: 'Clears a whole district of a century of industry' },

  // --- refuse ----------------------------------------------------------------
  // Available from the start, because a city with no disposal at all stops growing and
  // that is not a lesson worth locking behind a population gate. The landfill is cheap,
  // enormous and vile; everything above it buys its way out of one of those three.
  { id: 25, key: 'landfill', label: 'Landfill', cost: 1200, upkeep: 45, size: 3,
    waste: 1400, pollution: 46, colour: '#7d7a52',
    note: 'Cheap and filthy. Put it downwind of everything' },
  { id: 26, key: 'incinerator', label: 'Incinerator', cost: 5400, upkeep: 460, size: 3,
    waste: 5200, pollution: 26, colour: '#8a6a4a',
    unlock: { population: 7000 },
    note: 'Takes far more, in a smaller footprint, for less mess' },
  { id: 27, key: 'recycling', label: 'Recycling centre', cost: 2800, upkeep: 270, size: 3,
    waste: 900, source: { field: 'recycleSrc', value: 175 }, colour: '#57a86a',
    unlock: { population: 3500 },
    note: 'Cuts the waste its neighbourhood makes, and is worth living near' },
  { id: 28, key: 'recovery', label: 'Materials recovery', cost: 9500, upkeep: 720, size: 4,
    waste: 3400, source: { field: 'recycleSrc', value: 300 }, colour: '#3f8f52',
    unlock: { population: 20000, requires: ['recycling'] },
    note: 'Recycling for a whole district' },

  // --- world works -----------------------------------------------------------
  // One per city, forever. Most come in pairs where building one closes the other off
  // permanently: the point is a decision a big city can only make once, not another
  // increment. See works.ts for why the bonus set is deliberately small and closed.
  { id: 29, key: 'grandpark', label: 'Grand Park', cost: 22000, upkeep: 900, size: 6,
    source: { field: 'amenity', value: 240 }, colour: '#5ec87a',
    unlock: { population: 8000 },
    works: {
      branch: 'heart', bonus: { landValue: 6, emission: 0.92 },
      boon: 'Raises land value across the whole city and takes the edge off its air',
    },
    note: 'The civic heart, if you want the city to feel green' },
  { id: 30, key: 'stadium', label: 'Grand Stadium', cost: 26000, upkeep: 1150, size: 6,
    source: { field: 'amenity', value: 190 }, colour: '#c8763f',
    unlock: { population: 8000 },
    works: {
      branch: 'heart', bonus: { demandC: 1.25, landValue: 4, crime: 1.15 },
      boon: 'Commercial demand across the city, at the cost of more crime',
    },
    note: 'The civic heart, if you want the city to feel busy' },

  { id: 31, key: 'terminus', label: 'Central Station', cost: 40000, upkeep: 1600, size: 6,
    source: { field: 'transitSrc', value: 260 }, colour: '#9a6fd0',
    unlock: { population: 20000, requires: ['metro'] },
    works: {
      branch: 'terminus', bonus: { demandC: 1.2, landValue: 5 },
      boon: 'Transit access reaching most of the city, and commerce to match',
    },
    note: 'A city built around moving people' },
  { id: 32, key: 'interchange', label: 'Freight Interchange', cost: 36000, upkeep: 1400, size: 6,
    pollution: 34, colour: '#8a7a4f',
    unlock: { population: 20000, requires: ['metro'] },
    works: {
      branch: 'terminus', bonus: { demandI: 1.35, waste: 2200, emission: 1.06 },
      boon: 'Industrial demand and disposal capacity, and the air to pay for it',
    },
    note: 'A city built around moving goods' },

  { id: 33, key: 'cityhall', label: 'City Hall', cost: 55000, upkeep: 1800, size: 5,
    source: { field: 'amenity', value: 150 }, colour: '#c8b45a',
    unlock: { population: 40000, requires: ['policehq'] },
    works: {
      branch: 'seat', bonus: { taxYield: 1.14 },
      boon: 'Every tax the city collects yields 14% more',
    },
    note: 'Govern for the treasury' },
  { id: 34, key: 'courts', label: 'Courts of Justice', cost: 52000, upkeep: 2000, size: 5,
    source: { field: 'policeSrc', value: 300 }, colour: '#6f83b8',
    unlock: { population: 40000, requires: ['policehq'] },
    works: {
      branch: 'seat', bonus: { crime: 0.7, landValue: 3 },
      boon: 'Cuts the crime the whole city generates by nearly a third',
    },
    note: 'Govern for the streets' },

  { id: 35, key: 'greenbelt', label: 'The Green Belt', cost: 45000, upkeep: 1500, size: 6,
    source: { field: 'cleanupSrc', value: 260 }, colour: '#3fa86a',
    unlock: { population: 30000, requires: ['reclamation'] },
    works: {
      branch: undefined, bonus: { emission: 0.78, landValue: 4 },
      boon: 'Every building in the city emits a fifth less',
    },
    note: 'Stands alone — there is no alternative to clean air' },

  { id: 36, key: 'monument', label: 'The Monument', cost: 120000, upkeep: 600, size: 4,
    source: { field: 'amenity', value: 300 }, colour: '#d8c87a',
    unlock: { population: 75000, worksBuilt: 3 },
    works: {
      branch: undefined, bonus: { landValue: 14 },
      boon: 'A city that has done everything else, and has something to show for it',
    },
    note: 'The capstone. Nothing else unlocks it' },

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
  /**
   * Which class of road: see ROAD_CLASSES in roads.ts. 0 where there is no road.
   *
   * Kept beside `road` rather than replacing it, because "is there a road here" is asked
   * from a dozen places and a truthiness test on a class id would keep working right up
   * until someone adds class 0 back.
   */
  readonly roadClass: Uint8Array;
  /** Which junction occupies this tile, if any. See JUNCTIONS in junctions.ts. */
  readonly junction: Uint8Array;
  /** 1 if a power line runs here. Lines may share a tile with a road. */
  readonly powerLine: Uint8Array;
  /** 1 if a water pipe runs here. Pipes may share a tile with a road or a line. */
  readonly pipe: Uint8Array;
  /**
   * 1 if a sewer runs here.
   *
   * A sewer may share a tile with a road or a power line freely. With a water pipe it
   * may only *cross*: one shared tile is an intersection, two adjacent shared tiles is a
   * foul line laid alongside the drinking supply, and that is refused. That is the whole
   * planning problem sewers introduce — the sewer may cut across the main street, but it
   * cannot run down it.
   */
  readonly sewer: Uint8Array;
  /** Development level of the grown building, 0 = empty lot. */
  readonly level: Uint8Array;
  /** Civic building id occupying this cell (0 = none). */
  readonly civic: Uint8Array;
  /** 1 if this cell is the anchor (top-left) of a multi-cell civic building. */
  readonly civicAnchor: Uint8Array;
  /** 1 if powered this tick. */
  readonly powered: Uint8Array;
  /** 1 if supplied with water this tick. */
  readonly watered: Uint8Array;
  /** 1 if connected to a working sewer this tick. */
  readonly sewered: Uint8Array;
  /** Cells to the nearest road, saturating at 255. Recomputed when roads change. */
  readonly roadDist: Uint8Array;
  /** Ticks this cell has been failing its growth conditions. Drives abandonment. */
  readonly distress: Uint8Array;

  constructor(grid: Grid) {
    const n = grid.size;
    const planes = 16;
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
    this.roadClass = plane();
    this.junction = plane();
    this.powerLine = plane();
    this.pipe = plane();
    this.sewer = plane();
    this.level = plane();
    this.civic = plane();
    this.civicAnchor = plane();
    this.powered = plane();
    this.watered = plane();
    this.sewered = plane();
    this.roadDist = plane();
    this.distress = plane();
    this.roadDist.fill(255);
  }
}

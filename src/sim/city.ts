/**
 * The city: tiles the player authors, fields the simulation derives, and the economy
 * that ties them together. This is the object the game loop drives.
 */
import { Grid } from './grid.ts';
import { Fields } from './fields.ts';
import { Simulation } from './sim.ts';
import { Tiles, CIVIC_BY_ID, CIVIC_DEFS, ZONE_RES, ZONE_COM, ZONE_IND, MAX_LEVEL } from './tiles.ts';
import { recomputeRoadDistance, ROAD_REACH } from './roads.ts';
import { distributePower, type PowerReport } from './power.ts';
import { stepGrowth, requiredDesirability, type GrowthStats } from './growth.ts';
import { computeDemand, NEUTRAL_TAX, type Demand } from './demand.ts';

export const TICKS_PER_MONTH = 8;
export const ROAD_COST = 10;
export const ROAD_UPKEEP = 0.4;
export const ZONE_COST = 8;
export const BULLDOZE_COST = 4;
/** Lifting a road is cheaper than levelling everything on the tile. */
export const ROAD_REMOVE_COST = 2;
/** Ticks a ticker message stays on screen before it expires. */
export const MESSAGE_TTL = 220;

export interface Ledger {
  taxR: number;
  taxC: number;
  taxI: number;
  upkeepCivic: number;
  upkeepRoads: number;
  net: number;
}

export class City {
  readonly grid: Grid;
  readonly sim: Simulation;
  readonly fields: Fields;
  readonly tiles: Tiles;
  /** Per-cell growth reason code — the data behind the Why Panel. */
  readonly reason: Uint8Array;

  funds = 50_000;
  tax = { r: NEUTRAL_TAX, c: NEUTRAL_TAX, i: NEUTRAL_TAX };
  month = 0;
  year = 1950;

  demand: Demand = { r: 0.6, c: 0.3, i: 0.4 };
  stats: GrowthStats = {
    population: 0, jobsC: 0, jobsI: 0, developedCells: 0,
    zonedCells: 0, abandonedThisTick: 0, grewThisTick: 0,
  };
  power: PowerReport = { supply: 0, demand: 0, litCells: 0, unservedCells: 0, brownout: false };
  ledger: Ledger = { taxR: 0, taxC: 0, taxI: 0, upkeepCivic: 0, upkeepRoads: 0, net: 0 };
  bankrupt = false;
  messages: Array<{ text: string; tick: number }> = [];

  private roadsDirty = true;
  private civicsDirty = true;
  private readonly queue: Int32Array;
  private readonly seen: Uint8Array;
  private tickCount = 0;

  constructor(size: number, seed = 1) {
    this.sim = new Simulation({ width: size, height: size, seed });
    this.grid = this.sim.grid;
    this.fields = this.sim.fields;
    this.tiles = new Tiles(this.grid);
    this.reason = new Uint8Array(this.grid.size);
    this.queue = new Int32Array(this.grid.size);
    this.seen = new Uint8Array(this.grid.size);
  }

  get tick(): number { return this.tickCount; }

  markRoadsDirty(): void { this.roadsDirty = true; }
  markCivicsDirty(): void { this.civicsDirty = true; }

  step(): void {
    if (this.roadsDirty) {
      recomputeRoadDistance(this.grid, this.tiles, this.queue);
      this.roadsDirty = false;
    }
    if (this.civicsDirty) {
      this.writeCivicSources();
      this.civicsDirty = false;
    }

    this.writeGrowthSources();
    this.sim.step();
    this.power = distributePower(this.grid, this.tiles, this.queue, this.seen);
    this.stats = stepGrowth(
      this.grid, this.tiles, this.fields, this.demand, this.tickCount, this.reason,
    );
    this.demand = computeDemand(
      {
        population: this.stats.population,
        jobsC: this.stats.jobsC,
        jobsI: this.stats.jobsI,
        residentialCapacity: 0, commercialCapacity: 0, industrialCapacity: 0,
      },
      this.tax,
    );

    this.tickCount++;
    if (this.tickCount % TICKS_PER_MONTH === 0) this.advanceMonth();
  }

  private advanceMonth(): void {
    const s = this.stats;
    const l = this.ledger;
    // Tax yield scales with what each sector actually supports, times its rate.
    l.taxR = s.population * 0.11 * this.tax.r;
    l.taxC = s.jobsC * 0.16 * this.tax.c;
    l.taxI = s.jobsI * 0.14 * this.tax.i;

    let civicUpkeep = 0;
    for (let i = 0; i < this.tiles.civic.length; i++) {
      if (!this.tiles.civicAnchor[i]) continue;
      const def = CIVIC_BY_ID.get(this.tiles.civic[i]);
      if (def) civicUpkeep += def.upkeep;
    }
    let roadCells = 0;
    for (let i = 0; i < this.tiles.road.length; i++) if (this.tiles.road[i]) roadCells++;

    l.upkeepCivic = civicUpkeep;
    l.upkeepRoads = roadCells * ROAD_UPKEEP;
    l.net = l.taxR + l.taxC + l.taxI - l.upkeepCivic - l.upkeepRoads;

    this.funds += l.net;

    this.month++;
    if (this.month >= 12) { this.month = 0; this.year++; }

    if (this.funds < 0 && !this.bankrupt) {
      this.bankrupt = true;
      this.pushMessage('The city is in the red. Raise taxes or cut services.');
    } else if (this.funds >= 0 && this.bankrupt) {
      this.bankrupt = false;
      this.pushMessage('The books are balanced again.');
    }
    if (this.power.brownout) {
      this.pushMessage(`Brownout: demand ${Math.round(this.power.demand)} MW exceeds supply ${this.power.supply} MW.`);
    }
  }

  /**
   * Messages carry the tick they were raised on so the ticker can expire them.
   * Without a timestamp a one-off complaint ("can't build there") sat in the corner
   * of the screen for the rest of the session.
   */
  pushMessage(text: string): void {
    const head = this.messages[0];
    if (head && head.text === text) { head.tick = this.tickCount; return; }
    this.messages.unshift({ text, tick: this.tickCount });
    if (this.messages.length > 40) this.messages.length = 40;
  }

  /** Messages raised recently enough to still be worth showing. */
  activeMessages(limit = 3): string[] {
    const out: string[] = [];
    for (const m of this.messages) {
      if (this.tickCount - m.tick > MESSAGE_TTL) break;
      out.push(m.text);
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Population, jobs and nuisance sources are a direct read of what's built. */
  private writeGrowthSources(): void {
    const { zone, density, level } = this.tiles;
    const popR = this.fields.get('popR');
    const jobsC = this.fields.get('jobsC');
    const jobsI = this.fields.get('jobsI');
    const emission = this.fields.get('emission');
    const crimeGen = this.fields.get('crimeGen');
    popR.fill(0); jobsC.fill(0); jobsI.fill(0);
    emission.fill(0); crimeGen.fill(0);

    for (let i = 0; i < zone.length; i++) {
      const lvl = level[i];
      if (lvl === 0) continue;
      const z = zone[i];
      const den = density[i];
      if (z === ZONE_RES) {
        popR[i] = lvl * (den + 1) * 6;
        emission[i] = lvl * 0.4;
        crimeGen[i] = 1.5 + lvl * (den + 1) * 0.5;
      } else if (z === ZONE_COM) {
        jobsC[i] = lvl * (den + 1) * 4;
        emission[i] = lvl * 0.9;
        crimeGen[i] = 2 + lvl * (den + 1) * 0.6;
      } else if (z === ZONE_IND) {
        jobsI[i] = lvl * (den + 1) * 5;
        emission[i] = 8 + lvl * (den + 1) * 3.2;
        crimeGen[i] = 1.5 + lvl * 0.4;
      }
    }
  }

  /** Civic buildings write into their coverage source fields. Only on change. */
  private writeCivicSources(): void {
    for (const def of CIVIC_DEFS) {
      if (def.source) this.fields.get(def.source.field as never).fill(0);
    }
    const { civic, civicAnchor } = this.tiles;
    for (let i = 0; i < civic.length; i++) {
      if (!civicAnchor[i]) continue;
      const def = CIVIC_BY_ID.get(civic[i]);
      if (def?.source) this.fields.get(def.source.field as never)[i] = def.source.value;
    }
  }

  // --- player actions --------------------------------------------------------

  canAfford(cost: number): boolean { return this.funds >= cost; }

  spend(cost: number): boolean {
    if (this.funds < cost) return false;
    this.funds -= cost;
    return true;
  }

  buildRoad(i: number): boolean {
    const t = this.tiles;
    if (t.road[i] || t.civic[i]) return false;
    if (!this.spend(ROAD_COST)) return false;
    t.road[i] = 1;
    t.zone[i] = 0;
    t.level[i] = 0;
    this.markRoadsDirty();
    return true;
  }

  paintZone(i: number, zone: number, density: number): boolean {
    const t = this.tiles;
    if (t.road[i] || t.civic[i]) return false;
    if (t.zone[i] === zone && t.density[i] === density) return false;
    if (!this.spend(ZONE_COST)) return false;
    t.zone[i] = zone;
    t.density[i] = density;
    if (t.level[i] > MAX_LEVEL[density]) t.level[i] = MAX_LEVEL[density];
    return true;
  }

  /** Returns the anchor index if placed, or null with a reason. */
  placeCivic(anchor: number, defId: number): { ok: boolean; error?: string } {
    const def = CIVIC_BY_ID.get(defId);
    if (!def) return { ok: false, error: 'unknown building' };
    const { width, height } = this.grid;
    const ax = anchor & (width - 1);
    const ay = anchor >>> this.grid.shift;
    if (ax + def.size > width || ay + def.size > height) {
      return { ok: false, error: 'does not fit on the map' };
    }
    for (let y = ay; y < ay + def.size; y++) {
      for (let x = ax; x < ax + def.size; x++) {
        const i = this.grid.index(x, y);
        if (this.tiles.civic[i] || this.tiles.road[i]) {
          return { ok: false, error: 'the site is occupied' };
        }
      }
    }
    if (!this.canAfford(def.cost)) return { ok: false, error: `costs $${def.cost}` };
    this.spend(def.cost);
    for (let y = ay; y < ay + def.size; y++) {
      for (let x = ax; x < ax + def.size; x++) {
        const i = this.grid.index(x, y);
        this.tiles.civic[i] = def.id;
        this.tiles.zone[i] = 0;
        this.tiles.level[i] = 0;
        this.tiles.civicAnchor[i] = 0;
      }
    }
    this.tiles.civicAnchor[anchor] = 1;
    this.markCivicsDirty();
    this.markRoadsDirty();
    return { ok: true };
  }

  /**
   * Lift a road without touching anything else on the tile. Bulldoze levels zoning,
   * buildings and civics too, which is far more than you want when you're just
   * rerouting a street.
   */
  removeRoad(i: number): boolean {
    const t = this.tiles;
    if (!t.road[i]) return false;
    if (!this.spend(ROAD_REMOVE_COST)) return false;
    t.road[i] = 0;
    this.markRoadsDirty();
    return true;
  }

  bulldoze(i: number): boolean {
    const t = this.tiles;
    const hadCivic = t.civic[i];
    if (!t.road[i] && !t.zone[i] && !t.level[i] && !hadCivic) return false;
    if (!this.spend(BULLDOZE_COST)) return false;

    if (hadCivic) {
      // Remove the whole footprint, wherever its anchor is.
      const def = CIVIC_BY_ID.get(hadCivic)!;
      const { width } = this.grid;
      const x0 = i & (width - 1);
      const y0 = i >>> this.grid.shift;
      for (let y = Math.max(0, y0 - def.size); y <= y0 + def.size; y++) {
        for (let x = Math.max(0, x0 - def.size); x <= x0 + def.size; x++) {
          if (x >= width || y >= this.grid.height) continue;
          const j = this.grid.index(x, y);
          if (t.civic[j] === hadCivic) { t.civic[j] = 0; t.civicAnchor[j] = 0; }
        }
      }
      this.markCivicsDirty();
    }
    if (t.road[i]) this.markRoadsDirty();
    t.road[i] = 0;
    t.zone[i] = 0;
    t.density[i] = 0;
    t.level[i] = 0;
    t.distress[i] = 0;
    return true;
  }

  /** Everything the Why Panel needs about one cell, read straight from the arrays. */
  inspect(i: number) {
    const t = this.tiles;
    const f = this.fields;
    const values: Record<string, number> = {};
    for (const [name, plane] of f.byName) values[name] = plane[i];
    return {
      index: i,
      x: i & (this.grid.width - 1),
      y: i >>> this.grid.shift,
      zone: t.zone[i],
      density: t.density[i],
      level: t.level[i],
      road: t.road[i],
      civic: t.civic[i],
      powered: t.powered[i],
      roadDist: t.roadDist[i],
      distress: t.distress[i],
      reason: this.reason[i],
      roadReach: ROAD_REACH,
      required: requiredDesirability(t.level[i]),
      values,
    };
  }
}

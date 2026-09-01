/**
 * The city: tiles the player authors, fields the simulation derives, and the economy
 * that ties them together. This is the object the game loop drives.
 */
import { Grid } from './grid.ts';
import { Rng } from './rng.ts';
import { Fields } from './fields.ts';
import { Simulation } from './sim.ts';
import { Tiles, CIVIC_BY_ID, CIVIC_DEFS, ZONE_RES, ZONE_COM, ZONE_IND, MAX_LEVEL } from './tiles.ts';
import { recomputeRoadDistance, ROAD_REACH } from './roads.ts';
import { UtilityGrid, POWER, WATER, SEWAGE, type UtilityReport } from './utility.ts';
import { stepGrowth, tallyCity, requiredDesirability, type GrowthStats } from './growth.ts';
import { computeDemand, NEUTRAL_TAX, type Demand } from './demand.ts';
import { updateFireRisk, stepFires } from './fire.ts';
import { stepDisasters, DISASTERS } from './disasters.ts';
import { ACHIEVEMENTS, snapshotFor } from './achievements.ts';
import { History } from './history.ts';
import { Terrain, WATER_TABLE_MIN } from './terrain.ts';
import { lockReason, unlockedIds, type UnlockState } from './unlocks.ts';
import { ChangeLog } from './dirty.ts';
import {
  wasteAt, isOverflowing, OVERFLOW_EMISSION, EMPTY_WASTE, type WasteReport,
} from './waste.ts';
import { emptySeries, pushSample, type SeriesData } from './history-series.ts';

export const TICKS_PER_MONTH = 8;
export const ROAD_COST = 10;
export const ROAD_UPKEEP = 0.4;
export const ZONE_COST = 8;
export const BULLDOZE_COST = 4;
/** Lifting a road is cheaper than levelling everything on the tile. */
export const ROAD_REMOVE_COST = 2;
/** Utilities are cheap to lay and cheap to maintain — the cost is the planning. */
export const LINE_COST = 6;
export const PIPE_COST = 6;
export const LINE_UPKEEP = 0.15;
export const PIPE_UPKEEP = 0.15;

/** The three networks a player lays by hand. */
export type UtilityKind = 'powerLine' | 'pipe' | 'sewer';
export const UTILITY_KINDS: readonly UtilityKind[] = ['powerLine', 'pipe', 'sewer'];

/** What the Remove tool should take off a tile. */
export type RemoveTarget = 'all' | 'road' | UtilityKind;
/** Ticks a one-off event (a fire, a flood, an achievement) stays on screen. */
export const MESSAGE_TTL = 220;
/**
 * Ticks a STANDING CONDITION stays on screen — a brownout, an unattached pump.
 *
 * Much shorter, because these are re-raised every month while the problem lasts, so a
 * long life only means the complaint outlives the fix. Attaching a pipe and still being
 * told the pump has no pipe is worse than not being told at all.
 */
export const CONDITION_TTL = 20;
/** Amenity value of a waterfront tile. Below a park's, but it runs the whole coast. */
export const SHORE_AMENITY = 48;
/** How far a raw sewage outflow spoils the waterfront around it. */
export const FOUL_REACH = 12;
/** Source fields written from what the player has built. */
const GROWTH_SOURCE_FIELDS = ['popR', 'jobsC', 'jobsI', 'emission', 'crimeGen', 'wasteSrc'] as const;

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
  readonly terrain: Terrain;
  readonly mapSeed: number;
  readonly history = new History();
  /** Monthly time series behind the History graph. */
  series: SeriesData = emptySeries();

  funds = 50_000;
  tax = { r: NEUTRAL_TAX, c: NEUTRAL_TAX, i: NEUTRAL_TAX };
  month = 0;
  year = 1950;

  demand: Demand = { r: 0.6, c: 0.3, i: 0.4 };
  stats: GrowthStats = {
    population: 0, jobsC: 0, jobsI: 0, developedCells: 0,
    zonedCells: 0, abandonedThisTick: 0, grewThisTick: 0,
  };
  power: UtilityReport = { supply: 0, demand: 0, servedCells: 0, unservedCells: 0, shortfall: false, isolatedSources: [], unpoweredSources: [] };
  water: UtilityReport = { supply: 0, demand: 0, servedCells: 0, unservedCells: 0, shortfall: false, isolatedSources: [], unpoweredSources: [] };
  sewage: UtilityReport = { supply: 0, demand: 0, servedCells: 0, unservedCells: 0, shortfall: false, isolatedSources: [], unpoweredSources: [] };
  waste: WasteReport = { ...EMPTY_WASTE };

  /**
   * Running total of what the city throws away, kept incrementally.
   *
   * Every cell's contribution is written by `writeSourcesAt`, which only ever runs on
   * cells that changed — so the total is maintained there rather than by scanning the
   * grid once a tick for a number that moves one building at a time.
   */
  private wasteProduced = 0;
  /** Whether refuse was piling up last tick, so a change can be noticed. */
  private wasteOverflow = false;
  /**
   * Anchors of the buildings that take refuse, cached because whether each one is
   * *powered* changes every tick while the list of them changes only when you build.
   * Scanning the grid for four buildings once a tick is the trap the monthly ledger
   * already fell into once.
   */
  private wasteSites: number[] = [];
  ledger: Ledger = { taxR: 0, taxC: 0, taxI: 0, upkeepCivic: 0, upkeepRoads: 0, net: 0 };
  bankrupt = false;
  /** Sticky: needed by the 'back from the brink' achievement. */
  wasBankrupt = false;
  /** Months of unbroken surplus, for the 'prudent' achievement. */
  consecutiveSurplusMonths = 0;
  /** Ids of achievements earned. Never removed once granted. */
  earned = new Set<string>();
  /** Disasters can be switched off individually; some players want a pure builder. */
  disasters: Record<string, boolean> = Object.fromEntries(DISASTERS.map((d) => [d.key, true]));
  /** How many of each have struck, and what they cost. Feeds achievements. */
  disasterCounts: Record<string, number> = Object.fromEntries(DISASTERS.map((d) => [d.key, 0]));
  tilesLostToDisaster = 0;
  /** Test hook: multiplies disaster frequency. 1 is the real game. */
  disasterRateScale = 1;
  /** Progression is measured against the high-water mark, never the current figure. */
  peakPopulation = 0;
  everBuilt = new Set<number>();
  unlocked: Set<number> = new Set();
  messages: Array<{ text: string; tick: number; ttl: number }> = [];

  private roadsDirty = true;
  private civicsDirty = true;
  /** Cells whose authored state changed and whose source values need rewriting. */
  /**
   * Sized to the map: at Tier 3 a busy tick can change tens of thousands of cells, and
   * a small cap meant the log overflowed constantly and fell back to rebuilding every
   * source over the whole grid — which cost more than the tracking saved.
   */
  private readonly changes: ChangeLog;
  /** Set when a change is too broad to track cell by cell (load, undo, first tick). */
  private sourcesAllDirty = true;
  /** Remaining full source rewrites owed after a utility network changed. */
  private sourceRefreshes = 0;
  /** Fires draw from their own stream so toggling them can't shift the rest of the sim. */
  private readonly rngFire: Rng;
  private readonly queue: Int32Array;
  private readonly powerGrid: UtilityGrid;
  private readonly waterGrid: UtilityGrid;
  private readonly sewageGrid: UtilityGrid;
  /** Maintained as things are built, so the monthly ledger needs no full-grid scan. */
  private sourceRegions: import('./dirty.ts').DirtyRegion[] | undefined;
  private roadCells = 0;
  private readonly utilityCells: Record<UtilityKind, number> = { powerLine: 0, pipe: 0, sewer: 0 };
  private civicUpkeep = 0;
  private tickCount = 0;

  constructor(size: number, seed = 1, mapSeed = seed, fullRecompute = false) {
    this.sim = new Simulation({ width: size, height: size, seed, fullRecompute });
    this.mapSeed = mapSeed;
    this.grid = this.sim.grid;
    this.fields = this.sim.fields;
    this.tiles = new Tiles(this.grid);
    this.reason = new Uint8Array(this.grid.size);
    this.rngFire = new Rng(seed ^ 0x5bf03635);
    this.terrain = new Terrain(this.grid, mapSeed);
    this.refreshUnlocks();
    this.queue = new Int32Array(this.grid.size);
    this.powerGrid = new UtilityGrid(this.grid.size, POWER, this.grid.width);
    this.waterGrid = new UtilityGrid(this.grid.size, WATER, this.grid.width);
    this.sewageGrid = new UtilityGrid(this.grid.size, SEWAGE, this.grid.width);
    this.changes = new ChangeLog(Math.min(this.grid.size, 1 << 20));
  }

  get tick(): number { return this.tickCount; }
  /** Restore the clock when loading a save. */
  setTick(v: number): void { this.tickCount = v; }

  /**
   * Run the derived simulation without letting the city change: fields, then power.
   * Used after loading, where tiles are restored but every field starts at zero — the
   * staggered coverage passes need ~10 ticks before they've all run at least once.
   */
  /** Rebuild the incremental ledger counters from scratch. */
  recountUpkeep(): void {
    const { road, powerLine, pipe, sewer, civic, civicAnchor } = this.tiles;
    let roads = 0;
    let upkeep = 0;
    this.utilityCells.powerLine = 0;
    this.utilityCells.pipe = 0;
    this.utilityCells.sewer = 0;
    for (let i = 0; i < road.length; i++) {
      if (road[i]) roads++;
      if (powerLine[i]) this.utilityCells.powerLine++;
      if (pipe[i]) this.utilityCells.pipe++;
      if (sewer[i]) this.utilityCells.sewer++;
      if (civicAnchor[i]) upkeep += CIVIC_BY_ID.get(civic[i])?.upkeep ?? 0;
    }
    this.roadCells = roads;
    this.civicUpkeep = upkeep;
  }

  settleFields(ticks: number): void {
    this.sourcesAllDirty = true;
    this.recountUpkeep();
    for (let n = 0; n < ticks; n++) {
      if (this.roadsDirty) { recomputeRoadDistance(this.grid, this.tiles, this.queue); this.roadsDirty = false; }
      if (this.civicsDirty) { this.writeCivicSources(); this.civicsDirty = false; }
      this.applySourceChanges();
      this.sim.step();
      this.power = this.powerGrid.step(this.grid, this.tiles);
    }
    updateFireRisk(this.fields, this.tiles);
    // Populate the census so a freshly loaded city doesn't report zero residents, and
    // so demand is derived from what's actually standing.
    this.stats = tallyCity(this.tiles);
  }

  markRoadsDirty(): void { this.roadsDirty = true; }
  /** Anything that changes what carries a utility, or where it comes from. */
  markUtilitiesDirty(): void {
    this.powerGrid.markDirty();
    this.waterGrid.markDirty();
    this.sewageGrid.markDirty();
    // Septic emission depends on whether a cell is SEWERED, which is DERIVED from the
    // network rather than authored, and the networks are recomputed after the sources
    // are written. So one refresh isn't enough: the first happens before `sewered` has
    // been updated and writes the old answer. Two passes lets the second see the
    // settled network. Without this, connecting a sewer never stopped the buildings it
    // now served from leaking.
    this.sourceRefreshes = 2;
  }
  markCivicsDirty(): void { this.civicsDirty = true; this.markUtilitiesDirty(); }

  /** Set to accumulate per-phase timings into `profile`. Off by default. */
  profiling = false;
  profile: Record<string, number> = {};

  private phase(name: string, fn: () => void): void {
    if (!this.profiling) { fn(); return; }
    const t0 = performance.now();
    fn();
    this.profile[name] = (this.profile[name] ?? 0) + (performance.now() - t0);
  }

  step(): void {
    if (this.profiling) this.profile = {};
    if (this.roadsDirty) {
      recomputeRoadDistance(this.grid, this.tiles, this.queue);
      this.roadsDirty = false;
    }
    if (this.civicsDirty) {
      this.writeCivicSources();
      this.civicsDirty = false;
    }

    this.phase('sources', () => this.applySourceChanges());
    this.phase('diffusion', () => this.sim.step());
    this.phase('power', () => {
      this.power = this.powerGrid.step(this.grid, this.tiles);
      this.water = this.waterGrid.step(this.grid, this.tiles);
      this.sewage = this.sewageGrid.step(this.grid, this.tiles);
    });
    this.phase('waste', () => this.accountWaste());
    this.changes.reset();
    this.phase('growth', () => {
      this.stats = stepGrowth(
        this.grid, this.tiles, this.fields, this.demand, this.tickCount, this.reason,
        this.changes, this.wasteOverflow,
      );
    });
    this.phase('fireRisk', () => updateFireRisk(this.fields, this.tiles));
    if (this.disasters.fire) {
      for (const f of stepFires(this.grid, this.fields, this.tiles, this.rngFire, this.stats.developedCells, this.changes)) {
        this.disasterCounts.fire++;
        this.tilesLostToDisaster += f.burned;
        this.pushMessage(
          f.burned > 1
            ? `Fire at ${f.x}, ${f.y} — ${f.burned} buildings lost. Check fire coverage.`
            : `Fire at ${f.x}, ${f.y}. Check fire coverage.`,
        );
      }
    }
    for (const e of stepDisasters({
      grid: this.grid, tiles: this.tiles, fields: this.fields, terrain: this.terrain,
      rng: this.rngFire, changes: this.changes,
      developedCells: this.stats.developedCells, enabled: this.disasters,
      rateScale: this.disasterRateScale,
    })) {
      this.disasterCounts[e.key]++;
      this.tilesLostToDisaster += e.destroyed;
      this.pushMessage(e.message);
    }

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
    if (this.tickCount % TICKS_PER_MONTH === 0) this.phase('month', () => this.advanceMonth());
  }

  private advanceMonth(): void {
    const s = this.stats;
    const l = this.ledger;
    // Tax yield scales with what each sector actually supports, times its rate.
    l.taxR = s.population * 0.11 * this.tax.r;
    l.taxC = s.jobsC * 0.16 * this.tax.c;
    l.taxI = s.jobsI * 0.14 * this.tax.i;

    // Counted incrementally as things are built and demolished. Two full-grid scans a
    // month cost 35ms a tick at Tier 3 for numbers that change by one at a time.
    l.upkeepCivic = this.civicUpkeep;
    l.upkeepRoads = this.roadCells * ROAD_UPKEEP
      + (this.utilityCells.powerLine + this.utilityCells.pipe + this.utilityCells.sewer) * LINE_UPKEEP;
    l.net = l.taxR + l.taxC + l.taxI - l.upkeepCivic - l.upkeepRoads;

    this.funds += l.net;

    // Sample AFTER the ledger settles, so funds and net describe the month just closed.
    pushSample(this.series, {
      population: this.stats.population,
      jobs: this.stats.jobsC + this.stats.jobsI,
      funds: this.funds,
      net: l.net,
      landValue: this.averageOverBuilt('landValue'),
      pollution: this.averageOverBuilt('pollution'),
    });

    this.checkAchievements();

    if (this.stats.population > this.peakPopulation) {
      this.peakPopulation = this.stats.population;
      this.refreshUnlocks(true);
    }

    this.month++;
    if (this.month >= 12) { this.month = 0; this.year++; }

    this.consecutiveSurplusMonths = l.net > 0 ? this.consecutiveSurplusMonths + 1 : 0;

    if (this.funds < 0 && !this.bankrupt) {
      this.bankrupt = true;
      this.wasBankrupt = true;
      this.pushMessage('The city is in the red. Raise taxes or cut services.', CONDITION_TTL);
    } else if (this.funds >= 0 && this.bankrupt) {
      this.bankrupt = false;
      this.pushMessage('The books are balanced again.');
    }
    if (this.power.shortfall) {
      this.pushMessage(
        `Brownout: demand ${Math.round(this.power.demand)} MW exceeds supply ${this.power.supply} MW.`,
        CONDITION_TTL,
      );
    }
    for (const s of this.power.isolatedSources) {
      this.pushMessage(`The power plant at ${s.x}, ${s.y} has no line attached to it.`, CONDITION_TTL);
    }
    for (const s of this.water.isolatedSources) {
      this.pushMessage(`The water pump at ${s.x}, ${s.y} has no pipe attached to it.`, CONDITION_TTL);
    }
    for (const s of this.sewage.isolatedSources) {
      this.pushMessage(`The sewage works at ${s.x}, ${s.y} has no sewer attached to it.`, CONDITION_TTL);
    }
    for (const s of this.water.unpoweredSources) {
      this.pushMessage(`The water pump at ${s.x}, ${s.y} has no power — it is pumping nothing.`, CONDITION_TTL);
    }
    for (const s of this.sewage.unpoweredSources) {
      this.pushMessage(`The sewage works at ${s.x}, ${s.y} has no power.`, CONDITION_TTL);
    }
    if (this.sewage.shortfall) {
      this.pushMessage(
        `Sewers overloaded: ${Math.round(this.sewage.demand)} against ${this.sewage.supply} of capacity.`,
        CONDITION_TTL,
      );
    }
    if (this.water.shortfall) {
      this.pushMessage(
        `Water shortage: demand ${Math.round(this.water.demand)} exceeds supply ${this.water.supply}.`,
        CONDITION_TTL,
      );
    }
    if (this.waste.overflow) {
      this.pushMessage(
        `Refuse is piling up: ${Math.round(this.waste.produced)} produced against `
        + `${this.waste.capacity} of disposal. Nothing will grow until it is dealt with.`,
        CONDITION_TTL,
      );
    }
    for (const site of this.waste.unpoweredSites) {
      this.pushMessage(`The ${site} has no power, so it is taking nothing.`, CONDITION_TTL);
    }
  }

  /**
   * Messages carry the tick they were raised on so the ticker can expire them.
   * Without a timestamp a one-off complaint ("can't build there") sat in the corner
   * of the screen for the rest of the session.
   */
  /**
   * Average a field over DEVELOPED land only. Averaging the whole map would swamp the
   * signal with empty countryside and every series would read as a flat line near zero.
   */
  private averageOverBuilt(field: string): number {
    const plane = this.fields.get(field as never);
    const { level } = this.tiles;
    // Sampled rather than exhaustive: this feeds a graph line, and scanning four million
    // cells twice a month to refine a plotted average by a fraction of a percent is not
    // a good trade. The stride is coprime with the row width so it doesn't sample the
    // same column of every row.
    const stride = level.length > 1 << 20 ? 17 : 1;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < level.length; i += stride) {
      if (level[i] === 0) continue;
      sum += plane[i];
      n++;
    }
    return n === 0 ? 0 : sum / n;
  }

  /** Turn every disaster on or off at once. */
  setDisasters(on: boolean): void {
    for (const d of DISASTERS) this.disasters[d.key] = on;
  }

  /**
   * Evaluated once a month rather than per tick: every predicate is a threshold on
   * figures that only move meaningfully over months, and the shared snapshot walks the
   * map once.
   */
  private checkAchievements(): void {
    if (this.earned.size === ACHIEVEMENTS.length) return;
    const snap = snapshotFor(this);
    for (const a of ACHIEVEMENTS) {
      if (this.earned.has(a.id)) continue;
      if (!a.test(this, snap)) continue;
      this.earned.add(a.id);
      this.pushMessage(`Achievement: ${a.name} — ${a.description}`);
    }
  }

  get unlockState(): UnlockState {
    return { peakPopulation: this.peakPopulation, everBuilt: this.everBuilt };
  }

  lockReasonFor(defId: number): string | null {
    const def = CIVIC_BY_ID.get(defId);
    return def ? lockReason(def, this.unlockState) : 'unknown building';
  }

  /** Recompute what's available, announcing anything newly unlocked. */
  refreshUnlocks(announce = false): void {
    const next = unlockedIds(this.unlockState);
    if (announce) {
      for (const id of next) {
        if (this.unlocked.has(id)) continue;
        const def = CIVIC_BY_ID.get(id);
        if (def) this.pushMessage(`Now available: ${def.label}.`);
      }
    }
    this.unlocked = next;
  }

  pushMessage(text: string, ttl = MESSAGE_TTL): void {
    const head = this.messages[0];
    if (head && head.text === text) { head.tick = this.tickCount; head.ttl = ttl; return; }
    this.messages.unshift({ text, tick: this.tickCount, ttl });
    if (this.messages.length > 40) this.messages.length = 40;
  }

  /** Messages raised recently enough to still be worth showing. */
  activeMessages(limit = 3): string[] {
    const out: string[] = [];
    for (const m of this.messages) {
      if (this.tickCount - m.tick > m.ttl) continue;
      out.push(m.text);
      if (out.length >= limit) break;
    }
    return out;
  }

  /**
   * Bring the source fields in line with what's built.
   *
   * The first version rewrote all five planes over the entire grid every tick, which
   * meant every source was always dirty and no diffusion pass could ever be skipped.
   * Now only the cells that actually changed are rewritten, and the simulation is told
   * exactly where — which is what lets a settled city cost almost nothing.
   */
  private applySourceChanges(): void {
    if (this.sourceRefreshes > 0) {
      this.sourceRefreshes--;
      this.sourcesAllDirty = true;
    }
    if (this.sourcesAllDirty) {
      this.writeGrowthSources();
      this.sim.markAllDirty();
      this.sourcesAllDirty = false;
      this.changes.reset();
      return;
    }
    if (this.changes.overflowed) {
      this.writeGrowthSources();
      this.sim.markAllDirty();
      this.changes.reset();
      return;
    }
    // Mark each changed CELL, not the bounding box of all of them. Six scattered fires
    // across a 2048-cell map have a bounding box covering the entire map, so marking by
    // bounds re-diffused everything and threw away the whole benefit of chunk tracking.
    // The regions are resolved once so this stays a tight loop.
    const regions = this.sourceRegions ??= this.sim.sourceRegions(GROWTH_SOURCE_FIELDS);
    const mask = this.grid.width - 1;
    const shift = this.grid.shift;
    for (let n = 0; n < this.changes.count; n++) {
      const i = this.changes.at(n);
      this.writeSourcesAt(i);
      const x = i & mask;
      const y = i >>> shift;
      for (let r = 0; r < regions.length; r++) regions[r].mark(x, y);
    }
  }

  private recordChange(i: number): void {
    this.changes.addAt(i, i & (this.grid.width - 1), i >>> this.grid.shift);
  }

  /** Recompute one cell's contribution to every source field it can write. */
  private writeSourcesAt(i: number): void {
    const { zone, density, level, civic } = this.tiles;
    const f = this.fields;
    const popR = f.get('popR');
    const jobsC = f.get('jobsC');
    const jobsI = f.get('jobsI');
    const emission = f.get('emission');
    const crimeGen = f.get('crimeGen');
    const wasteSrc = f.get('wasteSrc');

    this.wasteProduced -= wasteSrc[i];
    popR[i] = 0; jobsC[i] = 0; jobsI[i] = 0; emission[i] = 0; crimeGen[i] = 0;
    wasteSrc[i] = 0;

    const civicId = civic[i];
    if (civicId) {
      const def = CIVIC_BY_ID.get(civicId);
      if (def?.pollution) emission[i] = def.pollution;
      return;
    }

    const lvl = level[i];
    if (lvl === 0) return;
    const z = zone[i];
    const den = density[i];
    // Recycling cuts the stream before it is ever collected, which is why it reduces
    // the tip you need as well as the pollution.
    wasteSrc[i] = wasteAt(z, lvl, den, f.get('recycleCover')[i]);
    this.wasteProduced += wasteSrc[i];
    // Refuse that is not being collected sits in the street.
    const litter = this.wasteOverflow ? lvl * (den + 1) * OVERFLOW_EMISSION : 0;
    // What isn't carried away has to go somewhere. Kept to a nuisance rather than an
    // industrial dose: at 1.6 per level-density a septic street polluted a third as hard
    // as heavy industry and simply demolished itself, which is a punishment, not a
    // trade-off.
    const septic = this.tiles.sewered[i] ? 0 : lvl * (den + 1) * 0.5;
    if (z === ZONE_RES) {
      popR[i] = lvl * (den + 1) * 6;
      emission[i] = lvl * 0.4 + septic + litter;
      crimeGen[i] = 1.5 + lvl * (den + 1) * 0.5;
    } else if (z === ZONE_COM) {
      jobsC[i] = lvl * (den + 1) * 4;
      emission[i] = lvl * 0.9 + septic + litter;
      crimeGen[i] = 2 + lvl * (den + 1) * 0.6;
    } else if (z === ZONE_IND) {
      jobsI[i] = lvl * (den + 1) * 5;
      emission[i] = 8 + lvl * (den + 1) * 3.2 + septic + litter;
      crimeGen[i] = 1.5 + lvl * 0.4;
    }
  }

  /** Population, jobs and nuisance sources are a direct read of what's built. */
  private writeGrowthSources(): void {
    for (const name of GROWTH_SOURCE_FIELDS) this.fields.get(name as never).fill(0);
    // The fill above bypasses the per-cell bookkeeping in writeSourcesAt, so the running
    // total has to be zeroed with it or it drifts up every full rebuild.
    this.wasteProduced = 0;
    const { zone, level, civic } = this.tiles;
    for (let i = 0; i < zone.length; i++) {
      if (level[i] === 0 && civic[i] === 0) continue;
      this.writeSourcesAt(i);
    }
  }

  /**
   * Civic buildings write into their coverage source fields. Only on change.
   *
   * The waterfront is folded in here as an amenity rather than given its own field and
   * diffusion pass — "being by the water is nice" is exactly what the amenity field
   * already means, and it costs nothing extra per tick.
   */
  private writeCivicSources(): void {
    for (const def of CIVIC_DEFS) {
      if (def.source) this.fields.get(def.source.field as never).fill(0);
    }
    const amenity = this.fields.get('amenity');
    const shore = this.terrain.shore;
    for (let i = 0; i < shore.length; i++) if (shore[i]) amenity[i] = SHORE_AMENITY;

    // A raw outflow ruins the shore it discharges into. The waterfront premium is the
    // first thing you lose by dumping untreated, before the pollution even spreads.
    const { width, height } = this.grid;
    for (let i = 0; i < this.tiles.civic.length; i++) {
      if (!this.tiles.civicAnchor[i]) continue;
      const def = CIVIC_BY_ID.get(this.tiles.civic[i]);
      if (!def?.foulsWaterfront) continue;
      const ax = i & (width - 1);
      const ay = i >>> this.grid.shift;
      for (let y = Math.max(0, ay - FOUL_REACH); y <= Math.min(height - 1, ay + FOUL_REACH); y++) {
        for (let x = Math.max(0, ax - FOUL_REACH); x <= Math.min(width - 1, ax + FOUL_REACH); x++) {
          amenity[this.grid.index(x, y)] = 0;
        }
      }
    }
    this.wasteSites = [];
    for (let i = 0; i < this.tiles.civic.length; i++) {
      if (!this.tiles.civicAnchor[i]) continue;
      if (CIVIC_BY_ID.get(this.tiles.civic[i])?.waste) this.wasteSites.push(i);
    }

    // Civic sources changed wholesale; the affected fields are cheap and rarely touched.
    for (const def of CIVIC_DEFS) if (def.source) this.sim.markSourceAll(def.source.field);
    const { civic, civicAnchor } = this.tiles;
    for (let i = 0; i < civic.length; i++) {
      if (!civicAnchor[i]) continue;
      const def = CIVIC_BY_ID.get(civic[i]);
      if (def?.source) this.fields.get(def.source.field as never)[i] = def.source.value;
    }
  }

  // --- player actions --------------------------------------------------------

  /** Open (or continue) an undo step. Same stroke id = same step. */
  beginStroke(id: string, label: string): void {
    this.history.begin(this.tiles, id, label, this.funds);
  }

  endStroke(): void {
    this.history.commit(this.tiles, this.funds);
  }

  undo(): string | null {
    const r = this.history.undo(this.tiles, this.funds);
    if (!r) return null;
    this.funds = r.funds;
    this.afterHistoryChange();
    return r.label;
  }

  redo(): string | null {
    const r = this.history.redo(this.tiles, this.funds);
    if (!r) return null;
    this.funds = r.funds;
    this.afterHistoryChange();
    return r.label;
  }

  /** Roads and civic sources are derived from tiles, so both must be rebuilt. */
  private afterHistoryChange(): void {
    // Undo restores arbitrarily many tiles at once; rebuilding every source is far
    // simpler than trying to track what a restore touched.
    this.sourcesAllDirty = true;
    this.markRoadsDirty();
    this.markCivicsDirty();
    this.recountUpkeep();
    this.stats = tallyCity(this.tiles);
  }

  canAfford(cost: number): boolean { return this.funds >= cost; }

  spend(cost: number): boolean {
    if (this.funds < cost) return false;
    this.funds -= cost;
    return true;
  }

  buildRoad(i: number): boolean {
    const t = this.tiles;
    if (t.road[i] || t.civic[i] || this.terrain.water[i]) return false;
    if (!this.canAfford(ROAD_COST)) return false;
    this.history.touch(t, i);
    this.spend(ROAD_COST);
    t.road[i] = 1;
    t.zone[i] = 0;
    t.level[i] = 0;
    this.roadCells++;
    this.recordChange(i);
    this.markRoadsDirty();
    return true;
  }

  /**
   * Lay a power line, a water pipe or a sewer. All three may share a tile with a road —
   * utilities run under the street, which is where they belong and how a real city is
   * laid out. Sewers and water pipes may only *cross* each other; see `crossingBlocker`.
   */
  buildUtility(i: number, kind: UtilityKind): boolean {
    const t = this.tiles;
    const plane = this.utilityPlane(kind);
    if (plane[i] || this.terrain.water[i]) return false;
    if (this.crossingBlocker(i, kind) >= 0) return false;
    const cost = kind === 'powerLine' ? LINE_COST : PIPE_COST;
    if (!this.canAfford(cost)) return false;
    this.history.touch(t, i);
    this.spend(cost);
    plane[i] = 1;
    this.utilityCells[kind]++;
    this.markUtilitiesDirty();
    return true;
  }

  removeUtility(i: number, kind: UtilityKind): boolean {
    const t = this.tiles;
    const plane = this.utilityPlane(kind);
    if (!plane[i]) return false;
    if (!this.canAfford(ROAD_REMOVE_COST)) return false;
    this.history.touch(t, i);
    this.spend(ROAD_REMOVE_COST);
    plane[i] = 0;
    this.utilityCells[kind]--;
    this.markUtilitiesDirty();
    return true;
  }

  /**
   * Take one thing, or everything, off a tile — the non-destructive counterpart to the
   * bulldozer, which leaves zoning and buildings alone.
   *
   * `all` clears the utilities first and then the road, so a single drag over a street
   * empties it completely; the whole drag is one undo step, which is what makes that
   * safe to offer as the default. Naming a single target is how you pull a sewer out
   * from under a road you want to keep.
   */
  removeAt(i: number, target: RemoveTarget): boolean {
    if (target === 'road') return this.removeRoad(i);
    if (target !== 'all') return this.removeUtility(i, target);
    let removed = false;
    for (const kind of UTILITY_KINDS) removed = this.removeUtility(i, kind) || removed;
    return this.removeRoad(i) || removed;
  }

  /** Why a utility can't be laid here, for the interface to explain. */
  utilityBlockedBy(i: number, kind: UtilityKind): string | null {
    if (this.terrain.water[i]) return 'open water';
    if (this.utilityPlane(kind)[i]) return null;
    if (this.crossingBlocker(i, kind) >= 0) {
      return kind === 'sewer'
        ? 'a sewer can cross a water pipe but not run alongside it'
        : 'a water pipe can cross a sewer but not run alongside it';
    }
    return null;
  }

  /**
   * Sewers and water mains may share a tile, but only where they genuinely cross: a
   * shared tile is an intersection, never a length of shared trench. The rule that
   * expresses that locally is simply that no two shared tiles may touch — one crossing
   * is a crossing, two in a row is a sewer laid on top of the drinking supply.
   *
   * Returns the index of the neighbouring crossing that blocks this cell, or -1.
   */
  private crossingBlocker(i: number, kind: UtilityKind): number {
    if (kind === 'powerLine') return -1;
    const t = this.tiles;
    const other = kind === 'sewer' ? t.pipe : t.sewer;
    if (!other[i]) return -1; // not a crossing at all
    const { width, height } = this.grid;
    const x = i & (width - 1);
    const y = i >>> this.grid.shift;
    const shared = (n: number) => t.pipe[n] !== 0 && t.sewer[n] !== 0;
    if (x > 0 && shared(i - 1)) return i - 1;
    if (x < width - 1 && shared(i + 1)) return i + 1;
    if (y > 0 && shared(i - width)) return i - width;
    if (y < height - 1 && shared(i + width)) return i + width;
    return -1;
  }

  private utilityPlane(kind: UtilityKind): Uint8Array {
    return kind === 'powerLine' ? this.tiles.powerLine
      : kind === 'pipe' ? this.tiles.pipe
      : this.tiles.sewer;
  }

  paintZone(i: number, zone: number, density: number): boolean {
    const t = this.tiles;
    if (t.road[i] || t.civic[i] || this.terrain.water[i]) return false;
    if (t.zone[i] === zone && t.density[i] === density) return false;
    if (!this.canAfford(ZONE_COST)) return false;
    this.history.touch(t, i);
    this.spend(ZONE_COST);
    t.zone[i] = zone;
    t.density[i] = density;
    if (t.level[i] > MAX_LEVEL[density]) t.level[i] = MAX_LEVEL[density];
    this.recordChange(i);
    return true;
  }

  /** Returns the anchor index if placed, or null with a reason. */
  placeCivic(anchor: number, defId: number): { ok: boolean; error?: string } {
    const def = CIVIC_BY_ID.get(defId);
    if (!def) return { ok: false, error: 'unknown building' };
    const locked = lockReason(def, this.unlockState);
    if (locked) return { ok: false, error: locked.replace(/^Needs /, 'it needs ') };
    const { width, height } = this.grid;
    const ax = anchor & (width - 1);
    const ay = anchor >>> this.grid.shift;
    if (ax + def.size > width || ay + def.size > height) {
      return { ok: false, error: 'does not fit on the map' };
    }
    for (let y = ay; y < ay + def.size; y++) {
      for (let x = ax; x < ax + def.size; x++) {
        const i = this.grid.index(x, y);
        if (this.terrain.water[i]) return { ok: false, error: 'part of the site is under water' };
        if (this.tiles.civic[i] || this.tiles.road[i]) {
          return { ok: false, error: 'the site is occupied' };
        }
      }
    }
    if (def.needsWaterSource && !this.hasWaterSource(ax, ay, def.size)) {
      return {
        ok: false,
        error: 'it needs open water beside it, or ground with a workable water table',
      };
    }
    if (!this.canAfford(def.cost)) return { ok: false, error: `costs $${def.cost}` };
    this.spend(def.cost);
    for (let y = ay; y < ay + def.size; y++) {
      for (let x = ax; x < ax + def.size; x++) {
        const i = this.grid.index(x, y);
        this.history.touch(this.tiles, i);
        this.tiles.civic[i] = def.id;
        this.tiles.zone[i] = 0;
        this.tiles.level[i] = 0;
        this.tiles.civicAnchor[i] = 0;
        this.recordChange(i);
      }
    }
    this.tiles.civicAnchor[anchor] = 1;
    this.civicUpkeep += def.upkeep;
    if (!this.everBuilt.has(def.id)) {
      this.everBuilt.add(def.id);
      this.refreshUnlocks(true);
    }
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
    if (!this.canAfford(ROAD_REMOVE_COST)) return false;
    this.history.touch(t, i);
    this.spend(ROAD_REMOVE_COST);
    t.road[i] = 0;
    this.roadCells--;
    this.markRoadsDirty();
    return true;
  }

  /**
   * Total up disposal capacity and compare it with what the city throws away.
   *
   * There is no network to walk: trucks use the roads. So this is a sum over the
   * disposal buildings, which is why it reads the cached anchor list rather than the
   * grid. A site with no power takes nothing — the compactors and sorting lines do not
   * run on goodwill — and is named rather than silently counted, the same lesson the
   * pumps taught.
   */
  private accountWaste(): void {
    const t = this.tiles;
    let capacity = 0;
    let recycling = 0;
    const unpoweredSites: string[] = [];
    for (const i of this.wasteSites) {
      const def = CIVIC_BY_ID.get(t.civic[i]);
      if (!def?.waste) continue;
      if (!t.powered[i]) {
        if (unpoweredSites.length < 3) {
          unpoweredSites.push(`${def.label} at ${i & (this.grid.width - 1)}, ${i >>> this.grid.shift}`);
        }
        continue;
      }
      capacity += def.waste;
      if (def.source?.field === 'recycleSrc') recycling += def.waste;
    }

    const produced = this.wasteProduced;
    const overflow = isOverflowing(produced, capacity);
    this.waste = {
      produced, capacity, overflow,
      recycled: Math.min(recycling, produced),
      unpoweredSites,
    };

    // Refuse in the street is written by the source pass, which only visits cells that
    // changed — so the tick the overflow starts or stops, every developed cell needs
    // rewriting. It flips rarely, which is what makes a full rebuild affordable here.
    if (overflow !== this.wasteOverflow) {
      this.wasteOverflow = overflow;
      this.sourcesAllDirty = true;
    }
  }

  /** A pump works beside open water, or on ground with enough underground water. */
  private hasWaterSource(ax: number, ay: number, size: number): boolean {
    const { width, height } = this.grid;
    const { water, waterTable } = this.terrain;
    for (let y = ay - 1; y <= ay + size; y++) {
      for (let x = ax - 1; x <= ax + size; x++) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const i = this.grid.index(x, y);
        if (water[i]) return true;
        const inside = x >= ax && x < ax + size && y >= ay && y < ay + size;
        if (inside && waterTable[i] >= WATER_TABLE_MIN) return true;
      }
    }
    return false;
  }

  bulldoze(i: number): boolean {
    const t = this.tiles;
    const hadCivic = t.civic[i];
    if (!t.road[i] && !t.zone[i] && !t.level[i] && !hadCivic) return false;
    if (!this.canAfford(BULLDOZE_COST)) return false;
    this.spend(BULLDOZE_COST);
    this.history.touch(t, i);

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
          if (t.civic[j] === hadCivic) {
            this.history.touch(t, j);
            if (t.civicAnchor[j]) this.civicUpkeep -= def.upkeep;
            t.civic[j] = 0;
            t.civicAnchor[j] = 0;
            this.recordChange(j);
          }
        }
      }
      this.markCivicsDirty();
    }
    if (t.road[i]) { this.roadCells--; this.markRoadsDirty(); }
    if (t.powerLine[i]) { this.utilityCells.powerLine--; this.markUtilitiesDirty(); }
    if (t.pipe[i]) { this.utilityCells.pipe--; this.markUtilitiesDirty(); }
    if (t.sewer[i]) { this.utilityCells.sewer--; this.markUtilitiesDirty(); }
    t.road[i] = 0;
    t.powerLine[i] = 0;
    t.pipe[i] = 0;
    t.sewer[i] = 0;
    t.zone[i] = 0;
    t.density[i] = 0;
    t.level[i] = 0;
    t.distress[i] = 0;
    this.recordChange(i);
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

/**
 * Synthetic city generator.
 *
 * Exists so we can measure Tier 1/2/3 performance BEFORE any real content exists — the
 * rule from docs/TECH-STACK.md. It fills TILES rather than fields directly, so the
 * benchmark exercises the whole of City.step(): source updates, diffusion, power
 * distribution, growth and fire risk. Measuring the diffusion alone would flatter us.
 *
 * Deterministic from the seed.
 */
import { City } from '../sim/city.ts';
import { Rng } from '../sim/rng.ts';
import { ZONE_RES, ZONE_COM, ZONE_IND, MAX_LEVEL, CIVIC_BY_KEY } from '../sim/tiles.ts';
import { FLAT_MAP } from '../sim/terrain.ts';
import { ROAD_REACH } from '../sim/roads.ts';

export interface GeneratedCity {
  city: City;
  population: number;
  builtCells: number;
}

/** Street spacing that leaves no unserved land — the figure the manual quotes. */
const STREET_SPACING = 2 * ROAD_REACH + 1;

export function generateCity(size: number, seed = 1): GeneratedCity {
  const city = new City(size, seed, FLAT_MAP);
  const { grid, tiles } = city;
  const rng = new Rng(seed);
  const w = grid.width;

  // One downtown per ~250k cells, so bigger grids get polycentric cities rather than one
  // enormous blob — which is what a real metropolis looks like and what stresses the
  // diffusion hardest, with many overlapping gradients.
  const centreCount = Math.max(1, Math.round(grid.size / 250_000));
  const centres: Array<{ x: number; y: number; r: number }> = [];
  for (let i = 0; i < centreCount; i++) {
    centres.push({ x: rng.int(w), y: rng.int(grid.height), r: rng.range(w * 0.10, w * 0.28) });
  }

  const densityAt = (x: number, y: number): number => {
    let d = 0;
    for (const c of centres) {
      const dx = x - c.x;
      const dy = y - c.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < c.r) {
        const v = 1 - dist / c.r;
        if (v > d) d = v;
      }
    }
    return d;
  };

  // Street grid.
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < w; x++) {
      if (x % STREET_SPACING !== 0 && y % STREET_SPACING !== 0) continue;
      if (densityAt(x, y) <= 0.02) continue;
      tiles.road[grid.index(x, y)] = 1;
    }
  }

  let population = 0;
  let builtCells = 0;

  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < w; x++) {
      const i = grid.index(x, y);
      if (tiles.road[i]) continue;
      const d = densityAt(x, y);
      if (d <= 0.02) continue;
      if (rng.next() > d * 0.85) continue;

      const den = d > 0.66 ? 2 : d > 0.33 ? 1 : 0;
      const roll = rng.next();
      // Industry is ~7% of built area: at 15% its plume blankets the map and every
      // other field stops mattering.
      const zone = roll < 0.58 ? ZONE_RES : roll < 0.93 ? ZONE_COM : ZONE_IND;
      tiles.zone[i] = zone;
      tiles.density[i] = den;
      tiles.level[i] = 1 + rng.int(MAX_LEVEL[den]);
      builtCells++;
      if (zone === ZONE_RES) population += tiles.level[i] * (den + 1) * 6;
    }
  }

  // Enough generation to keep the lights on, plus scattered services.
  //
  // Sizing this from actual demand matters: an under-powered fixture browns out, every
  // building in the city declines every tick, and the benchmark then measures a
  // pathological churn no real city would ever be in.
  const plant = CIVIC_BY_KEY.get('power')!;
  city.peakPopulation = 1_000_000;
  city.funds = 1e9;
  city.refreshUnlocks();

  let demand = 0;
  for (let i = 0; i < tiles.level.length; i++) demand += tiles.level[i] * 3;
  const wanted = Math.ceil((demand * 1.25) / plant.supply!);

  // Space them on a lattice wide enough that footprints never collide.
  const step = Math.max(plant.size + 2, Math.floor(w / Math.ceil(Math.sqrt(wanted))));
  let placed = 0;
  for (let y = 2; y + plant.size < grid.height && placed < wanted; y += step) {
    for (let x = 2; x + plant.size < w && placed < wanted; x += step) {
      // Clear the footprint first: on a street grid an arbitrary lattice point almost
      // always lands on a road, and silently failing placements left the fixture
      // browned out and churning.
      for (let dy = 0; dy < plant.size; dy++) {
        for (let dx = 0; dx < plant.size; dx++) {
          const i = grid.index(x + dx, y + dy);
          tiles.road[i] = 0;
          tiles.zone[i] = 0;
          tiles.level[i] = 0;
        }
      }
      if (city.placeCivic(grid.index(x, y), plant.id).ok) placed++;
    }
  }
  // Services on their own lattice, footprints cleared first for the same reason. A
  // benchmark should model a competently-built city: an unserviced one burns constantly,
  // and then it measures the cost of a permanent disaster rather than of playing.
  for (const key of ['police', 'fire', 'school', 'park', 'metro']) {
    const def = CIVIC_BY_KEY.get(key)!;
    const count = Math.max(1, Math.round(builtCells / 2500));
    const sstep = Math.max(def.size + 2, Math.floor(w / Math.ceil(Math.sqrt(count))));
    let n = 0;
    for (let y = 6; y + def.size < grid.height && n < count; y += sstep) {
      for (let x = 6; x + def.size < w && n < count; x += sstep) {
        for (let dy = 0; dy < def.size; dy++) {
          for (let dx = 0; dx < def.size; dx++) {
            const i = grid.index(x + dx, y + dy);
            tiles.road[i] = 0;
            tiles.zone[i] = 0;
            tiles.level[i] = 0;
          }
        }
        if (city.placeCivic(grid.index(x, y), def.id).ok) n++;
      }
    }
  }

  return { city, population: Math.round(population), builtCells };
}

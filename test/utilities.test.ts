import { test } from 'node:test';
import assert from 'node:assert/strict';
import { City, TICKS_PER_MONTH, CONDITION_TTL } from '../src/sim/city.ts';
import { FLAT_MAP, WATER_TABLE_MIN } from '../src/sim/terrain.ts';
import { UTILITY_REACH } from '../src/sim/utility.ts';
import { ZONE_RES, ZONE_COM, ZONE_IND, CIVIC_BY_KEY } from '../src/sim/tiles.ts';
import { REASON } from '../src/sim/growth.ts';
import { serialize, deserialize, SAVE_VERSION, backfillLegacyPower } from '../src/sim/save.ts';
import { wireUtilities } from './helpers.ts';

const plant = CIVIC_BY_KEY.get('power')!;
const pump = CIVIC_BY_KEY.get('pump')!;

/** Roads and zoning, but no utilities at all. */
function bareCity(): City {
  const c = new City(128, 1, FLAT_MAP);
  const g = c.grid;
  c.funds = 500_000;
  c.setDisasters(false);
  for (let x = 8; x < 110; x++) c.buildRoad(g.index(x, 40));
  for (let y = 12; y < 40; y++) c.buildRoad(g.index(100, y));
  c.placeCivic(g.index(98, 8), plant.id);
  for (let y = 37; y < 40; y++) for (let x = 20; x < 55; x++) c.paintZone(g.index(x, y), ZONE_RES, 0);
  // Jobs as well as houses: a residential-only city stalls at about sixty people
  // because nobody has anywhere to work, which is the demand model behaving correctly.
  for (let y = 41; y < 44; y++) for (let x = 20; x < 55; x++) c.paintZone(g.index(x, y), ZONE_COM, 0);
  for (let y = 41; y < 44; y++) for (let x = 60; x < 90; x++) c.paintZone(g.index(x, y), ZONE_IND, 0);
  // Services too: without them desirability never clears the bar to densify, and the
  // city stalls for reasons that have nothing to do with utilities.
  c.placeCivic(g.index(30, 34), CIVIC_BY_KEY.get('police')!.id);
  c.placeCivic(g.index(45, 34), CIVIC_BY_KEY.get('park')!.id);
  return c;
}

test('roads alone no longer carry power', () => {
  // The whole point of the change: power is a network you build, not a side effect of
  // paving. A city with roads and a plant but no lines stays dark.
  const c = bareCity();
  for (let t = 0; t < 80; t++) c.step();
  assert.equal(c.stats.population, 0);
  assert.equal(c.reason[c.grid.index(30, 38)], REASON.NO_POWER);
});

test('a line from the plant lights the city, water permitting', () => {
  const c = bareCity();
  const g = c.grid;
  for (let i = 0; i < c.tiles.road.length; i++) if (c.tiles.road[i]) c.buildUtility(i, 'powerLine');
  for (let t = 0; t < 40; t++) c.step();
  assert.equal(c.tiles.powered[g.index(30, 38)], 1, 'the line should reach the zoning');
  // But nothing grows yet: there is still no water.
  assert.equal(c.reason[g.index(30, 38)], REASON.NO_WATER);
  assert.equal(c.stats.population, 0);
});

test('a pump and pipes complete the city', () => {
  const c = bareCity();
  wireUtilities(c);
  for (let t = 0; t < 200; t++) c.step();
  assert.ok(c.water.supply > 0, 'the pump should be supplying water');
  assert.ok(c.stats.population > 200, `expected growth, got ${c.stats.population}`);
});

test('utilities reach exactly as far as roads do', () => {
  const c = new City(128, 1, FLAT_MAP);
  c.funds = 500_000;
  const g = c.grid;
  for (let x = 8; x < 110; x++) { c.buildRoad(g.index(x, 40)); c.buildUtility(g.index(x, 40), 'powerLine'); }
  c.placeCivic(g.index(50, 36), plant.id);
  c.step();
  for (let d = 1; d <= UTILITY_REACH; d++) {
    assert.equal(c.tiles.powered[g.index(20, 40 + d)], 1, `cell ${d} from the line should be powered`);
  }
  assert.equal(c.tiles.powered[g.index(20, 40 + UTILITY_REACH + 1)], 0, 'and no further');
});

test('lines and pipes share a tile with the road above them', () => {
  const c = new City(128, 1, FLAT_MAP);
  c.funds = 100_000;
  const i = c.grid.index(30, 30);
  assert.ok(c.buildRoad(i));
  assert.ok(c.buildUtility(i, 'powerLine'), 'a line should be layable under a road');
  assert.ok(c.buildUtility(i, 'pipe'), 'so should a pipe');
  assert.equal(c.tiles.road[i], 1);
  assert.equal(c.tiles.powerLine[i], 1);
  assert.equal(c.tiles.pipe[i], 1);
  // And laying the same thing twice is a no-op, not a second charge.
  const funds = c.funds;
  assert.equal(c.buildUtility(i, 'pipe'), false);
  assert.equal(c.funds, funds);
});

test('nothing can be laid across open water', () => {
  const c = new City(128, 1, 7);
  c.funds = 100_000;
  let wet = -1;
  for (let i = 0; i < c.terrain.water.length; i++) if (c.terrain.water[i]) { wet = i; break; }
  assert.ok(wet >= 0);
  assert.equal(c.buildUtility(wet, 'powerLine'), false);
  assert.equal(c.buildUtility(wet, 'pipe'), false);
});

test('a pump needs open water or a workable water table', () => {
  const c = new City(128, 1, 7);
  c.funds = 500_000;
  const { water, waterTable } = c.terrain;

  // Somewhere dry and dead: no water beside it and nothing underneath.
  let barren = -1;
  for (let i = 0; i < waterTable.length && barren < 0; i++) {
    const x = i & 127;
    const y = i >>> 7;
    if (x < 2 || y < 2 || x > 120 || y > 120) continue;
    let ok = waterTable[i] < WATER_TABLE_MIN;
    for (let dy = -1; dy <= pump.size && ok; dy++) {
      for (let dx = -1; dx <= pump.size && ok; dx++) {
        const j = c.grid.index(x + dx, y + dy);
        if (water[j]) ok = false;
        if (dx >= 0 && dy >= 0 && dx < pump.size && dy < pump.size && waterTable[j] >= WATER_TABLE_MIN) ok = false;
      }
    }
    if (ok) barren = i;
  }
  assert.ok(barren >= 0, 'expected some barren ground on this map');
  const r = c.placeCivic(barren, pump.id);
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /water table|open water/);

  // And beside open water it works.
  let shore = -1;
  for (let i = 0; i < c.terrain.shore.length && shore < 0; i++) {
    const x = i & 127;
    const y = i >>> 7;
    if (c.terrain.shore[i] && x > 2 && y > 2 && x < 120 && y < 120) shore = i;
  }
  assert.ok(shore >= 0);
  assert.equal(c.placeCivic(shore, pump.id).ok, true);
});

test('a flat map can always be pumped', () => {
  // Otherwise a water-free map would be unplayable.
  const c = new City(128, 1, FLAT_MAP);
  c.funds = 100_000;
  assert.equal(c.placeCivic(c.grid.index(40, 40), pump.id).ok, true);
});

test('cutting the line strands the city, and it recovers when relaid', () => {
  const c = bareCity();
  wireUtilities(c);
  for (let t = 0; t < 200; t++) c.step();
  const peak = c.stats.population;
  assert.ok(peak > 200);

  // Sever every line on the spur that feeds the city from the plant.
  for (let y = 12; y < 40; y++) c.removeUtility(c.grid.index(100, y), 'powerLine');
  for (let t = 0; t < 250; t++) c.step();
  assert.ok(c.stats.population < peak * 0.5, `expected a collapse, went ${peak} -> ${c.stats.population}`);

  for (let y = 12; y < 40; y++) c.buildUtility(c.grid.index(100, y), 'powerLine');
  for (let t = 0; t < 250; t++) c.step();
  assert.ok(c.stats.population > peak * 0.7, 'relaying the line should bring it back');
});

test('utilities survive a save round trip', () => {
  const c = bareCity();
  wireUtilities(c);
  for (let t = 0; t < 60; t++) c.step();
  const restored = deserialize(serialize(c)).city;
  assert.deepEqual(Array.from(restored.tiles.powerLine), Array.from(c.tiles.powerLine));
  assert.deepEqual(Array.from(restored.tiles.pipe), Array.from(c.tiles.pipe));
  restored.step();
  assert.equal(restored.power.supply, c.power.supply);
  assert.equal(restored.water.supply, c.water.supply);
});

test('a pre-utility save keeps its lights on', () => {
  // Before v6 the roads themselves carried power, so loading such a city must not black
  // it out. The migration is tested directly rather than by forging an old file: the
  // point is the rule, not the byte layout of a version that no longer exists.
  const c = bareCity();
  assert.ok(SAVE_VERSION >= 6);
  let roads = 0;
  for (let i = 0; i < c.tiles.road.length; i++) if (c.tiles.road[i]) roads++;
  assert.ok(roads > 100);

  backfillLegacyPower(c.tiles);
  for (let i = 0; i < c.tiles.road.length; i++) {
    if (c.tiles.road[i]) assert.equal(c.tiles.powerLine[i], 1, 'every road should get a line');
  }
  c.markUtilitiesDirty();
  for (let t = 0; t < 20; t++) c.step();
  assert.equal(c.tiles.powered[c.grid.index(30, 38)], 1, 'the old city should still have power');
  // Water is intentionally not back-filled — the player is told, not silently exempted.
  assert.equal(c.tiles.watered[c.grid.index(30, 38)], 0);
});

test('an unattached pump is reported, not left to be guessed at', () => {
  // A source counts toward supply whether or not anything is connected to it, so an
  // isolated pump leaves the readout looking healthy — "0 / 2400" — while nothing at
  // all is watered. That is the most confusing state the system can produce.
  const c = new City(128, 1, FLAT_MAP);
  c.funds = 1_000_000;
  assert.ok(c.placeCivic(c.grid.index(40, 40), pump.id).ok);
  // Powered, so the ONLY thing wrong is that nothing is piped to it.
  assert.ok(c.placeCivic(c.grid.index(40, 46), plant.id).ok);
  for (let y = 41; y < 46; y++) c.buildUtility(c.grid.index(40, y), 'powerLine');
  c.step();
  c.step();
  assert.equal(c.water.supply, 2400, 'a powered pump still counts toward supply');
  assert.equal(c.water.isolatedSources.length, 1, 'but the pump should be reported as unattached');
  assert.deepEqual(c.water.isolatedSources[0], { x: 40, y: 40 });

  // Touch a pipe to its footprint and the complaint stops.
  c.buildUtility(c.grid.index(42, 40), 'pipe');
  c.step();
  assert.equal(c.water.isolatedSources.length, 0);
});

test('an unattached power plant is reported too', () => {
  const c = new City(128, 1, FLAT_MAP);
  c.funds = 1_000_000;
  assert.ok(c.placeCivic(c.grid.index(30, 30), plant.id).ok);
  c.step();
  assert.equal(c.power.isolatedSources.length, 1);
  c.buildUtility(c.grid.index(34, 30), 'powerLine');
  c.step();
  assert.equal(c.power.isolatedSources.length, 0);
});

test('a connected pump actually supplies the far end of its pipe', () => {
  const c = new City(128, 1, FLAT_MAP);
  c.funds = 1_000_000;
  assert.ok(c.placeCivic(c.grid.index(40, 40), pump.id).ok);
  for (let x = 42; x < 70; x++) c.buildUtility(c.grid.index(x, 40), 'pipe');
  c.step();
  assert.equal(c.tiles.watered[c.grid.index(69, 41)], 1, 'water should reach the end of the run');
  assert.equal(c.tiles.watered[c.grid.index(69, 40 + UTILITY_REACH + 1)], 0, 'and no further than the reach');
});

test('a standing complaint clears once the problem is fixed', () => {
  // Being told the pump has no pipe AFTER attaching one is worse than not being told,
  // so condition warnings expire far faster than one-off events.
  const c = new City(128, 1, FLAT_MAP);
  c.funds = 1_000_000;
  c.setDisasters(false);
  c.placeCivic(c.grid.index(40, 40), pump.id);
  for (let t = 0; t < TICKS_PER_MONTH * 2; t++) c.step();
  assert.ok(
    c.activeMessages(5).some((m) => /no pipe attached/.test(m)),
    'the unattached pump should be reported',
  );

  c.buildUtility(c.grid.index(42, 40), 'pipe');
  for (let t = 0; t < CONDITION_TTL + TICKS_PER_MONTH; t++) c.step();
  assert.ok(
    !c.activeMessages(5).some((m) => /no pipe attached/.test(m)),
    'and the complaint should be gone shortly after it is fixed',
  );
});

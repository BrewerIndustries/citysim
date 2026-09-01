import { test } from 'node:test';
import assert from 'node:assert/strict';
import { City, TICKS_PER_MONTH } from '../src/sim/city.ts';
import { FLAT_MAP } from '../src/sim/terrain.ts';
import { ACHIEVEMENTS } from '../src/sim/achievements.ts';
import { CIVIC_BY_KEY, ZONE_RES } from '../src/sim/tiles.ts';
import { serialize, deserialize } from '../src/sim/save.ts';

const months = (c: City, n: number) => { for (let t = 0; t < TICKS_PER_MONTH * n; t++) c.step(); };

test('achievement ids are unique and every one is described', () => {
  const ids = ACHIEVEMENTS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate achievement id');
  for (const a of ACHIEVEMENTS) {
    assert.ok(a.name.length > 2, `${a.id} has no name`);
    assert.ok(a.description.length > 10, `${a.id} has no usable description`);
    assert.ok(a.description.endsWith('.'), `${a.id} description should read as a sentence`);
  }
});

test('a new city has earned nothing', () => {
  const c = new City(128, 1, FLAT_MAP);
  assert.equal(c.earned.size, 0);
});

test('population milestones are earned by growing', () => {
  const c = new City(256, 1, FLAT_MAP);
  const g = c.grid;
  c.funds = 5_000_000;
  c.setDisasters(false);
  for (let y = 8; y < 200; y += 7) for (let x = 8; x < 200; x++) c.buildRoad(g.index(x, y));
  for (let x = 8; x < 200; x += 7) for (let y = 8; y < 200; y++) c.buildRoad(g.index(x, y));
  // The plant must actually touch the street grid: x=99 is one of the avenues, so run
  // it up to the top of the map and butt the plant against it.
  for (let y = 2; y < 8; y++) c.buildRoad(g.index(99, y));
  c.placeCivic(g.index(95, 2), CIVIC_BY_KEY.get('power')!.id);
  for (let y = 9; y < 199; y++) for (let x = 9; x < 199; x++) c.paintZone(g.index(x, y), ZONE_RES, 2);
  months(c, 60);
  assert.ok(c.stats.population >= 1000, `only reached ${c.stats.population}`);
  assert.ok(c.earned.has('pop-1k'), 'should have earned the 1,000-resident achievement');
});

test('achievements are never un-earned when the city shrinks', () => {
  const c = new City(128, 1, FLAT_MAP);
  c.earned.add('pop-1k');
  c.stats.population = 0;
  months(c, 3);
  assert.ok(c.earned.has('pop-1k'), 'an achievement must survive a collapse');
});

test('building-based achievements fire on construction', () => {
  const c = new City(128, 1, FLAT_MAP);
  c.funds = 5_000_000;
  c.peakPopulation = 1_000_000;
  c.refreshUnlocks();
  assert.ok(!c.earned.has('wind'));
  c.placeCivic(c.grid.index(20, 20), CIVIC_BY_KEY.get('wind')!.id);
  months(c, 2);
  assert.ok(c.earned.has('wind'), 'building a turbine should be recognised');
});

test('the treasury achievement needs the money actually held', () => {
  const c = new City(128, 1, FLAT_MAP);
  c.setDisasters(false);
  c.funds = 999_000;
  months(c, 2);
  assert.ok(!c.earned.has('millionaire'));
  c.funds = 1_000_000;
  months(c, 2);
  assert.ok(c.earned.has('millionaire'));
});

test('earned achievements survive a save round trip, matched by id', () => {
  const c = new City(128, 1, FLAT_MAP);
  c.earned.add('pop-1k');
  c.earned.add('wind');
  c.wasBankrupt = true;
  c.consecutiveSurplusMonths = 31;

  const restored = deserialize(serialize(c)).city;
  assert.deepEqual([...restored.earned].sort(), ['pop-1k', 'wind']);
  assert.equal(restored.wasBankrupt, true);
  assert.equal(restored.consecutiveSurplusMonths, 31);
});

test('a surplus streak resets when a month goes into deficit', () => {
  const c = new City(128, 1, FLAT_MAP);
  c.setDisasters(false);
  c.funds = 100_000;
  // No income and no costs: net is zero, which is not a surplus.
  months(c, 4);
  assert.equal(c.consecutiveSurplusMonths, 0);
});

test('the whole achievement list can be evaluated without throwing', () => {
  // Predicates run against live state every month; one that throws would take the
  // simulation down mid-game.
  const c = new City(128, 1, FLAT_MAP);
  c.funds = 5_000_000;
  c.peakPopulation = 1_000_000;
  c.refreshUnlocks();
  for (const key of ['power', 'wind', 'metro', 'school', 'police', 'park']) {
    c.placeCivic(c.grid.index(10 + [...c.everBuilt].length * 8, 10), CIVIC_BY_KEY.get(key)!.id);
  }
  months(c, 6);
  assert.ok(c.earned.size >= 1);
});

test('predicates survive a full-size map', () => {
  // Regression: the 'topping out' check was Math.max(...tiles.level), which spreads one
  // argument per cell. At the 128x128 size the other tests use that survived; on a real
  // 256x256 map it overflowed the call stack and killed the simulation worker outright,
  // with the city frozen at Jan 1950 and no error visible in the game itself.
  const c = new City(512, 1, FLAT_MAP);
  c.funds = 5_000_000;
  c.peakPopulation = 1_000_000;
  c.refreshUnlocks();
  c.tiles.level[c.grid.index(100, 100)] = 6;
  c.tiles.zone[c.grid.index(100, 100)] = ZONE_RES;
  months(c, 2);
  assert.ok(c.earned.has('skyscraper'), 'the level-6 check must work at map scale');
});

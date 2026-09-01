import { test } from 'node:test';
import assert from 'node:assert/strict';
import { City, MESSAGE_TTL } from '../src/sim/city.ts';
import { ZONE_RES, ZONE_COM, ZONE_IND } from '../src/sim/tiles.ts';
import { REASON, requiredDesirability } from '../src/sim/growth.ts';
import { LAND_VALUE_BASE, LAND_VALUE_TERMS } from '../src/sim/sim.ts';
import { anchorFor } from '../src/app/tools.ts';

/** A small city with power, a road spine and zoning either side of it. */
function buildTestCity(size = 128): City {
  const c = new City(size, 1);
  const g = c.grid;
  for (let x = 8; x < 110; x++) c.buildRoad(g.index(x, 40));
  for (let y = 30; y < 40; y++) c.buildRoad(g.index(12, y));
  c.placeCivic(g.index(10, 26), 5); // power plant
  for (let y = 37; y < 40; y++) for (let x = 20; x < 55; x++) c.paintZone(g.index(x, y), ZONE_RES, 0);
  for (let y = 41; y < 44; y++) for (let x = 20; x < 55; x++) c.paintZone(g.index(x, y), ZONE_COM, 0);
  for (let y = 41; y < 44; y++) for (let x = 65; x < 100; x++) c.paintZone(g.index(x, y), ZONE_IND, 0);
  c.placeCivic(g.index(30, 34), 1); // police
  c.placeCivic(g.index(45, 34), 4); // park
  return c;
}

test('a zoned, powered, road-served city actually grows', () => {
  const c = buildTestCity();
  assert.equal(c.stats.population, 0);
  for (let t = 0; t < 200; t++) c.step();
  assert.ok(c.stats.population > 300, `expected growth, got ${c.stats.population}`);
  assert.ok(c.stats.jobsC > 0 && c.stats.jobsI > 0, 'commerce and industry should develop');
});

test('growth reaches equilibrium instead of oscillating', () => {
  // Regression: growth once required desirability >= 0 while decline began below 4, so
  // cells in that band grew and decayed forever and population swung ~20% indefinitely.
  const c = buildTestCity();
  for (let t = 0; t < 250; t++) c.step();
  const samples: number[] = [];
  for (let t = 0; t < 150; t++) { c.step(); samples.push(c.stats.population); }
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  assert.ok(max - min <= max * 0.05, `population oscillated between ${min} and ${max}`);
});

test('decline and growth thresholds do not overlap', () => {
  // The invariant that fixes the oscillation, asserted directly.
  assert.ok(requiredDesirability(0) > 3, 'growth floor must sit above the decline threshold');
});

test('no road means no development, and the reason says so', () => {
  const c = new City(128, 1);
  const g = c.grid;
  c.placeCivic(g.index(10, 10), 5);
  for (let y = 60; y < 64; y++) for (let x = 60; x < 64; x++) c.paintZone(g.index(x, y), ZONE_RES, 0);
  for (let t = 0; t < 60; t++) c.step();
  assert.equal(c.stats.population, 0);
  assert.equal(c.reason[g.index(62, 62)], REASON.NO_ROAD);
});

test('power reaches as far as road access does', () => {
  // Regression: power used to spread only to cells directly ADJACENT to a road, while
  // road access allowed 3 cells, so two thirds of every zoned block was undevelopable.
  const c = new City(128, 1);
  const g = c.grid;
  for (let x = 8; x < 100; x++) c.buildRoad(g.index(x, 40));
  for (let y = 30; y < 40; y++) c.buildRoad(g.index(12, y));
  c.placeCivic(g.index(10, 26), 5);
  c.step();
  for (let d = 1; d <= 3; d++) {
    assert.equal(c.tiles.powered[g.index(50, 40 + d)], 1, `cell ${d} from the road should be powered`);
  }
});

test('cutting the road supply strands the grid', () => {
  const c = buildTestCity();
  for (let t = 0; t < 200; t++) c.step();
  const before = c.stats.population;
  assert.ok(before > 0);
  // Sever the spur that connects the power plant to the city.
  for (let y = 30; y < 40; y++) c.bulldoze(c.grid.index(12, y));
  for (let t = 0; t < 250; t++) c.step();
  assert.ok(c.stats.population < before * 0.5, `expected collapse, went ${before} -> ${c.stats.population}`);
});

test('bulldozing a civic building removes its whole footprint', () => {
  const c = new City(128, 1);
  const g = c.grid;
  c.placeCivic(g.index(20, 20), 5); // 4x4
  let occupied = 0;
  for (let i = 0; i < c.tiles.civic.length; i++) if (c.tiles.civic[i] === 5) occupied++;
  assert.equal(occupied, 16);
  c.bulldoze(g.index(22, 22)); // not the anchor
  occupied = 0;
  for (let i = 0; i < c.tiles.civic.length; i++) if (c.tiles.civic[i] === 5) occupied++;
  assert.equal(occupied, 0, 'the whole 4x4 footprint should be cleared');
});

test('civic buildings cannot overlap and refunds are not given for failures', () => {
  const c = new City(128, 1);
  const g = c.grid;
  assert.ok(c.placeCivic(g.index(20, 20), 5).ok);
  const funds = c.funds;
  const second = c.placeCivic(g.index(21, 21), 5);
  assert.equal(second.ok, false);
  assert.equal(c.funds, funds, 'a rejected placement must not charge the player');
});

test('taxes change demand in the expected direction', () => {
  const low = buildTestCity();
  low.tax = { r: 4, c: 4, i: 4 };
  const high = buildTestCity();
  high.tax = { r: 19, c: 19, i: 19 };
  for (let t = 0; t < 150; t++) { low.step(); high.step(); }
  assert.ok(
    high.stats.population < low.stats.population,
    `punitive tax should suppress growth: ${high.stats.population} vs ${low.stats.population}`,
  );
});

test('the city is deterministic end to end', () => {
  const run = () => {
    const c = buildTestCity();
    for (let t = 0; t < 120; t++) c.step();
    return `${c.stats.population}/${c.stats.jobsC}/${c.stats.jobsI}/${Math.round(c.funds)}/${c.sim.hash()}`;
  };
  assert.equal(run(), run());
});

test('the Why Panel terms reproduce land value exactly', () => {
  // The panel renders LAND_VALUE_TERMS; deriveLandValue() is a hand-unrolled loop for
  // speed. If the two ever diverge the game would explain itself incorrectly, which is
  // worse than not explaining itself at all. Pin them together.
  const c = buildTestCity();
  for (let t = 0; t < 120; t++) c.step();
  const lv = c.fields.get('landValue');

  let checked = 0;
  for (let i = 0; i < lv.length; i += 997) {
    let sum = LAND_VALUE_BASE;
    for (const term of LAND_VALUE_TERMS) {
      sum += c.fields.get(term.field as never)[i] * term.weight;
    }
    const expected = Math.max(0, Math.min(255, sum));
    assert.ok(
      Math.abs(expected - lv[i]) < 0.001,
      `cell ${i}: panel terms give ${expected.toFixed(3)}, sim stored ${lv[i].toFixed(3)}`,
    );
    checked++;
  }
  assert.ok(checked > 10);
});

test('a modest starter city can pay for itself', () => {
  // The first power plant is mandatory before anything develops, so its upkeep sets the
  // floor on a viable city. Regression: at $400/mo the opening town ran a permanent
  // deficit and went bankrupt before it could grow into the bill.
  const c = buildTestCity();
  for (let t = 0; t < 400; t++) c.step();
  assert.ok(c.stats.population > 200, `too small to judge: ${c.stats.population}`);
  assert.ok(
    c.ledger.net > 0,
    `a city of ${c.stats.population} with one plant and two services should break even, ` +
    `net was ${c.ledger.net.toFixed(0)}/mo`,
  );
  assert.ok(c.funds > 0, `went bankrupt: ${Math.round(c.funds)}`);
});

test('removing a road leaves zoning and buildings intact', () => {
  // Bulldoze levels everything on the tile; lifting a road should only lift the road,
  // so rerouting a street doesn't wipe the neighbourhood beside it.
  const c = buildTestCity();
  for (let t = 0; t < 200; t++) c.step();
  const g = c.grid;
  const zoned = g.index(30, 38);
  assert.ok(c.tiles.zone[zoned] > 0 && c.tiles.level[zoned] > 0, 'expected a developed tile');

  const road = g.index(30, 40);
  assert.equal(c.tiles.road[road], 1);
  assert.equal(c.removeRoad(road), true);
  assert.equal(c.tiles.road[road], 0);
  assert.ok(c.tiles.zone[zoned] > 0, 'zoning beside the road must survive');
  assert.ok(c.tiles.level[zoned] > 0, 'the building beside the road must survive');

  // And it must not remove anything that isn't a road.
  assert.equal(c.removeRoad(zoned), false);
  assert.ok(c.tiles.level[zoned] > 0);
});

test('ticker messages expire instead of sticking forever', () => {
  const c = buildTestCity();
  c.pushMessage('transient complaint');
  assert.deepEqual(c.activeMessages(), ['transient complaint']);
  for (let t = 0; t < MESSAGE_TTL + 5; t++) c.step();
  assert.deepEqual(c.activeMessages(), [], 'a stale message should drop out of the ticker');
});

test('a centred footprint anchors where the preview is drawn', () => {
  // Regression: the brush rect was drawn centred on the cursor while placeCivic anchored
  // at the top-left, so odd/large buildings landed a tile down-right of the highlight.
  for (const size of [1, 2, 3, 4]) {
    const a = anchorFor(50, 50, size);
    const half = (size - 1) >> 1;
    assert.equal(a.x, 50 - half, `size ${size} anchor x`);
    assert.equal(a.y, 50 - half, `size ${size} anchor y`);
  }
  // And placing at that anchor must occupy the previewed square.
  const c = new City(128, 1);
  const a = anchorFor(60, 60, 4);
  assert.ok(c.placeCivic(c.grid.index(a.x, a.y), 5).ok);
  for (let y = 59; y <= 62; y++) {
    for (let x = 59; x <= 62; x++) {
      assert.equal(c.tiles.civic[c.grid.index(x, y)], 5, `cell ${x},${y} should be inside the plant`);
    }
  }
});

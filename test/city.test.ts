import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wireUtilities } from './helpers.ts';
import { FLAT_MAP } from '../src/sim/terrain.ts';
import { City, MESSAGE_TTL, TICKS_PER_MONTH } from '../src/sim/city.ts';
import { SERIES, HISTORY_LIMIT } from '../src/sim/history-series.ts';
import { ZONE_RES, ZONE_COM, ZONE_IND, CIVIC_DEFS } from '../src/sim/tiles.ts';
import { REASON, requiredDesirability } from '../src/sim/growth.ts';
import { LAND_VALUE_BASE, LAND_VALUE_TERMS } from '../src/sim/sim.ts';
import { anchorFor } from '../src/app/tools.ts';
import { ROAD_REACH } from '../src/sim/roads.ts';

/** A small city with power, a road spine and zoning either side of it. */
function buildTestCity(size = 128): City {
  const c = new City(size, 1, FLAT_MAP);
  const g = c.grid;
  for (let x = 8; x < 110; x++) c.buildRoad(g.index(x, 40));
  // The coal plant now smokes, so it goes at the far end of the map rather than next
  // to the housing — which is exactly the siting decision the game asks the player to
  // make. Parking it beside the zoning cost this city a third of its population.
  for (let y = 12; y < 40; y++) c.buildRoad(g.index(100, y));
  c.placeCivic(g.index(98, 8), 5);
  for (let y = 37; y < 40; y++) for (let x = 20; x < 55; x++) c.paintZone(g.index(x, y), ZONE_RES, 0);
  for (let y = 41; y < 44; y++) for (let x = 20; x < 55; x++) c.paintZone(g.index(x, y), ZONE_COM, 0);
  for (let y = 41; y < 44; y++) for (let x = 65; x < 100; x++) c.paintZone(g.index(x, y), ZONE_IND, 0);
  c.placeCivic(g.index(30, 34), 1); // police
  c.placeCivic(g.index(45, 34), 4); // park
  wireUtilities(c);
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
  const c = new City(128, 1, FLAT_MAP);
  const g = c.grid;
  c.placeCivic(g.index(10, 10), 5);
  for (let y = 60; y < 64; y++) for (let x = 60; x < 64; x++) c.paintZone(g.index(x, y), ZONE_RES, 0);
  wireUtilities(c);
  for (let t = 0; t < 60; t++) c.step();
  assert.equal(c.stats.population, 0);
  assert.equal(c.reason[g.index(62, 62)], REASON.NO_ROAD);
});

test('power reaches as far as road access does', () => {
  // Regression: power used to spread only to cells directly ADJACENT to a road, while
  // road access allowed 3 cells, so two thirds of every zoned block was undevelopable.
  const c = new City(128, 1, FLAT_MAP);
  const g = c.grid;
  for (let x = 8; x < 100; x++) c.buildRoad(g.index(x, 40));
  for (let y = 30; y < 40; y++) c.buildRoad(g.index(12, y));
  c.placeCivic(g.index(10, 26), 5);
  wireUtilities(c);
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
  for (let y = 12; y < 40; y++) c.bulldoze(c.grid.index(100, y));
  for (let t = 0; t < 250; t++) c.step();
  assert.ok(c.stats.population < before * 0.5, `expected collapse, went ${before} -> ${c.stats.population}`);
});

test('bulldozing a civic building removes its whole footprint', () => {
  const c = new City(128, 1, FLAT_MAP);
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
  const c = new City(128, 1, FLAT_MAP);
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
  c.setDisasters(false); // fires post their own messages; isolate what's under test
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
  const c = new City(128, 1, FLAT_MAP);
  const a = anchorFor(60, 60, 4);
  assert.ok(c.placeCivic(c.grid.index(a.x, a.y), 5).ok);
  for (let y = 59; y <= 62; y++) {
    for (let x = 59; x <= 62; x++) {
      assert.equal(c.tiles.civic[c.grid.index(x, y)], 5, `cell ${x},${y} should be inside the plant`);
    }
  }
});

test('parallel roads 2*ROAD_REACH+1 apart leave no unserved land', () => {
  // This is the number the manual quotes as the ideal street spacing, so it has to be
  // measured rather than asserted in prose. A road serves ROAD_REACH tiles each side,
  // so roads 2*ROAD_REACH+1 apart give contiguous coverage with nothing wasted.
  const ideal = 2 * ROAD_REACH + 1;
  const c = new City(128, 1, FLAT_MAP);
  const g = c.grid;
  for (let y = 10; y < 118; y++) {
    c.buildRoad(g.index(40, y));
    c.buildRoad(g.index(40 + ideal, y));
  }
  c.step();
  for (let y = 20; y < 100; y++) {
    for (let x = 40; x <= 40 + ideal; x++) {
      assert.ok(
        c.tiles.roadDist[g.index(x, y)] <= ROAD_REACH,
        `cell ${x},${y} is ${c.tiles.roadDist[g.index(x, y)]} from a road, beyond ${ROAD_REACH}`,
      );
    }
  }

  // One tile further apart and a dead strip appears — which is the mistake the manual
  // is warning against.
  const d = new City(128, 1, FLAT_MAP);
  for (let y = 10; y < 118; y++) {
    d.buildRoad(d.grid.index(40, y));
    d.buildRoad(d.grid.index(41 + ideal, y));
  }
  d.step();
  let unserved = 0;
  for (let y = 20; y < 100; y++) {
    for (let x = 40; x <= 41 + ideal; x++) {
      if (d.tiles.roadDist[d.grid.index(x, y)] > ROAD_REACH) unserved++;
    }
  }
  assert.ok(unserved > 0, 'spacing one wider than ideal should strand some land');
});

test('transit buildings raise transit access and land value', () => {
  // Regression: transitAccess is the second-strongest positive term in land value, but
  // nothing buildable wrote transitSrc — only the benchmark fixture did. Transit stops
  // existed in the field model and nowhere in the game.
  const c = new City(128, 1, FLAT_MAP);
  const g = c.grid;
  for (let x = 20; x < 100; x++) c.buildRoad(g.index(x, 40));
  c.placeCivic(g.index(20, 20), 5);
  for (let t = 0; t < 20; t++) c.step();
  const probe = g.index(60, 42);
  const before = c.fields.get('landValue')[probe];
  assert.equal(c.fields.get('transitAccess')[probe], 0, 'no transit access before a stop exists');

  const metro = CIVIC_DEFS.find((d) => d.key === 'metro')!;
  assert.ok(c.placeCivic(g.index(60, 43), metro.id).ok);
  for (let t = 0; t < 20; t++) c.step();

  assert.ok(c.fields.get('transitAccess')[probe] > 0, 'a metro station should create access');
  assert.ok(
    c.fields.get('landValue')[probe] > before,
    `land value should rise near transit: ${before.toFixed(1)} -> ${c.fields.get('landValue')[probe].toFixed(1)}`,
  );
});

test('fire coverage suppresses fire risk', () => {
  // Regression: fireCover was consumed by NOTHING. Fire stations cost $100/mo and had
  // no effect on anything in the simulation.
  const c = buildTestCity();
  c.setDisasters(false); // measuring risk, not rolling for ignition
  for (let t = 0; t < 200; t++) c.step();

  const risk = c.fields.get('fireRisk');
  const developed: number[] = [];
  for (let i = 0; i < c.tiles.level.length; i++) if (c.tiles.level[i] > 0) developed.push(i);
  assert.ok(developed.length > 50);
  const exposedBefore = developed.reduce((s, i) => s + risk[i], 0) / developed.length;
  assert.ok(exposedBefore > 0, 'developed buildings should carry fire risk');

  // Blanket the city in fire stations and the risk must fall sharply.
  const fire = CIVIC_DEFS.find((d) => d.key === 'fire')!;
  c.funds = 1_000_000;
  for (let x = 22; x < 56; x += 6) c.placeCivic(c.grid.index(x, 34), fire.id);
  for (let t = 0; t < 40; t++) c.step();
  const after = developed.reduce((s, i) => s + risk[i], 0) / developed.length;
  assert.ok(after < exposedBefore * 0.5, `cover should cut risk: ${exposedBefore.toFixed(1)} -> ${after.toFixed(1)}`);
});

test('fires can be switched off entirely', () => {
  const c = buildTestCity();
  c.setDisasters(false);
  for (let t = 0; t < 1500; t++) c.step();
  assert.equal(c.disasterCounts.fire, 0, 'no fires should occur while disabled');
});

test('an unprotected city does eventually burn, a covered one much less', () => {
  const exposed = buildTestCity();
  for (let t = 0; t < 6000; t++) exposed.step();
  assert.ok(exposed.disasterCounts.fire > 0, 'an uncovered city should see fires over time');
});

test('the history graph records one sample per month', () => {
  const c = buildTestCity();
  c.setDisasters(false);
  const months = 25;
  for (let t = 0; t < TICKS_PER_MONTH * months; t++) c.step();
  for (const s of SERIES) {
    assert.equal(
      c.series[s.key].length, months,
      `${s.key} recorded ${c.series[s.key].length} samples over ${months} months`,
    );
  }
  const pop = c.series.population;
  assert.ok(pop[pop.length - 1] > pop[0], 'population series should show the city growing');
});

test('series averages cover developed land, not the whole map', () => {
  // Averaging over the entire map would drown every series in empty countryside and
  // each one would read as a flat line near zero.
  const c = buildTestCity();
  c.setDisasters(false);
  for (let t = 0; t < TICKS_PER_MONTH * 20; t++) c.step();
  const plane = c.fields.get('landValue');
  let builtSum = 0;
  let builtN = 0;
  let wholeSum = 0;
  for (let i = 0; i < plane.length; i++) {
    wholeSum += plane[i];
    if (c.tiles.level[i] > 0) { builtSum += plane[i]; builtN++; }
  }
  const built = builtSum / builtN;
  const whole = wholeSum / plane.length;

  const lv = c.series.landValue;
  const latest = lv[lv.length - 1];
  assert.ok(builtN > 50, 'need a real city to compare against');
  assert.ok(
    Math.abs(latest - built) < 0.5,
    `series should record the developed-land average ${built.toFixed(2)}, got ${latest.toFixed(2)}`,
  );
  assert.ok(
    Math.abs(latest - whole) > 5,
    `and that must differ from the whole-map average ${whole.toFixed(2)}, which is diluted by empty countryside`,
  );
});

test('history is bounded to the retention limit', () => {
  const c = buildTestCity();
  c.setDisasters(false);
  for (let t = 0; t < TICKS_PER_MONTH * (HISTORY_LIMIT + 30); t++) c.step();
  for (const s of SERIES) {
    assert.equal(c.series[s.key].length, HISTORY_LIMIT, `${s.key} exceeded the retention limit`);
  }
});

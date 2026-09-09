import { test } from 'node:test';
import assert from 'node:assert/strict';
import { City } from '../src/sim/city.ts';
import { FLAT_MAP } from '../src/sim/terrain.ts';
import { ROAD_CLASS_BY_KEY, capacityOf } from '../src/sim/roads.ts';
import { CONTROLS, CONTROL_BY_KEY, UNCONTROLLED, controlFactor } from '../src/sim/controls.ts';
import { DAMAGE_KINDS, DEFAULT_DAMAGE } from '../src/sim/disasters.ts';
import { JUNCTION_BY_KEY } from '../src/sim/junctions.ts';
import { serialize, deserialize } from '../src/sim/save.ts';

const street = ROAD_CLASS_BY_KEY.get('street')!;
const signals = CONTROL_BY_KEY.get('signals')!;
const giveway = CONTROL_BY_KEY.get('giveway')!;

function city(): City {
  const c = new City(128, 1, FLAT_MAP);
  c.funds = 5_000_000;
  c.peakPopulation = 1_000_000;
  c.setDisasters(false);
  c.refreshUnlocks();
  return c;
}

/** A crossroads at (40,40) with arms long enough to be a real junction. */
function crossroads(c: City): number {
  const g = c.grid;
  for (let x = 30; x < 50; x++) c.buildRoad(g.index(x, 40), street.id);
  for (let y = 30; y < 50; y++) c.buildRoad(g.index(40, y), street.id);
  return g.index(40, 40);
}

test('an uncontrolled crossing loses capacity, and every control claws some back', () => {
  assert.ok(UNCONTROLLED < 1, 'a crossing with nobody in charge should not be free-flowing');
  for (const ctrl of CONTROLS) {
    assert.ok(ctrl.throughput > UNCONTROLLED, `${ctrl.label} should beat no control at all`);
  }
  // And only signals beat having no crossing there at all.
  assert.ok(signals.throughput > 1, 'signals should be worth more than a plain stretch of road');
  assert.ok(giveway.throughput < 1, 'a sign cannot make a crossing better than open road');
});

test('a control only does anything where roads actually cross', () => {
  // Otherwise a player could pave a straight road with stop signs to make it faster.
  assert.equal(controlFactor(signals.id, false), 1, 'a sign on a straight changes nothing');
  assert.equal(controlFactor(0, false), 1);
  assert.equal(controlFactor(signals.id, true), signals.throughput);
  assert.equal(controlFactor(0, true), UNCONTROLLED);
});

test('capacity reflects the control standing on the crossing', () => {
  const plain = capacityOf(street.id, 0, 0, true);
  const signalled = capacityOf(street.id, 0, signals.id, true);
  assert.ok(signalled > plain, 'signals should carry more than an unsigned crossroads');
  assert.equal(capacityOf(street.id, 0, 0, false), street.capacity, 'a straight is unaffected');
});

test('a junction replaces the crossing penalty rather than stacking with it', () => {
  // A roundabout is not a crossroads with a sign on it, it is a different piece of road.
  const round = JUNCTION_BY_KEY.get('roundabout')!;
  assert.equal(
    capacityOf(street.id, round.id, 0, true),
    street.capacity * round.throughput,
  );
});

test('controls go on roads, not on nothing and not on junctions', () => {
  const c = city();
  const g = c.grid;
  assert.match(c.setControl(g.index(5, 5), signals.id).error ?? '', /no road/);

  const i = crossroads(c);
  assert.ok(c.setControl(i, signals.id).ok);
  assert.equal(c.tiles.control[i], signals.id);
  assert.match(c.setControl(i, signals.id).error ?? '', /already here/);

  const j = c.grid.index(80, 80);
  assert.ok(c.placeJunction(j, JUNCTION_BY_KEY.get('roundabout')!.id, street.id).ok);
  const ring = c.grid.index(80 + 3, 80);
  assert.match(c.setControl(ring, signals.id).error ?? '', /controls itself/);
});

test('signals cost money every month, and stop when they are taken away', () => {
  const c = city();
  const i = crossroads(c);
  const before = c.ledgerRoadUpkeep;
  assert.ok(c.setControl(i, signals.id).ok);
  assert.ok(c.ledgerRoadUpkeep > before, 'signals should show up in the ledger');

  assert.ok(c.setControl(i, 0).ok);
  assert.equal(c.tiles.control[i], 0);
  assert.ok(Math.abs(c.ledgerRoadUpkeep - before) < 1e-9, 'and stop costing once removed');
});

test('removing the road takes its control with it', () => {
  const c = city();
  const i = crossroads(c);
  assert.ok(c.setControl(i, signals.id).ok);
  const withSignals = c.ledgerRoadUpkeep;
  assert.ok(c.removeAt(i, 'road'));
  assert.equal(c.tiles.control[i], 0, 'a removed road must not leave its signals behind');
  assert.ok(c.ledgerRoadUpkeep < withSignals);
});

test('signalling a jammed crossing measurably relieves it', () => {
  // Measured AT the crossing, not across the whole map. Signals raise the crossing's
  // capacity, which also attracts more load to it — so the total carried goes up while
  // the pressure on that tile goes down, and only the second is the thing being claimed.
  const build = (control: number) => {
    const c = city();
    const g = c.grid;
    for (let x = 20; x < 60; x++) c.buildRoad(g.index(x, 40), street.id);
    for (let y = 20; y < 60; y++) c.buildRoad(g.index(40, y), street.id);
    const cross = g.index(40, 40);
    if (control) c.setControl(cross, control);
    for (let y = 36; y < 45; y++) {
      for (let x = 22; x < 58; x++) {
        const i = g.index(x, y);
        if (c.tiles.road[i]) continue;
        c.paintZone(i, 2, 2);
        c.tiles.level[i] = 4;
      }
    }
    for (let t = 0; t < 4; t++) c.step();
    const cap = capacityOf(street.id, 0, control, true);
    return c.roadLoad[cross] / cap;
  };
  const unsigned = build(0);
  assert.ok(unsigned > 0, 'the crossing should be carrying something');
  assert.ok(build(signals.id) < unsigned, 'signals should ease the pressure on the crossing');
});

test('controls survive a save round trip', () => {
  const c = city();
  const i = crossroads(c);
  assert.ok(c.setControl(i, signals.id).ok);
  const restored = deserialize(serialize(c)).city;
  assert.equal(restored.tiles.control[i], signals.id);
});

// ---------------------------------------------------------------- damage settings
test('the game starts exactly where it always was', () => {
  // Earthquakes have always taken roads; cutting buried services is new, and switching it
  // on for everybody by default would quietly make every existing city harder.
  assert.equal(DEFAULT_DAMAGE.roads, true);
  assert.equal(DEFAULT_DAMAGE.powerLine, false);
  assert.equal(DEFAULT_DAMAGE.pipe, false);
  assert.equal(DEFAULT_DAMAGE.sewer, false);
  for (const d of DAMAGE_KINDS) {
    assert.ok(d.key in DEFAULT_DAMAGE, `${d.key} has no default`);
    assert.ok(d.hint.length > 10, `${d.key} does not explain itself`);
  }
});

test('damage settings are part of the city, and survive a save', () => {
  // A city's chosen intensity is part of that city — reloading it into somebody else's
  // defaults would change the game under the player without telling them.
  const c = city();
  c.damage = { ...c.damage, powerLine: true, roads: false };
  const restored = deserialize(serialize(c)).city;
  assert.equal(restored.damage.powerLine, true);
  assert.equal(restored.damage.roads, false);
});

test('an earthquake respects the road switch, and cleans up after itself', () => {
  const quake = (roadsOn: boolean) => {
    const c = new City(128, 7, FLAT_MAP);
    c.funds = 5_000_000;
    c.peakPopulation = 1_000_000;
    c.refreshUnlocks();
    c.setDisasters(false);
    c.disasters.earthquake = true;
    c.disasterRateScale = 4000;
    c.damage = { ...c.damage, roads: roadsOn };
    const g = c.grid;
    for (let x = 8; x < 120; x++) c.buildRoad(g.index(x, 40), street.id);
    for (let y = 37; y < 40; y++) {
      for (let x = 20; x < 110; x++) { const i = g.index(x, y); c.paintZone(i, 1, 2); c.tiles.level[i] = 3; }
    }
    const before = c.ledgerRoadUpkeep;
    for (let t = 0; t < 1200; t++) c.step();
    let roads = 0;
    let orphanClass = 0;
    for (let i = 0; i < c.tiles.road.length; i++) {
      if (c.tiles.road[i]) roads++;
      else if (c.tiles.roadClass[i]) orphanClass++;
    }
    return { roads, orphanClass, before, after: c.ledgerRoadUpkeep, quakes: c.disasterCounts.earthquake };
  };

  const off = quake(false);
  assert.ok(off.quakes > 0, 'the fixture must actually have earthquakes');
  assert.equal(off.roads, 112, 'with roads protected, not one tile should be lost');

  const on = quake(true);
  assert.ok(on.roads < 112, 'with roads exposed, an earthquake should take some');
  // The bug this pins: the first version cleared `road` and nothing else, so the tile
  // still claimed a class and the city went on paying upkeep for a road that was gone.
  assert.equal(on.orphanClass, 0, 'a destroyed road must not keep its class');
  assert.ok(on.after < on.before, 'and must stop being charged for');
});

test('utility lines are only cut when the player asks for it', () => {
  const run = (linesOn: boolean) => {
    const c = new City(128, 11, FLAT_MAP);
    c.funds = 5_000_000;
    c.peakPopulation = 1_000_000;
    c.refreshUnlocks();
    c.setDisasters(false);
    c.disasters.earthquake = true;
    c.disasterRateScale = 4000;
    c.damage = { ...c.damage, powerLine: linesOn, pipe: linesOn, sewer: linesOn };
    const g = c.grid;
    for (let x = 8; x < 120; x++) {
      const i = g.index(x, 40);
      c.buildRoad(i, street.id);
      c.buildUtility(i, 'powerLine');
      c.buildUtility(i, 'pipe');
    }
    for (let y = 37; y < 40; y++) {
      for (let x = 20; x < 110; x++) { const i = g.index(x, y); c.paintZone(i, 1, 2); c.tiles.level[i] = 3; }
    }
    for (let t = 0; t < 1200; t++) c.step();
    let lines = 0;
    for (let i = 0; i < c.tiles.powerLine.length; i++) if (c.tiles.powerLine[i]) lines++;
    return lines;
  };
  assert.equal(run(false), 112, 'lines should be untouched by default');
  assert.ok(run(true) < 112, 'and cut when the player switches it on');
});

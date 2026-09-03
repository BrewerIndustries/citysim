import { test } from 'node:test';
import assert from 'node:assert/strict';
import { City } from '../src/sim/city.ts';
import { FLAT_MAP } from '../src/sim/terrain.ts';
import { ZONE_RES, ZONE_COM } from '../src/sim/tiles.ts';
import {
  ROAD_CLASSES, ROAD_CLASS_BY_KEY, ROAD_REACH, DEFAULT_ROAD_CLASS, hasFrontage, capacityOf,
} from '../src/sim/roads.ts';
import { tripsAt, TRIPS_PER_STEP, CONGESTED } from '../src/sim/traffic.ts';
import { LAND_VALUE_TERMS } from '../src/sim/sim.ts';
import { lineCells } from '../src/app/tools.ts';

const street = ROAD_CLASS_BY_KEY.get('street')!;
const avenue = ROAD_CLASS_BY_KEY.get('avenue')!;
const motorway = ROAD_CLASS_BY_KEY.get('motorway')!;

function city(): City {
  const c = new City(128, 1, FLAT_MAP);
  c.funds = 5_000_000;
  c.peakPopulation = 1_000_000;
  c.setDisasters(false);
  c.refreshUnlocks();
  return c;
}

test('the ladder climbs: more lanes, more capacity, more cost', () => {
  for (let i = 1; i < ROAD_CLASSES.length; i++) {
    const lo = ROAD_CLASSES[i - 1];
    const hi = ROAD_CLASSES[i];
    assert.ok(hi.lanes > lo.lanes, `${hi.label} should have more lanes than ${lo.label}`);
    assert.ok(hi.capacity > lo.capacity, `${hi.label} should carry more`);
    assert.ok(hi.cost > lo.cost, `${hi.label} should cost more`);
    assert.ok(hi.upkeep > lo.upkeep, `${hi.label} should cost more to run`);
  }
});

test('wide roads are cheap per unit of capacity and ruinous in absolute terms', () => {
  // Per unit of capacity a motorway is BETTER value than a street, exactly as in reality
  // — capacity is what wide roads are for. What stops you paving everything wide is the
  // absolute bill: you are buying capacity a cul-de-sac will never use, at ten times the
  // price, forever. That plus frontage is the whole decision, so pin both.
  const perUnit = (c: typeof street) => c.cost / c.capacity;
  assert.ok(perUnit(motorway) < perUnit(street), 'lanes should be the efficient way to buy capacity');
  assert.ok(motorway.cost >= street.cost * 10, 'and the sticker price should be punishing');
  assert.ok(motorway.upkeep >= street.upkeep * 10, 'and so should the standing charge');
  assert.equal(motorway.frontage, false, 'which only balances because nothing fronts onto it');
});

test('a motorway grants no frontage, and the rest do', () => {
  assert.equal(hasFrontage(motorway.id), false);
  for (const c of ROAD_CLASSES) {
    if (c.id === motorway.id) continue;
    assert.ok(hasFrontage(c.id), `${c.label} should grant frontage`);
  }
  assert.equal(hasFrontage(0), false, 'no road, no frontage');
});

test('nothing takes access from a motorway', () => {
  const c = city();
  const g = c.grid;
  for (let x = 10; x < 40; x++) assert.ok(c.buildRoad(g.index(x, 20), motorway.id));
  c.step();
  // A tile right beside the carriageway is still out of reach.
  assert.equal(c.tiles.roadDist[g.index(25, 21)], 255, 'a motorway must grant no access');

  // Put a street alongside and the same tile is served.
  assert.ok(c.buildRoad(g.index(25, 22), street.id));
  c.step();
  assert.ok(c.tiles.roadDist[g.index(25, 21)] <= ROAD_REACH, 'the street should reach it');
});

test('drawing a wider road over a narrower one upgrades it for the difference', () => {
  const c = city();
  const i = c.grid.index(40, 40);
  const before = c.funds;
  assert.ok(c.buildRoad(i, street.id));
  assert.equal(c.funds, before - street.cost);

  assert.ok(c.buildRoad(i, avenue.id), 'an upgrade should be allowed');
  assert.equal(c.tiles.roadClass[i], avenue.id);
  assert.equal(c.funds, before - avenue.cost, 'you pay the difference, not twice');
  assert.equal(c.tiles.road[i], 1, 'and it is still one road tile');
});

test('re-laying the same class changes nothing and costs nothing', () => {
  const c = city();
  const i = c.grid.index(40, 40);
  assert.ok(c.buildRoad(i, street.id));
  const funds = c.funds;
  assert.equal(c.buildRoad(i, street.id), false);
  assert.equal(c.funds, funds, 'dragging over your own road must not charge you');
});

test('downgrading is allowed and free', () => {
  const c = city();
  const i = c.grid.index(40, 40);
  assert.ok(c.buildRoad(i, avenue.id));
  const funds = c.funds;
  assert.ok(c.buildRoad(i, street.id), 'taking lanes away should be allowed');
  assert.equal(c.tiles.roadClass[i], street.id);
  assert.equal(c.funds, funds, 'you are not owed a refund, but you should not be charged');
});

test('road upkeep is summed per tile from its class', () => {
  const c = city();
  const g = c.grid;
  for (let x = 10; x < 20; x++) c.buildRoad(g.index(x, 30), street.id);
  for (let x = 10; x < 20; x++) c.buildRoad(g.index(x, 32), motorway.id);
  c.recountUpkeep();
  const live = c.ledgerRoadUpkeep;
  assert.ok(Math.abs(live - (10 * street.upkeep + 10 * motorway.upkeep)) < 1e-6,
    `expected ${10 * street.upkeep + 10 * motorway.upkeep}, got ${live}`);
});

test('removing a road takes its class and its upkeep with it', () => {
  const c = city();
  const i = c.grid.index(40, 40);
  assert.ok(c.buildRoad(i, motorway.id));
  const withRoad = c.ledgerRoadUpkeep;
  assert.ok(withRoad > 0);
  assert.ok(c.removeAt(i, 'road'));
  assert.equal(c.tiles.roadClass[i], 0, 'a removed road must not leave its class behind');
  assert.equal(c.ledgerRoadUpkeep, 0, 'nor its upkeep');
});

test('trips scale with what is built, and commerce generates most', () => {
  assert.equal(tripsAt(ZONE_RES, 0, 0), 0, 'an empty lot generates nothing');
  assert.equal(tripsAt(ZONE_RES, 2, 1), TRIPS_PER_STEP[ZONE_RES] * 2 * 2);
  assert.ok(tripsAt(ZONE_COM, 3, 1) > tripsAt(ZONE_RES, 3, 1),
    'a shop draws more traffic than a house of the same size');
});

test('a street under heavy frontage congests, and widening it helps', () => {
  const build = (cls: number) => {
    const c = city();
    const g = c.grid;
    for (let x = 10; x < 60; x++) c.buildRoad(g.index(x, 40), cls);
    for (let y = 37; y < 40; y++) {
      for (let x = 12; x < 58; x++) {
        const i = g.index(x, y);
        c.paintZone(i, ZONE_COM, 2);
        c.tiles.level[i] = 4;
      }
    }
    for (let t = 0; t < 4; t++) c.step();
    return c.traffic;
  };
  const narrow = build(street.id);
  const wide = build(ROAD_CLASS_BY_KEY.get('arterial')!.id);

  assert.ok(narrow.trips > 0, 'the frontage should generate trips');
  assert.equal(narrow.trips, wide.trips, 'the same buildings generate the same trips');
  assert.ok(narrow.worst >= CONGESTED, 'a two-lane street under this much should be over capacity');
  assert.ok(wide.worst < narrow.worst, 'widening the corridor must reduce the worst load');
});

test('a motorway alongside relieves the street feeding it', () => {
  // The point of the relaxation pass: load is pulled towards spare capacity, so a wide
  // road next door genuinely takes the pressure off rather than merely existing.
  const build = (relief: boolean) => {
    const c = city();
    const g = c.grid;
    for (let x = 10; x < 60; x++) c.buildRoad(g.index(x, 40), street.id);
    if (relief) for (let x = 10; x < 60; x++) c.buildRoad(g.index(x, 41), motorway.id);
    for (let y = 36; y < 40; y++) {
      for (let x = 12; x < 58; x++) {
        const i = g.index(x, y);
        c.paintZone(i, ZONE_COM, 2);
        c.tiles.level[i] = 4;
      }
    }
    for (let t = 0; t < 4; t++) c.step();
    return c.traffic.worst;
  };
  assert.ok(build(true) < build(false), 'the motorway should take load off the street');
});

test('congestion is a negative term in land value', () => {
  const term = LAND_VALUE_TERMS.find((t) => t.field === 'congestion');
  assert.ok(term, 'traffic should show up in the Why Panel like every other pressure');
  assert.ok(term!.weight < 0);
});

test('capacityOf and the default class are honest about nothing', () => {
  assert.equal(capacityOf(0), 0);
  assert.ok(capacityOf(DEFAULT_ROAD_CLASS) > 0);
  assert.equal(ROAD_CLASS_BY_KEY.get('street')!.id, DEFAULT_ROAD_CLASS,
    'the default should be the cheapest thing on the ladder');
});

test('a line to nowhere is no cells, not an infinite loop', () => {
  // The walk steps by one until it hits the end exactly. A NaN or off-map endpoint never
  // terminates, and the array grows until it is too long to exist — which is exactly what
  // a viewport collapsed to zero size produced, turning a drag into a RangeError.
  assert.deepEqual(lineCells(NaN, 10, 20, 10, 256), []);
  assert.deepEqual(lineCells(10, 10, 20, NaN, 256), []);
  assert.deepEqual(lineCells(10.5, 10, 20, 10, 256), [], 'a fractional cell is not a cell');
  assert.deepEqual(lineCells(-1, 10, 20, 10, 256), []);
  assert.deepEqual(lineCells(10, 10, 999999, 10, 256), []);
  // And a real line still works.
  assert.equal(lineCells(10, 10, 14, 10, 256).length, 5);
  assert.equal(lineCells(10, 10, 10, 10, 256).length, 1, 'a click is one cell');
});

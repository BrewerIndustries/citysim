import { test } from 'node:test';
import assert from 'node:assert/strict';
import { City } from '../src/sim/city.ts';
import { FLAT_MAP } from '../src/sim/terrain.ts';
import { ZONE_RES, ZONE_COM } from '../src/sim/tiles.ts';
import {
  ROAD_CLASSES, ROAD_CLASS_BY_KEY, ROAD_REACH, DEFAULT_ROAD_CLASS, hasFrontage, capacityOf,
  ROAD_LEVELS, roadCost, roadUpkeep, levelsConnect, passesUnder,
} from '../src/sim/roads.ts';
import { tripsAt, TRIPS_PER_STEP, CONGESTED } from '../src/sim/traffic.ts';
import { LAND_VALUE_TERMS } from '../src/sim/sim.ts';
import { lineCells, curveCells } from '../src/app/tools.ts';
import { JUNCTIONS, JUNCTION_BY_KEY } from '../src/sim/junctions.ts';
import { serialize, deserialize } from '../src/sim/save.ts';

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

// ---------------------------------------------------------------- curves
test('a curve sweeps the corner a line would turn square', () => {
  const line = lineCells(2, 2, 20, 12, 256);
  const curve = curveCells(2, 2, 20, 12, 256);
  assert.ok(curve.length > 0);
  assert.equal(curve[0], 2 * 256 + 2, 'it should start where you pressed');
  assert.equal(curve[curve.length - 1], 12 * 256 + 20, 'and end where you released');
  // The elbow is the one cell a square turn must pass through and a curve must not.
  const elbow = 2 * 256 + 20;
  assert.ok(line.includes(elbow), 'the line turns at the corner');
  assert.ok(!curve.includes(elbow), 'the curve should cut it');
});

test('a curve is 4-connected, or it is a road with gaps in it', () => {
  // The distance search, the utility flood and the traffic relaxation all walk
  // orthogonally, so a diagonal step is a break in the network, not a shortcut.
  for (const [ax, ay, bx, by] of [[2, 2, 20, 12], [30, 5, 5, 30], [10, 40, 40, 10], [8, 8, 9, 30]]) {
    const cells = curveCells(ax, ay, bx, by, 256);
    for (let n = 1; n < cells.length; n++) {
      const dx = Math.abs((cells[n] % 256) - (cells[n - 1] % 256));
      const dy = Math.abs(Math.floor(cells[n] / 256) - Math.floor(cells[n - 1] / 256));
      assert.equal(dx + dy, 1, `step ${n} of the curve ${ax},${ay}->${bx},${by} is not orthogonal`);
    }
  }
});

test('a curve never repeats a cell', () => {
  const cells = curveCells(4, 4, 40, 26, 256);
  assert.equal(new Set(cells).size, cells.length, 'a cell paid for twice is a cell paid for twice');
});

test('a curve to nowhere is no cells', () => {
  assert.deepEqual(curveCells(NaN, 2, 20, 12, 256), []);
  assert.deepEqual(curveCells(2, 2, -5, 12, 256), []);
});

// ---------------------------------------------------------------- junctions
test('every junction is a connected shape that fits its footprint', () => {
  for (const j of JUNCTIONS) {
    assert.ok(j.cells.length > 0, `${j.label} has no cells`);
    for (const [x, y] of j.cells) {
      assert.ok(x >= 0 && x < j.size && y >= 0 && y < j.size,
        `${j.label} has a cell at ${x},${y} outside its ${j.size}x${j.size} footprint`);
    }
    // 4-connected as one piece: a junction in two halves is two roads.
    const key = (x: number, y: number) => `${x},${y}`;
    const all = new Set(j.cells.map(([x, y]) => key(x, y)));
    const seen = new Set<string>();
    const stack = [j.cells[0]];
    while (stack.length) {
      const [x, y] = stack.pop()!;
      if (seen.has(key(x, y))) continue;
      seen.add(key(x, y));
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
        if (all.has(key(nx, ny)) && !seen.has(key(nx, ny))) stack.push([nx, ny]);
      }
    }
    assert.equal(seen.size, all.size, `${j.label} is not one connected piece`);
  }
});

test('a junction carries more than the same tiles would alone', () => {
  // Otherwise it is decoration, and there would be no reason to build one.
  for (const j of JUNCTIONS) {
    assert.ok(j.throughput > 1, `${j.label} does nothing`);
    assert.equal(capacityOf(street.id, j.id), street.capacity * j.throughput);
  }
  assert.equal(capacityOf(street.id, 0), street.capacity, 'no junction, no bonus');
});

test('placing a junction lays its roads and marks them', () => {
  const c = city();
  const j = JUNCTION_BY_KEY.get('roundabout')!;
  const before = c.funds;
  const anchor = c.grid.index(40, 40);
  const quoted = c.junctionCost(anchor, j.id, street.id);
  assert.ok(c.placeJunction(anchor, j.id, street.id).ok);
  assert.equal(Math.round(before - c.funds), Math.round(quoted), 'the quote should be the price');

  for (const [dx, dy] of j.cells) {
    const i = c.grid.index(40 + dx, 40 + dy);
    assert.equal(c.tiles.road[i], 1, `no road at ${dx},${dy}`);
    assert.equal(c.tiles.roadClass[i], street.id);
    assert.equal(c.tiles.junction[i], j.id);
  }
  // The middle of a roundabout is not road.
  assert.equal(c.tiles.road[c.grid.index(42, 42)], 0, 'the island should stay clear');
});

test('a junction that will not fit is refused before a penny is spent', () => {
  const c = city();
  const j = JUNCTION_BY_KEY.get('crossover')!;
  const funds = c.funds;
  const r = c.placeJunction(c.grid.index(126, 126), j.id, street.id);
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /fit/);
  assert.equal(c.funds, funds, 'a refused junction must be free');
});

test('drawing a plain road through a junction takes it apart', () => {
  // What is left should be road, not a roundabout with a bite out of it still claiming
  // its throughput.
  const c = city();
  const j = JUNCTION_BY_KEY.get('roundabout')!;
  assert.ok(c.placeJunction(c.grid.index(40, 40), j.id, street.id).ok);
  const [dx, dy] = j.cells[0];
  const i = c.grid.index(40 + dx, 40 + dy);
  assert.equal(c.tiles.junction[i], j.id);
  assert.ok(c.buildRoad(i, avenue.id));
  assert.equal(c.tiles.junction[i], 0, 'the junction marking should go with it');
});

test('removing a junction road takes its marking too', () => {
  const c = city();
  const j = JUNCTION_BY_KEY.get('roundabout')!;
  assert.ok(c.placeJunction(c.grid.index(40, 40), j.id, street.id).ok);
  const [dx, dy] = j.cells[0];
  const i = c.grid.index(40 + dx, 40 + dy);
  assert.ok(c.removeAt(i, 'road'));
  assert.equal(c.tiles.junction[i], 0);
  assert.equal(c.tiles.roadClass[i], 0);
});

test('a junction survives a save round trip, bonus included', () => {
  const c = city();
  const j = JUNCTION_BY_KEY.get('crossover')!;
  assert.ok(c.placeJunction(c.grid.index(40, 40), j.id, avenue.id).ok);
  const restored = deserialize(serialize(c)).city;
  const i = restored.grid.index(40 + j.cells[0][0], 40 + j.cells[0][1]);
  assert.equal(restored.tiles.junction[i], j.id, 'a reloaded city should keep its junctions');
  assert.equal(capacityOf(restored.tiles.roadClass[i], restored.tiles.junction[i]),
    avenue.capacity * j.throughput);
});

test('a roundabout relieves the crossing it replaces', () => {
  const build = (withJunction: boolean) => {
    const c = city();
    const g = c.grid;
    for (let x = 20; x < 60; x++) c.buildRoad(g.index(x, 40), street.id);
    for (let y = 22; y < 58; y++) c.buildRoad(g.index(40, y), street.id);
    if (withJunction) c.placeJunction(g.index(38, 38), JUNCTION_BY_KEY.get('roundabout')!.id, street.id);
    for (let y = 36; y < 45; y++) {
      for (let x = 22; x < 58; x++) {
        if (c.tiles.road[g.index(x, y)]) continue;
        const i = g.index(x, y);
        c.paintZone(i, ZONE_COM, 2);
        c.tiles.level[i] = 4;
      }
    }
    for (let t = 0; t < 4; t++) c.step();
    return c.traffic.congestedTiles;
  };
  assert.ok(build(true) < build(false), 'the roundabout should carry what the crossing could not');
});

test('stamping a junction rebuilds the intersection under it', () => {
  // Otherwise the old crossing roads survive inside the island, and what you have is not
  // a roundabout, it is a roundabout with a road through the middle.
  const c = city();
  const g = c.grid;
  for (let x = 30; x < 60; x++) c.buildRoad(g.index(x, 42), street.id);
  for (let y = 30; y < 60; y++) c.buildRoad(g.index(42, y), street.id);
  const j = JUNCTION_BY_KEY.get('roundabout')!;
  assert.ok(c.placeJunction(g.index(40, 40), j.id, street.id).ok);

  const shape = new Set(j.cells.map(([dx, dy]) => g.index(40 + dx, 40 + dy)));
  for (let dy = 0; dy < j.size; dy++) {
    for (let dx = 0; dx < j.size; dx++) {
      const i = g.index(40 + dx, 40 + dy);
      if (shape.has(i)) {
        assert.equal(c.tiles.junction[i], j.id, `${dx},${dy} should be the junction`);
      } else {
        assert.equal(c.tiles.road[i], 0, `${dx},${dy} is inside the island and should be clear`);
      }
    }
  }
  // And the roads either side of it are untouched.
  assert.equal(c.tiles.road[g.index(30, 42)], 1);
  assert.equal(c.tiles.road[g.index(59, 42)], 1);
});

test('the roundabout is round, and still meets the roads that approach it', () => {
  const j = JUNCTION_BY_KEY.get('roundabout')!;
  const has = (x: number, y: number) => j.cells.some(([cx, cy]) => cx === x && cy === y);
  const n = j.size - 1;
  // Round means the corners of the bounding box are NOT road. A square ring passes the
  // connectivity test perfectly well and is not a roundabout.
  for (const [x, y] of [[0, 0], [n, 0], [0, n], [n, n]] as const) {
    assert.equal(has(x, y), false, `corner ${x},${y} should be outside a round ring`);
  }
  // And the cardinal points must be, or an approach road on the centre line misses it.
  const mid = n / 2;
  for (const [x, y] of [[mid, 0], [0, mid], [n, mid], [mid, n]] as const) {
    assert.ok(has(x, y), `the ring should reach ${x},${y} for the road approaching there`);
  }
  // A hollow ring: nothing in the middle.
  assert.equal(has(mid, mid), false, 'the island should be an island');
});

// ---------------------------------------------------------------- elevation
test('height costs more to build and more to keep', () => {
  for (let l = 1; l < ROAD_LEVELS.length; l++) {
    assert.ok(ROAD_LEVELS[l].costMul > ROAD_LEVELS[l - 1].costMul, `level ${l} should cost more`);
    assert.ok(roadCost(street.id, l) > roadCost(street.id, l - 1));
    assert.ok(roadUpkeep(street.id, l) > roadUpkeep(street.id, l - 1));
  }
  assert.equal(roadCost(street.id, 0), street.cost, 'ground level is the sticker price');
});

test('roads join a neighbour within a level, and pass under one two above', () => {
  assert.ok(levelsConnect(0, 0));
  assert.ok(levelsConnect(0, 1), 'a ramp meets the ground');
  assert.ok(!levelsConnect(0, 2), 'a deck two up is not the same road');
  assert.ok(passesUnder(0, 2), 'and a ground road goes underneath it');
  assert.ok(!passesUnder(0, 1), 'one level is a ramp, not a bridge');
});

test('nothing fronts onto a raised road', () => {
  const c = city();
  const g = c.grid;
  for (let x = 20; x < 50; x++) assert.ok(c.buildRoad(g.index(x, 30), street.id, 2));
  c.step();
  assert.equal(c.tiles.roadDist[g.index(35, 31)], 255, 'a flyover grants no access');

  for (let x = 20; x < 50; x++) assert.ok(c.buildRoad(g.index(x, 33), street.id, 0));
  c.step();
  assert.ok(c.tiles.roadDist[g.index(35, 32)] <= ROAD_REACH, 'the ground street does');
});

test('an elevated crossing does not sever the road beneath it', () => {
  // The whole point of an overpass. Without the pass-under rule an elevated carriageway
  // would cut every road it crossed, which is the opposite of what it is for.
  const carried = (crossLevel: number) => {
    const c = city();
    const g = c.grid;
    for (let x = 20; x < 60; x++) c.buildRoad(g.index(x, 40), street.id, 0);
    for (let y = 20; y < 60; y++) c.buildRoad(g.index(40, y), street.id, crossLevel);
    for (let y = 37; y < 44; y++) {
      for (let x = 22; x < 38; x++) {
        if (c.tiles.road[g.index(x, y)]) continue;
        const i = g.index(x, y);
        c.paintZone(i, ZONE_COM, 2);
        c.tiles.level[i] = 4;
      }
    }
    for (let t = 0; t < 4; t++) c.step();
    // Load reaching the far side of the crossing means the street got through.
    return c.traffic.worst;
  };
  // A ground crossroads and an elevated flyover should both leave the street usable.
  assert.ok(carried(0) > 0, 'a ground crossing carries traffic');
  assert.ok(carried(2) > 0, 'and so does the street under a flyover');
});

test('the crossover is genuinely grade separated', () => {
  const j = JUNCTION_BY_KEY.get('crossover')!;
  assert.ok(j.levelAt, 'a crossover that is all on one level is just a wide crossroads');
  const levels = new Set(j.cells.map(([dx, dy]) => j.levelAt!(dx, dy, j.size)));
  assert.ok(levels.size > 1, 'its carriageways should not all be at the same height');
  assert.ok([...levels].some((a) => [...levels].some((b) => passesUnder(a, b))),
    'and the difference should be enough for one to pass under the other');
});

test('a placed junction carries its levels onto the map', () => {
  const c = city();
  const j = JUNCTION_BY_KEY.get('crossover')!;
  assert.ok(c.placeJunction(c.grid.index(40, 40), j.id, street.id).ok);
  for (const [dx, dy] of j.cells) {
    const i = c.grid.index(40 + dx, 40 + dy);
    assert.equal(c.tiles.roadLevel[i], j.levelAt!(dx, dy, j.size), `level wrong at ${dx},${dy}`);
  }
});

test('removing a road puts its height back on the ground', () => {
  const c = city();
  const i = c.grid.index(40, 40);
  assert.ok(c.buildRoad(i, street.id, 3));
  assert.equal(c.tiles.roadLevel[i], 3);
  assert.ok(c.removeAt(i, 'road'));
  assert.equal(c.tiles.roadLevel[i], 0, 'a cleared tile must not remember it was high');
  assert.equal(c.ledgerRoadUpkeep, 0);
});

test('changing only the height of a road is a real change', () => {
  const c = city();
  const i = c.grid.index(40, 40);
  assert.ok(c.buildRoad(i, street.id, 0));
  const funds = c.funds;
  assert.ok(c.buildRoad(i, street.id, 2), 'raising an existing road should be allowed');
  assert.equal(c.tiles.roadLevel[i], 2);
  assert.equal(Math.round(funds - c.funds), Math.round(roadCost(street.id, 2) - roadCost(street.id, 0)));
  assert.equal(c.buildRoad(i, street.id, 2), false, 'and re-laying the same thing is not');
});

test('road height survives a save round trip', () => {
  const c = city();
  const i = c.grid.index(40, 40);
  assert.ok(c.buildRoad(i, street.id, 2));
  const restored = deserialize(serialize(c)).city;
  assert.equal(restored.tiles.roadLevel[i], 2, 'a reloaded city should keep its flyovers');
});

test('a loaded city knows which road each building pulls out onto', () => {
  // The settle path used to rebuild only the distance field, leaving nearestRoad as a
  // zero-filled array — and 0 is a valid cell index, not a "nobody", so every trip in the
  // city was assigned to the corner of the map. No road showed any traffic, and the one
  // tile that did was not a road, so nothing ever cleared it and it climbed until it
  // saturated. Both paths now rebuild the whole network.
  const c = city();
  const g = c.grid;
  for (let x = 20; x < 60; x++) c.buildRoad(g.index(x, 40), street.id);
  for (let y = 37; y < 40; y++) {
    for (let x = 22; x < 58; x++) {
      const i = g.index(x, y);
      c.paintZone(i, ZONE_COM, 2);
      c.tiles.level[i] = 3;
    }
  }
  const restored = deserialize(serialize(c)).city;
  restored.step();

  assert.ok(restored.traffic.trips > 0, 'a reloaded city should still generate trips');
  let loadedTiles = 0;
  let offRoad = 0;
  for (let i = 0; i < restored.roadLoad.length; i++) {
    if (restored.roadLoad[i] <= 0) continue;
    loadedTiles++;
    if (!restored.tiles.road[i]) offRoad++;
  }
  assert.equal(offRoad, 0, 'no traffic may be assigned to a tile that is not a road');
  assert.ok(loadedTiles > 5, `traffic should spread over the network, got ${loadedTiles} tiles`);
});

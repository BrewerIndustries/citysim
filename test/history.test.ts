import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLAT_MAP } from '../src/sim/terrain.ts';
import { City } from '../src/sim/city.ts';
import { ZONE_RES, ZONE_COM, CIVIC_DEFS } from '../src/sim/tiles.ts';
import { MAX_UNDO } from '../src/sim/history.ts';

const snapshotOf = (c: City) =>
  ['zone', 'density', 'road', 'level', 'civic', 'civicAnchor'].map(
    (p) => Array.from(c.tiles[p as 'zone']).join(','),
  ).join('|') + `|${Math.round(c.funds)}`;

test('undo restores tiles and money exactly', () => {
  const c = new City(128, 1, FLAT_MAP);
  const before = snapshotOf(c);

  c.beginStroke('s1', 'Road');
  for (let x = 10; x < 60; x++) c.buildRoad(c.grid.index(x, 30));
  c.endStroke();
  assert.notEqual(snapshotOf(c), before, 'building should have changed something');

  assert.equal(c.undo(), 'Road');
  assert.equal(snapshotOf(c), before, 'undo must restore tiles AND funds exactly');
});

test('a whole drag stroke is one undo step', () => {
  // Fifty presses of undo to take back one dragged road would be worse than no undo.
  const c = new City(128, 1, FLAT_MAP);
  c.beginStroke('s1', 'Road');
  for (let x = 10; x < 60; x++) c.buildRoad(c.grid.index(x, 30));
  c.endStroke();
  assert.equal(c.history.depth, 1);
  c.undo();
  for (let x = 10; x < 60; x++) assert.equal(c.tiles.road[c.grid.index(x, 30)], 0);
});

test('redo reapplies exactly what undo took away', () => {
  const c = new City(128, 1, FLAT_MAP);
  c.beginStroke('s1', 'Zone');
  for (let x = 10; x < 40; x++) c.paintZone(c.grid.index(x, 30), ZONE_RES, 1);
  c.endStroke();
  const after = snapshotOf(c);

  c.undo();
  assert.equal(c.redo(), 'Zone');
  assert.equal(snapshotOf(c), after);
});

test('undo cannot be used to farm money', () => {
  const c = new City(128, 1, FLAT_MAP);
  const start = c.funds;
  for (let n = 0; n < 6; n++) {
    c.beginStroke(`s${n}`, 'Road');
    for (let x = 10; x < 50; x++) c.buildRoad(c.grid.index(x, 30 + n));
    c.endStroke();
    c.undo();
  }
  assert.equal(c.funds, start, 'build-then-undo cycles must be money-neutral');
});

test('undoing a civic building removes its whole footprint', () => {
  const c = new City(128, 1, FLAT_MAP);
  const plant = CIVIC_DEFS.find((d) => d.key === 'power')!;
  c.beginStroke('s1', plant.label);
  assert.ok(c.placeCivic(c.grid.index(20, 20), plant.id).ok);
  c.endStroke();
  c.undo();
  let remaining = 0;
  for (let i = 0; i < c.tiles.civic.length; i++) if (c.tiles.civic[i] !== 0) remaining++;
  assert.equal(remaining, 0, 'the entire footprint should be gone');
});

test('undoing a bulldozed civic restores the whole footprint', () => {
  const c = new City(128, 1, FLAT_MAP);
  const school = CIVIC_DEFS.find((d) => d.key === 'school')!;
  c.beginStroke('a', school.label);
  c.placeCivic(c.grid.index(30, 30), school.id);
  c.endStroke();
  const built = snapshotOf(c);

  c.beginStroke('b', 'Bulldoze');
  c.bulldoze(c.grid.index(31, 31)); // not the anchor
  c.endStroke();
  let after = 0;
  for (let i = 0; i < c.tiles.civic.length; i++) if (c.tiles.civic[i] !== 0) after++;
  assert.equal(after, 0);

  c.undo();
  assert.equal(snapshotOf(c), built, 'the full 3x3 school should come back');
});

test('a stroke that changes nothing does not create an undo step', () => {
  const c = new City(128, 1, FLAT_MAP);
  c.beginStroke('s1', 'Zone');
  c.paintZone(c.grid.index(20, 20), ZONE_RES, 0);
  c.endStroke();
  assert.equal(c.history.depth, 1);

  // Painting the same zone again is a no-op; pressing undo should still take back the
  // real change, not silently do nothing.
  c.beginStroke('s2', 'Zone');
  c.paintZone(c.grid.index(20, 20), ZONE_RES, 0);
  c.endStroke();
  assert.equal(c.history.depth, 1, 'a no-op stroke must not land on the undo stack');
  c.undo();
  assert.equal(c.tiles.zone[c.grid.index(20, 20)], 0);
});

test('a new action clears the redo stack', () => {
  const c = new City(128, 1, FLAT_MAP);
  c.beginStroke('a', 'Road');
  c.buildRoad(c.grid.index(10, 10));
  c.endStroke();
  c.undo();
  assert.equal(c.history.canRedo, true);

  c.beginStroke('b', 'Zone');
  c.paintZone(c.grid.index(40, 40), ZONE_COM, 0);
  c.endStroke();
  assert.equal(c.history.canRedo, false, 'branching should discard the old redo path');
});

test('history is bounded', () => {
  const c = new City(128, 1, FLAT_MAP);
  c.funds = 10_000_000;
  for (let n = 0; n < MAX_UNDO + 40; n++) {
    c.beginStroke(`s${n}`, 'Road');
    c.buildRoad(c.grid.index(10 + (n % 100), 60));
    c.endStroke();
  }
  assert.ok(c.history.depth <= MAX_UNDO, `history grew to ${c.history.depth}`);
});

test('undo works on a running city and the simulation keeps up', () => {
  const c = new City(128, 1, FLAT_MAP);
  c.firesEnabled = false;
  const g = c.grid;
  c.beginStroke('a', 'Build');
  for (let x = 8; x < 110; x++) c.buildRoad(g.index(x, 40));
  for (let y = 30; y < 40; y++) c.buildRoad(g.index(12, y));
  c.placeCivic(g.index(10, 26), 5);
  for (let y = 37; y < 40; y++) for (let x = 20; x < 55; x++) c.paintZone(g.index(x, y), ZONE_RES, 0);
  c.endStroke();
  for (let t = 0; t < 150; t++) c.step();
  assert.ok(c.stats.population > 0);

  // Undoing the whole build should leave nothing standing once the sim catches up.
  c.undo();
  for (let t = 0; t < 30; t++) c.step();
  assert.equal(c.stats.population, 0, 'nothing should remain after undoing the entire city');
  assert.equal(c.tiles.roadDist[g.index(30, 38)], 255, 'road distance must be recomputed');
});

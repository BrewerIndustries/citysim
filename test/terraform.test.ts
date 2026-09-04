import { test } from 'node:test';
import assert from 'node:assert/strict';
import { City, TERRAFORM_COST, TERRAFORM_STEP, TREE_COST, TREE_MAX } from '../src/sim/city.ts';
import { FLAT_MAP, SEA_LEVEL } from '../src/sim/terrain.ts';
import { ZONE_RES, CIVIC_BY_KEY } from '../src/sim/tiles.ts';
import { ROAD_CLASS_BY_KEY } from '../src/sim/roads.ts';
import { serialize, deserialize } from '../src/sim/save.ts';

const street = ROAD_CLASS_BY_KEY.get('street')!;

function city(seed = FLAT_MAP): City {
  const c = new City(128, 1, seed);
  c.funds = 5_000_000;
  c.peakPopulation = 1_000_000;
  c.setDisasters(false);
  c.refreshUnlocks();
  return c;
}

test('raising and lowering move the ground and charge for it', () => {
  const c = city();
  const i = c.grid.index(40, 40);
  const before = c.terrain.height[i];
  const funds = c.funds;

  assert.ok(c.terraform(i, 1).ok);
  assert.equal(c.terrain.height[i], before + TERRAFORM_STEP);
  assert.equal(c.funds, funds - TERRAFORM_COST);

  assert.ok(c.terraform(i, -1).ok);
  assert.equal(c.terrain.height[i], before, 'lowering should undo raising');
});

test('the ground stops at the top and the bottom, and says so', () => {
  const c = city();
  const i = c.grid.index(40, 40);
  for (let n = 0; n < 40; n++) c.terraform(i, 1);
  assert.equal(c.terrain.height[i], 255);
  const r = c.terraform(i, 1);
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /as high as it goes/);

  for (let n = 0; n < 40; n++) c.terraform(i, -1);
  assert.equal(c.terrain.height[i], 0);
  assert.match(c.terraform(i, -1).error ?? '', /as low as it goes/);
});

test('a refusal costs nothing', () => {
  const c = city();
  const i = c.grid.index(40, 40);
  for (let n = 0; n < 40; n++) c.terraform(i, 1);
  const funds = c.funds;
  assert.equal(c.terraform(i, 1).ok, false);
  assert.equal(c.funds, funds, 'a refused reshape must be free');
});

test('you cannot regrade under a road, a building or a lot that has grown', () => {
  // Site preparation, not demolition with extra steps. Clear the tile first if that is
  // genuinely what you meant.
  const c = city();
  const g = c.grid;
  const road = g.index(40, 40);
  assert.ok(c.buildRoad(road, street.id));
  assert.match(c.terraform(road, 1).error ?? '', /road/);

  const civic = g.index(50, 50);
  assert.ok(c.placeCivic(civic, CIVIC_BY_KEY.get('park')!.id).ok);
  assert.match(c.terraform(civic, 1).error ?? '', /building/);

  const grown = g.index(60, 60);
  c.paintZone(grown, ZONE_RES, 0);
  c.tiles.level[grown] = 2;
  assert.match(c.terraform(grown, 1).error ?? '', /built/);

  // Bare zoned land is fine — you have painted an intention, not a building.
  const zoned = g.index(70, 70);
  c.paintZone(zoned, ZONE_RES, 0);
  assert.ok(c.terraform(zoned, 1).ok);
});

test('lowering ground below sea level really does make it water', () => {
  const c = city();
  const i = c.grid.index(40, 40);
  assert.equal(c.terrain.water[i], 0);
  const wasWater = c.terrain.waterCells;
  while (c.terrain.height[i] >= SEA_LEVEL) {
    if (!c.terraform(i, -1).ok) break;
  }
  assert.ok(c.terrain.height[i] < SEA_LEVEL);
  assert.equal(c.terrain.water[i], 1, 'below sea level is water');
  assert.ok(c.terrain.waterCells > wasWater, 'and the map should know it has more water');
  // The coastline moved, so the cells beside it are now waterfront.
  assert.equal(c.terrain.shore[c.grid.index(41, 40)], 1, 'the neighbour is now shore');
});

test('raising water above sea level reclaims it as land', () => {
  const c = city();
  const i = c.grid.index(40, 40);
  while (c.terrain.height[i] >= SEA_LEVEL) if (!c.terraform(i, -1).ok) break;
  assert.equal(c.terrain.water[i], 1);
  const flooded = c.terrain.waterCells;

  while (c.terrain.height[i] < SEA_LEVEL) if (!c.terraform(i, 1).ok) break;
  assert.equal(c.terrain.water[i], 0, 'above sea level is land again');
  assert.ok(c.terrain.waterCells < flooded);
  assert.equal(c.terrain.shore[c.grid.index(41, 40)], 0, 'and the waterfront went with it');
});

test('nothing can be built on ground that has been flooded', () => {
  const c = city();
  const i = c.grid.index(40, 40);
  while (c.terrain.height[i] >= SEA_LEVEL) if (!c.terraform(i, -1).ok) break;
  assert.equal(c.buildRoad(i, street.id), false, 'a road cannot be laid on water');
  assert.equal(c.paintZone(i, ZONE_RES, 0), false, 'nor can it be zoned');
});

test('terraforming survives a save round trip, sparsely', () => {
  const c = city();
  const g = c.grid;
  for (let x = 40; x < 50; x++) assert.ok(c.terraform(g.index(x, 40), 2).ok);
  const heights = [...Array(10)].map((_, n) => c.terrain.height[g.index(40 + n, 40)]);

  const bytes = serialize(c);
  const restored = deserialize(bytes).city;
  for (let n = 0; n < 10; n++) {
    assert.equal(restored.terrain.height[g.index(40 + n, 40)], heights[n],
      `cell ${n} lost its height across save/load`);
  }
  // Sparse: ten edited tiles must not cost anything like a full height map.
  assert.ok(bytes.length < 20_000, `save is ${bytes.length} bytes — is it storing every cell?`);
});

test('a reloaded city has the coastline it was saved with', () => {
  const c = city();
  const i = c.grid.index(40, 40);
  while (c.terrain.height[i] >= SEA_LEVEL) if (!c.terraform(i, -1).ok) break;
  const restored = deserialize(serialize(c)).city;
  assert.equal(restored.terrain.water[i], 1, 'the water should come back');
  assert.equal(restored.terrain.shore[restored.grid.index(41, 40)], 1,
    'and everything derived from it');
});

test('an untouched city stores no terrain at all', () => {
  const plain = serialize(city());
  const shaped = city();
  for (let x = 40; x < 60; x++) shaped.terraform(shaped.grid.index(x, 40), 1);
  assert.ok(serialize(shaped).length > plain.length, 'edits should cost something to store');
  assert.equal(city().terrain.edits.size, 0, 'and a city nobody reshaped should store none');
});

// ---------------------------------------------------------------- landscaping
test('planting raises the amenity of the ground it is on', () => {
  // Trees are not decoration: they feed the same field parks do, so a planted street is
  // worth more to live on than a bare one.
  const c = city();
  const i = c.grid.index(40, 40);
  c.step();
  const bare = c.fields.get('amenity')[i];
  assert.ok(c.plantTrees(i, TREE_MAX).ok);
  c.step();
  assert.ok(c.fields.get('amenity')[i] > bare, 'planted ground should be worth more');
});

test('planting stops at full and clearing stops at empty', () => {
  const c = city();
  const i = c.grid.index(40, 40);
  assert.ok(c.plantTrees(i, TREE_MAX).ok);
  assert.equal(c.tiles.trees[i], TREE_MAX);
  assert.match(c.plantTrees(i, 1).error ?? '', /as dense as it gets/);

  assert.ok(c.plantTrees(i, -TREE_MAX).ok);
  assert.equal(c.tiles.trees[i], 0);
  assert.match(c.plantTrees(i, -1).error ?? '', /nothing to clear/);
});

test('clearing is free, planting is not', () => {
  const c = city();
  const i = c.grid.index(40, 40);
  const funds = c.funds;
  assert.ok(c.plantTrees(i, 1).ok);
  assert.equal(c.funds, funds - TREE_COST);
  const planted = c.funds;
  assert.ok(c.plantTrees(i, -1).ok);
  assert.equal(c.funds, planted, 'you are not charged to cut something down');
});

test('nothing is planted on water or on what is already built', () => {
  const c = city();
  const g = c.grid;
  const road = g.index(40, 40);
  assert.ok(c.buildRoad(road, street.id));
  assert.match(c.plantTrees(road, 1).error ?? '', /built/);

  const wet = g.index(50, 50);
  assert.ok(c.setWater(wet, true).ok);
  assert.match(c.plantTrees(wet, 1).error ?? '', /open water/);
});

test('whatever gets built clears the planting', () => {
  // Trees are landscaping, not an obstacle — and a house with a wood still standing on
  // its plot would double-count the amenity that made the plot attractive.
  const c = city();
  const g = c.grid;
  const i = g.index(40, 40);
  assert.ok(c.plantTrees(i, TREE_MAX).ok);
  assert.ok(c.buildRoad(i, street.id));
  assert.equal(c.tiles.trees[i], 0);

  const j = g.index(50, 50);
  assert.ok(c.plantTrees(j, TREE_MAX).ok);
  assert.ok(c.placeCivic(j, CIVIC_BY_KEY.get('park')!.id).ok);
  assert.equal(c.tiles.trees[j], 0, 'a civic footprint clears what it covers');
});

test('the water brush gets there in one click, both ways', () => {
  // Digging a lake by clicking Lower ten times is counting, not shaping.
  const c = city();
  const i = c.grid.index(40, 40);
  assert.equal(c.terrain.water[i], 0);
  assert.ok(c.setWater(i, true).ok);
  assert.equal(c.terrain.water[i], 1, 'one click should be enough');
  assert.match(c.setWater(i, true).error ?? '', /already water/);

  assert.ok(c.setWater(i, false).ok);
  assert.equal(c.terrain.water[i], 0);
  assert.match(c.setWater(i, false).error ?? '', /already dry/);
});

test('the water brush obeys the same rules as reshaping by hand', () => {
  const c = city();
  const i = c.grid.index(40, 40);
  assert.ok(c.buildRoad(i, street.id));
  assert.match(c.setWater(i, true).error ?? '', /road/);
});

test('planting survives a save round trip', () => {
  const c = city();
  const g = c.grid;
  for (let x = 40; x < 46; x++) assert.ok(c.plantTrees(g.index(x, 40), 2).ok);
  const restored = deserialize(serialize(c)).city;
  for (let x = 40; x < 46; x++) {
    assert.equal(restored.tiles.trees[g.index(x, 40)], 2, `cell ${x} lost its trees`);
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Grid } from '../src/sim/grid.ts';
import { Terrain, SEA_LEVEL } from '../src/sim/terrain.ts';
import { City, SHORE_AMENITY } from '../src/sim/city.ts';
import { serialize, deserialize } from '../src/sim/save.ts';
import { ZONE_RES, CIVIC_DEFS } from '../src/sim/tiles.ts';

test('terrain is deterministic from its seed', () => {
  const g = new Grid(128, 128);
  const a = new Terrain(g, 42);
  const b = new Terrain(g, 42);
  const c = new Terrain(g, 43);
  assert.deepEqual(Array.from(a.height), Array.from(b.height));
  assert.notDeepEqual(Array.from(a.height), Array.from(c.height));
});

test('maps leave most of the land buildable', () => {
  const g = new Grid(256, 256);
  for (let seed = 1; seed <= 8; seed++) {
    const t = new Terrain(g, seed);
    assert.ok(
      t.waterFraction > 0.02 && t.waterFraction < 0.45,
      `seed ${seed} generated ${(t.waterFraction * 100).toFixed(0)}% water`,
    );
  }
});

test('water bodies are coherent, not speckle', () => {
  // A noisy threshold would produce a shoreline nearly as long as the water area.
  const g = new Grid(256, 256);
  const t = new Terrain(g, 5);
  let shore = 0;
  for (const s of t.shore) shore += s;
  assert.ok(
    shore < t.waterCells * 0.35,
    `shoreline (${shore}) is too long for ${t.waterCells} water cells — the map is speckled`,
  );
});

test('shore cells are land that touches water', () => {
  const g = new Grid(128, 128);
  const t = new Terrain(g, 3);
  let checked = 0;
  for (let i = 0; i < t.shore.length; i++) {
    if (!t.shore[i]) continue;
    assert.equal(t.water[i], 0, 'a shore cell must be land');
    assert.ok(t.height[i] >= SEA_LEVEL);
    checked++;
  }
  assert.ok(checked > 100);
});

test('nothing can be built on water', () => {
  const c = new City(128, 7);
  let water = -1;
  for (let i = 0; i < c.terrain.water.length; i++) if (c.terrain.water[i]) { water = i; break; }
  assert.ok(water >= 0, 'expected some water on this map');

  const funds = c.funds;
  assert.equal(c.buildRoad(water), false, 'roads cannot cross water yet');
  assert.equal(c.paintZone(water, ZONE_RES, 0), false, 'water cannot be zoned');
  assert.equal(c.funds, funds, 'a rejected build must not charge the player');

  const plant = CIVIC_DEFS.find((d) => d.key === 'power')!;
  const x = water & (c.grid.width - 1);
  const y = water >>> c.grid.shift;
  if (x < c.grid.width - plant.size && y < c.grid.height - plant.size) {
    const r = c.placeCivic(water, plant.id);
    assert.equal(r.ok, false);
    assert.match(r.error ?? '', /under water/);
  }
});

test('the waterfront is an amenity', () => {
  const c = new City(128, 7);
  // Amenity access is a staggered pass (every 4 ticks), so a single step isn't enough
  // for the source to have spread anywhere.
  for (let t = 0; t < 8; t++) c.step();
  const amenity = c.fields.get('amenity');
  let shoreTiles = 0;
  for (let i = 0; i < c.terrain.shore.length; i++) {
    if (!c.terrain.shore[i]) continue;
    assert.equal(amenity[i], SHORE_AMENITY, 'shore tiles should carry amenity value');
    shoreTiles++;
  }
  assert.ok(shoreTiles > 50);
  // And that must actually reach nearby land through the amenity field.
  assert.ok(c.fields.get('amenityAccess').some((v) => v > 0), 'waterfront should spread inland');
});

test('a saved city comes back on the same map', () => {
  // Terrain isn't in the file — only the seed. If that regressed, every load would
  // silently move the city onto a different landscape.
  const original = new City(128, 1, 12345);
  original.funds = 99_000;
  const restored = deserialize(serialize(original)).city;
  assert.equal(restored.mapSeed, 12345);
  assert.deepEqual(Array.from(restored.terrain.water), Array.from(original.terrain.water));
});

test('storing only the seed keeps saves small', () => {
  const c = new City(256, 1, 99);
  const bytes = serialize(c);
  // The height map alone is 65KB; storing it would have dwarfed everything else.
  assert.ok(bytes.length < 5_000, `save grew to ${bytes.length} bytes`);
});

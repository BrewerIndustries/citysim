import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wireUtilities } from './helpers.ts';
import { FLAT_MAP } from '../src/sim/terrain.ts';
import { City } from '../src/sim/city.ts';
import { WORLD_WORKS, effectsOf } from '../src/sim/works.ts';
import { serialize, deserialize, SAVE_VERSION } from '../src/sim/save.ts';
import { ZONE_RES, ZONE_COM, CIVIC_DEFS } from '../src/sim/tiles.ts';

function played(): City {
  const c = new City(128, 1, FLAT_MAP);
  const g = c.grid;
  for (let x = 8; x < 110; x++) c.buildRoad(g.index(x, 40));
  for (let y = 30; y < 40; y++) c.buildRoad(g.index(12, y));
  c.placeCivic(g.index(10, 26), 5);
  for (let y = 37; y < 40; y++) for (let x = 20; x < 55; x++) c.paintZone(g.index(x, y), ZONE_RES, 0);
  for (let y = 41; y < 44; y++) for (let x = 20; x < 55; x++) c.paintZone(g.index(x, y), ZONE_COM, 1);
  c.placeCivic(g.index(30, 34), 1);
  c.placeCivic(g.index(45, 34), 4);
  wireUtilities(c);
  c.tax = { r: 11, c: 7, i: 13 };
  c.setDisasters(false);
  for (let t = 0; t < 220; t++) c.step();
  return c;
}

test('a saved city reloads identically', () => {
  const original = played();
  const restored = deserialize(serialize(original)).city;

  // Authored state must match exactly, tile for tile.
  for (const plane of ['zone', 'density', 'road', 'level', 'civic', 'civicAnchor'] as const) {
    assert.deepEqual(
      Array.from(restored.tiles[plane]), Array.from(original.tiles[plane]),
      `${plane} differs after a round trip`,
    );
  }
  assert.equal(restored.funds, original.funds);
  assert.deepEqual(restored.tax, original.tax);
  assert.equal(restored.month, original.month);
  assert.equal(restored.year, original.year);
  assert.equal(restored.tick, original.tick);
  assert.deepEqual(restored.disasters, original.disasters);
  assert.deepEqual(restored.disasterCounts, original.disasterCounts);
});

test('derived state is regenerated on load, not stored', () => {
  const original = played();
  const restored = deserialize(serialize(original)).city;

  // Fields aren't in the file; settling must reproduce them closely enough that the
  // player never sees the city flicker through wrong values.
  for (const field of ['landValue', 'pollution', 'policeCover', 'transitAccess', 'jobAccess'] as const) {
    const a = original.fields.get(field);
    const b = restored.fields.get(field);
    let diff = 0;
    let mag = 0;
    for (let i = 0; i < a.length; i++) { diff += Math.abs(a[i] - b[i]); mag += Math.abs(a[i]); }
    const relative = mag > 0 ? diff / mag : 0;
    assert.ok(relative < 0.02, `${field} drifted ${(relative * 100).toFixed(1)}% across save/load`);
  }
  assert.equal(restored.power.supply, original.power.supply);
});

test('a reloaded city continues identically', () => {
  // The real test of a save: play on from the restore and land in the same place.
  const original = played();
  const restored = deserialize(serialize(original)).city;
  for (let t = 0; t < 120; t++) { original.step(); restored.step(); }
  assert.equal(restored.stats.population, original.stats.population);
  assert.equal(restored.stats.jobsC, original.stats.jobsC);
  assert.equal(Math.round(restored.funds), Math.round(original.funds));
});

test('run-length encoding keeps saves small', () => {
  const bytes = serialize(played());
  // A mostly-empty 128x128 map has 7 planes of 16,384 bytes = 114KB raw.
  assert.ok(bytes.length < 20_000, `save is ${bytes.length} bytes, expected RLE to compress it`);
});

test('corrupt and future saves are rejected, not silently mangled', () => {
  assert.throws(() => deserialize(new Uint8Array([1, 2, 3, 4, 5, 6])), /not a citysim save/);

  const good = serialize(played());
  const future = good.slice();
  new DataView(future.buffer).setUint16(4, SAVE_VERSION + 1);
  assert.throws(() => deserialize(future), /newer version/);

  const truncated = good.slice(0, good.length - 40);
  assert.throws(() => deserialize(truncated));
});

test('every civic building survives a round trip', () => {
  const c = new City(128, 1, FLAT_MAP);
  // Most buildings are locked behind progression; this test is about serialisation, so
  // grant everything rather than playing up to it.
  c.peakPopulation = 1_000_000;
  c.funds = 5_000_000;
  // World works are excluded here and covered by the test below: granting everBuilt is
  // what unlocks an ordinary building, but for a work it means "already built", and no
  // city can hold two works from the same branch anyway.
  const ordinary = CIVIC_DEFS.filter((d) => !d.works);
  for (const d of ordinary) c.everBuilt.add(d.id);
  c.refreshUnlocks();
  let x = 4;
  for (const def of ordinary) {
    assert.ok(c.placeCivic(c.grid.index(x, 4), def.id).ok, `could not place ${def.label}`);
    x += def.size + 1;
  }
  const restored = deserialize(serialize(c)).city;
  for (const def of ordinary) {
    let anchors = 0;
    for (let i = 0; i < restored.tiles.civic.length; i++) {
      if (restored.tiles.civic[i] === def.id && restored.tiles.civicAnchor[i]) anchors++;
    }
    assert.equal(anchors, 1, `${def.label} lost its anchor across save/load`);
  }
});


test('every world work survives a round trip', () => {
  // One city each, because a work can only ever be built once and its branch sibling
  // can never be built at all afterwards.
  for (const def of WORLD_WORKS) {
    const c = new City(128, 1, FLAT_MAP);
    c.peakPopulation = 1_000_000;
    c.funds = 5_000_000;
    for (const d of CIVIC_DEFS) if (!d.works) c.everBuilt.add(d.id);
    // The capstone counts works already built, so give it something to count.
    if (def.unlock?.worksBuilt) {
      for (const w of WORLD_WORKS.filter((w) => w.id !== def.id).slice(0, def.unlock.worksBuilt)) {
        c.everBuilt.add(w.id);
      }
    }
    c.refreshUnlocks();
    const r = c.placeCivic(c.grid.index(4, 4), def.id);
    assert.ok(r.ok, `could not place ${def.label}: ${r.error}`);

    const restored = deserialize(serialize(c)).city;
    let anchors = 0;
    for (let i = 0; i < restored.tiles.civic.length; i++) {
      if (restored.tiles.civic[i] === def.id && restored.tiles.civicAnchor[i]) anchors++;
    }
    assert.equal(anchors, 1, `${def.label} lost its anchor across save/load`);
    // And its bonus has to come back with it, or a loaded city quietly loses its wonders.
    // Compared against effectsOf directly rather than against the source city, which has
    // not recomputed its own effects until it steps.
    restored.step();
    assert.deepEqual(restored.worksEffects, effectsOf([def.id]), `${def.label} lost its bonus`);
  }
});

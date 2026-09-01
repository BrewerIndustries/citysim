import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wireUtilities } from './helpers.ts';
import { City } from '../src/sim/city.ts';
import { Grid } from '../src/sim/grid.ts';
import { Terrain, FLAT_MAP, SEA_LEVEL, FLOOD_REACH } from '../src/sim/terrain.ts';
import { DISASTERS } from '../src/sim/disasters.ts';
import { Fields } from '../src/sim/fields.ts';
import { Rng } from '../src/sim/rng.ts';
import { ChangeLog } from '../src/sim/dirty.ts';
import { updateFireRisk, stepFires } from '../src/sim/fire.ts';
import { ZONE_RES, CIVIC_BY_KEY, Tiles } from '../src/sim/tiles.ts';
import { serialize, deserialize } from '../src/sim/save.ts';

/** A city covering most of a watery map, so disasters have something to hit. */
function wateryCity(seed = 7): City {
  const c = new City(128, 1, seed);
  const g = c.grid;
  c.funds = 5_000_000;
  c.peakPopulation = 100_000;
  c.refreshUnlocks();
  for (let y = 8; y < 120; y += 7) for (let x = 8; x < 120; x++) c.buildRoad(g.index(x, y));
  for (let x = 8; x < 120; x += 7) for (let y = 8; y < 120; y++) c.buildRoad(g.index(x, y));
  c.placeCivic(g.index(10, 4), CIVIC_BY_KEY.get('power')!.id);
  wireUtilities(c);
  for (let y = 9; y < 118; y++) {
    for (let x = 9; x < 118; x++) {
      c.paintZone(g.index(x, y), ZONE_RES, 2);
      c.tiles.level[g.index(x, y)] = 3;
    }
  }
  c.setDisasters(false);
  c.disasterRateScale = 400; // provoke events in hundreds of ticks, not tens of thousands
  for (let t = 0; t < 20; t++) c.step();
  return c;
}

test('flood risk only covers low ground near water', () => {
  const g = new Grid(256, 256);
  const t = new Terrain(g, 7);
  let checked = 0;
  for (let i = 0; i < t.floodRisk.length; i++) {
    if (t.floodRisk[i] === 0) continue;
    assert.equal(t.water[i], 0, 'water itself carries no flood risk');
    assert.ok(t.height[i] >= SEA_LEVEL, 'flood-risk cells are land');
    checked++;
  }
  assert.ok(checked > 200, 'a watery map should have some exposed land');

  // Far inland and high up must be safe.
  let safeHigh = 0;
  for (let i = 0; i < t.floodRisk.length; i++) {
    if (!t.water[i] && t.height[i] > SEA_LEVEL + 60) { assert.equal(t.floodRisk[i], 0); safeHigh++; }
  }
  assert.ok(safeHigh > 100, 'expected plenty of high ground');
});

test('a flat map has no flood risk at all', () => {
  const g = new Grid(128, 128);
  const t = new Terrain(g, FLAT_MAP);
  assert.ok(t.floodRisk.every((v) => v === 0));
  assert.ok(t.water.every((v) => v === 0));
});

test('floods only destroy buildings on flood-prone ground', () => {
  const c = wateryCity();
  c.disasters.flood = true;
  const risk = c.terrain.floodRisk;
  const before = new Uint8Array(c.tiles.level);

  // Run until a flood actually strikes.
  let ticks = 0;
  while (c.disasterCounts.flood === 0 && ticks < 4000) { c.step(); ticks++; }
  assert.ok(c.disasterCounts.flood > 0, 'expected a flood within 4,000 ticks');

  let lost = 0;
  for (let i = 0; i < before.length; i++) {
    if (before[i] > 0 && c.tiles.level[i] === 0) {
      assert.ok(risk[i] > 0, `a building at safe cell ${i} was flooded (risk ${risk[i]})`);
      lost++;
    }
  }
  assert.ok(lost > 0, 'the flood should have destroyed something');
});

test('building on high ground is genuinely safe from floods', () => {
  // The whole point of the flood-risk layer: it is advice you can act on.
  const c = new City(128, 1, 7);
  const g = c.grid;
  c.funds = 5_000_000;
  const safe: number[] = [];
  for (let i = 0; i < c.terrain.floodRisk.length && safe.length < 400; i++) {
    if (!c.terrain.water[i] && c.terrain.floodRisk[i] === 0) safe.push(i);
  }
  assert.ok(safe.length >= 400);
  for (const i of safe) { c.tiles.zone[i] = ZONE_RES; c.tiles.level[i] = 3; }
  c.setDisasters(false);
  c.disasters.flood = true;
  c.disasterRateScale = 400;

  const before = new Uint8Array(c.tiles.level);
  for (let t = 0; t < 3000; t++) c.step();
  for (const i of safe) {
    assert.equal(before[i], 3);
    assert.ok(c.tiles.level[i] > 0 || c.reason[i] !== 0, 'high ground should never flood');
  }
});

test('every disaster can be switched off', () => {
  const c = wateryCity();
  c.setDisasters(false);
  for (let t = 0; t < 3000; t++) c.step();
  for (const d of DISASTERS) {
    assert.equal(c.disasterCounts[d.key], 0, `${d.label} struck while disabled`);
  }
});

test('earthquakes and tornadoes do strike a large city', () => {
  const c = wateryCity();
  c.setDisasters(false);
  c.disasters.earthquake = true;
  c.disasters.tornado = true;
  for (let t = 0; t < 4000; t++) c.step();
  assert.ok(c.disasterCounts.earthquake > 0, 'no earthquake in 12,000 scaled ticks');
  assert.ok(c.disasterCounts.tornado > 0, 'no tornado in 12,000 scaled ticks');
  assert.ok(c.tilesLostToDisaster > 0);
});

test('a tornado cuts a narrow path, not a wide swathe', () => {
  const c = wateryCity();
  c.setDisasters(false);
  c.disasters.tornado = true;
  const before = new Uint8Array(c.tiles.level);
  let built = 0;
  for (const v of before) if (v > 0) built++;

  let guard = 0;
  while (c.disasterCounts.tornado === 0 && guard++ < 4000) c.step();
  assert.ok(c.disasterCounts.tornado > 0);
  let lost = 0;
  for (let i = 0; i < before.length; i++) if (before[i] > 0 && c.tiles.level[i] === 0) lost++;
  assert.ok(lost > 0, 'a tornado over a dense city should destroy something');
  assert.ok(lost < built * 0.1, `a tornado took ${lost} of ${built} buildings — far too wide`);
});

test('a small settlement is left alone', () => {
  // Nothing is less interesting than losing your first four houses to an earthquake.
  const c = new City(128, 1, FLAT_MAP);
  const g = c.grid;
  for (let x = 20; x < 40; x++) c.buildRoad(g.index(x, 30));
  for (let x = 20; x < 30; x++) { c.paintZone(g.index(x, 32), ZONE_RES, 0); c.tiles.level[g.index(x, 32)] = 1; }
  c.disasterRateScale = 400;
  for (let t = 0; t < 3000; t++) c.step();
  assert.equal(c.disasterCounts.earthquake, 0);
  assert.equal(c.disasterCounts.tornado, 0);
});

test('disaster settings and counts survive a save round trip', () => {
  const c = wateryCity();
  c.disasters.tornado = false;
  c.disasterCounts.earthquake = 3;
  c.tilesLostToDisaster = 42;
  const restored = deserialize(serialize(c)).city;
  assert.equal(restored.disasters.tornado, false);
  assert.equal(restored.disasterCounts.earthquake, 3);
  assert.equal(restored.tilesLostToDisaster, 42);
});

test('flood risk fades with distance from water', () => {
  const g = new Grid(256, 256);
  const t = new Terrain(g, 3);
  // No cell beyond FLOOD_REACH of water may carry risk, which is what makes "build
  // inland" a real answer rather than a hope.
  const dist = new Uint8Array(g.size).fill(255);
  const q: number[] = [];
  for (let i = 0; i < g.size; i++) if (t.water[i]) { dist[i] = 0; q.push(i); }
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    if (dist[i] >= FLOOD_REACH) continue;
    const x = i % 256;
    const y = (i / 256) | 0;
    for (const j of [x > 0 ? i - 1 : -1, x < 255 ? i + 1 : -1, y > 0 ? i - 256 : -1, y < 255 ? i + 256 : -1]) {
      if (j >= 0 && dist[j] > dist[i] + 1) { dist[j] = dist[i] + 1; q.push(j); }
    }
  }
  for (let i = 0; i < g.size; i++) {
    if (t.floodRisk[i] > 0) assert.ok(dist[i] <= FLOOD_REACH, `cell ${i} has risk but is ${dist[i]} from water`);
  }
});

test('fire frequency follows the city, not the size of the map', () => {
  // The sample is drawn uniformly across the whole grid, so each hit has to carry the
  // weight of the tiles not sampled. Weighting by the DEVELOPED count instead applied
  // the sparsity twice, and the same town burned less simply for sitting on a bigger map.
  //
  // Tested against stepFires directly: running two whole cities would spend most of its
  // time watching unserviced buildings decay before they had a chance to burn.
  const burn = (size: number) => {
    const grid = new Grid(size, size);
    const fields = new Fields(grid);
    const tiles = new Tiles(grid);
    const rng = new Rng(99);
    const changes = new ChangeLog(1 << 16);

    // The same 40x10 block of towers, wherever the map edges happen to be.
    let developed = 0;
    for (let y = 20; y < 30; y++) {
      for (let x = 20; x < 60; x++) {
        const i = grid.index(x, y);
        tiles.zone[i] = ZONE_RES;
        tiles.density[i] = 2;
        tiles.level[i] = 4;
        developed++;
      }
    }

    let fires = 0;
    for (let t = 0; t < 3000; t++) {
      updateFireRisk(fields, tiles);
      for (const e of stepFires(grid, fields, tiles, rng, developed, changes)) {
        fires++;
        // Rebuild what burned, so the exposure stays constant across the run.
        for (let y = Math.max(0, e.y - 6); y <= Math.min(size - 1, e.y + 6); y++) {
          for (let x = Math.max(0, e.x - 6); x <= Math.min(size - 1, e.x + 6); x++) {
            const i = grid.index(x, y);
            if (tiles.zone[i]) tiles.level[i] = 4;
          }
        }
      }
      changes.reset();
    }
    return fires;
  };

  const small = burn(128);
  const large = burn(512);
  assert.ok(small > 0 && large > 0, `expected fires on both maps, got ${small} and ${large}`);
  const ratio = Math.max(small, large) / Math.min(small, large);
  assert.ok(ratio < 2.5, `a 16x larger map changed the fire count ${small} -> ${large}`);
});

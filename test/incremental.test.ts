import { test } from 'node:test';
import assert from 'node:assert/strict';
import { City } from '../src/sim/city.ts';
import { FLAT_MAP } from '../src/sim/terrain.ts';
import { FIELD_NAMES } from '../src/sim/fields.ts';
import { ZONE_RES, ZONE_COM, ZONE_IND, CIVIC_BY_KEY } from '../src/sim/tiles.ts';
import { Rng } from '../src/sim/rng.ts';

/**
 * Dirty-region tracking is fast but fragile: a missed mark leaves a stale field with no
 * visible symptom until much later. So every scenario below is played twice — once with
 * tracking, once recomputing everything over the whole grid — and the fields must match
 * bit for bit.
 */
function compare(play: (c: City) => void, label: string): void {
  const fast = new City(128, 1, FLAT_MAP, false);
  const slow = new City(128, 1, FLAT_MAP, true);
  play(fast);
  play(slow);

  for (const name of FIELD_NAMES) {
    const a = fast.fields.get(name);
    const b = slow.fields.get(name);
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        assert.fail(
          `${label}: ${name} diverged at cell ${i % 128},${Math.floor(i / 128)} — ` +
          `incremental ${a[i]}, full ${b[i]}`,
        );
      }
    }
  }
  assert.equal(fast.stats.population, slow.stats.population, `${label}: population`);
  assert.equal(Math.round(fast.funds), Math.round(slow.funds), `${label}: funds`);
}

const spine = (c: City) => {
  const g = c.grid;
  for (let x = 8; x < 120; x++) c.buildRoad(g.index(x, 40));
  for (let y = 12; y < 40; y++) c.buildRoad(g.index(100, y));
  c.placeCivic(g.index(98, 8), CIVIC_BY_KEY.get('power')!.id);
};

test('incremental fields match a full recompute: growth from nothing', () => {
  compare((c) => {
    c.setDisasters(false);
    spine(c);
    for (let y = 37; y < 40; y++) for (let x = 20; x < 60; x++) c.paintZone(c.grid.index(x, y), ZONE_RES, 0);
    for (let y = 41; y < 44; y++) for (let x = 20; x < 60; x++) c.paintZone(c.grid.index(x, y), ZONE_COM, 0);
    for (let t = 0; t < 200; t++) c.step();
  }, 'growth');
});

test('incremental fields match a full recompute: building while running', () => {
  // Sources change mid-flight, which is exactly when a missed mark would show up.
  compare((c) => {
    c.setDisasters(false);
    spine(c);
    for (let t = 0; t < 40; t++) c.step();
    for (let y = 37; y < 40; y++) for (let x = 20; x < 60; x++) c.paintZone(c.grid.index(x, y), ZONE_RES, 0);
    for (let t = 0; t < 40; t++) c.step();
    c.placeCivic(c.grid.index(30, 34), CIVIC_BY_KEY.get('police')!.id);
    for (let t = 0; t < 30; t++) c.step();
    c.placeCivic(c.grid.index(45, 34), CIVIC_BY_KEY.get('park')!.id);
    for (let t = 0; t < 60; t++) c.step();
  }, 'build-while-running');
});

test('incremental fields match a full recompute: demolition and rezoning', () => {
  compare((c) => {
    c.setDisasters(false);
    spine(c);
    for (let y = 37; y < 40; y++) for (let x = 20; x < 60; x++) c.paintZone(c.grid.index(x, y), ZONE_RES, 0);
    for (let t = 0; t < 120; t++) c.step();
    for (let x = 30; x < 45; x++) c.bulldoze(c.grid.index(x, 38));
    for (let t = 0; t < 40; t++) c.step();
    for (let y = 37; y < 40; y++) for (let x = 20; x < 40; x++) c.paintZone(c.grid.index(x, y), ZONE_IND, 2);
    for (let t = 0; t < 80; t++) c.step();
    for (let y = 12; y < 30; y++) c.bulldoze(c.grid.index(100, y)); // cut the power spur
    for (let t = 0; t < 80; t++) c.step();
  }, 'demolition');
});

test('incremental fields match a full recompute: undo and redo', () => {
  compare((c) => {
    c.setDisasters(false);
    c.beginStroke('a', 'Build');
    spine(c);
    c.endStroke();
    for (let t = 0; t < 60; t++) c.step();
    c.beginStroke('b', 'Zone');
    for (let y = 37; y < 40; y++) for (let x = 20; x < 60; x++) c.paintZone(c.grid.index(x, y), ZONE_RES, 1);
    c.endStroke();
    for (let t = 0; t < 80; t++) c.step();
    c.undo();
    for (let t = 0; t < 40; t++) c.step();
    c.redo();
    for (let t = 0; t < 60; t++) c.step();
  }, 'undo-redo');
});

test('incremental fields match a full recompute: fires burning buildings', () => {
  compare((c) => {
    spine(c);
    for (let y = 37; y < 40; y++) for (let x = 20; x < 60; x++) c.paintZone(c.grid.index(x, y), ZONE_RES, 2);
    for (let t = 0; t < 3000; t++) c.step();
  }, 'fires');
});

test('incremental fields match a full recompute: random churn', () => {
  // Adversarial: scatter changes everywhere so no single dirty rect can cover them.
  compare((c) => {
    c.setDisasters(false);
    c.funds = 5_000_000;
    spine(c);
    const rng = new Rng(99);
    for (let round = 0; round < 40; round++) {
      for (let k = 0; k < 12; k++) {
        const x = 10 + rng.int(108);
        const y = 10 + rng.int(108);
        const roll = rng.next();
        if (roll < 0.55) c.paintZone(c.grid.index(x, y), 1 + rng.int(3), rng.int(3));
        else if (roll < 0.8) c.buildRoad(c.grid.index(x, y));
        else c.bulldoze(c.grid.index(x, y));
      }
      for (let t = 0; t < 6; t++) c.step();
    }
  }, 'churn');
});

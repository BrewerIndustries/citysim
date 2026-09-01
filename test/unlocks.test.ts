import { test } from 'node:test';
import assert from 'node:assert/strict';
import { City } from '../src/sim/city.ts';
import { FLAT_MAP } from '../src/sim/terrain.ts';
import { CIVIC_DEFS, CIVIC_BY_KEY } from '../src/sim/tiles.ts';
import { lockReason, isUnlocked, requirementText } from '../src/sim/unlocks.ts';
import { serialize, deserialize } from '../src/sim/save.ts';

const def = (key: string) => CIVIC_BY_KEY.get(key)!;

test('everything is reachable — no unlock depends on something unbuildable', () => {
  // A prerequisite naming a key that doesn't exist, or a cycle, would silently make a
  // branch of the tree permanently dead.
  const keys = new Set(CIVIC_DEFS.map((d) => d.key));
  for (const d of CIVIC_DEFS) {
    for (const req of d.unlock?.requires ?? []) {
      assert.ok(keys.has(req), `${d.key} requires "${req}", which is not a building`);
      assert.notEqual(req, d.key, `${d.key} requires itself`);
    }
  }
  // Walk the tree: everything must be reachable from the starting set.
  const available = new Set(CIVIC_DEFS.filter((d) => !d.unlock?.requires).map((d) => d.key));
  for (let pass = 0; pass < CIVIC_DEFS.length; pass++) {
    for (const d of CIVIC_DEFS) {
      if ((d.unlock?.requires ?? []).every((r) => available.has(r))) available.add(d.key);
    }
  }
  for (const d of CIVIC_DEFS) {
    assert.ok(available.has(d.key), `${d.key} can never be unlocked — its chain is broken`);
  }
});

test('a new city starts with the basics and nothing more', () => {
  const c = new City(128, 1, FLAT_MAP);
  assert.ok(c.unlocked.has(def('power').id), 'coal must be available from the start');
  assert.ok(c.unlocked.has(def('police').id));
  assert.ok(!c.unlocked.has(def('nuclear').id), 'nuclear must not be available at once');
  assert.ok(!c.unlocked.has(def('wind').id));
});

test('locked buildings cannot be placed, and are not charged for', () => {
  const c = new City(128, 1, FLAT_MAP);
  const funds = c.funds;
  const r = c.placeCivic(c.grid.index(20, 20), def('nuclear').id);
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /needs/i);
  assert.equal(c.funds, funds, 'a locked placement must not charge the player');
  assert.equal(c.tiles.civic[c.grid.index(20, 20)], 0);
});

test('population unlocks are earned and never taken back', () => {
  const c = new City(128, 1, FLAT_MAP);
  assert.ok(!isUnlocked(def('wind'), c.unlockState));
  c.peakPopulation = 900;
  c.refreshUnlocks();
  assert.ok(isUnlocked(def('wind'), c.unlockState), 'wind unlocks at 800 residents');

  // A collapse must not confiscate it.
  c.stats.population = 0;
  c.refreshUnlocks();
  assert.ok(isUnlocked(def('wind'), c.unlockState), 'unlocks are earned against the peak');
});

test('prerequisites are satisfied by having ever built, not by still owning', () => {
  const c = new City(128, 1, FLAT_MAP);
  c.peakPopulation = 30_000;
  c.refreshUnlocks();
  assert.ok(!isUnlocked(def('nuclear'), c.unlockState), 'nuclear also needs gas and a university');

  c.funds = 500_000;
  assert.ok(c.placeCivic(c.grid.index(10, 10), def('oil').id).ok);
  assert.ok(c.placeCivic(c.grid.index(20, 10), def('gas').id).ok);
  assert.ok(c.placeCivic(c.grid.index(30, 10), def('school').id).ok);
  assert.ok(c.placeCivic(c.grid.index(40, 10), def('university').id).ok);
  assert.ok(isUnlocked(def('nuclear'), c.unlockState));

  // Bulldozing the university must not un-invent nuclear power.
  c.bulldoze(c.grid.index(41, 11));
  c.refreshUnlocks();
  assert.ok(isUnlocked(def('nuclear'), c.unlockState));
});

test('lock reasons name every missing requirement', () => {
  const c = new City(128, 1, FLAT_MAP);
  const reason = lockReason(def('nuclear'), c.unlockState) ?? '';
  assert.match(reason, /20,000 residents/);
  assert.match(reason, /gas power plant/i);
  assert.match(reason, /university/i);
});

test('progression survives a save round trip', () => {
  const c = new City(128, 1, FLAT_MAP);
  c.peakPopulation = 12_500;
  c.funds = 500_000;
  c.placeCivic(c.grid.index(10, 10), def('oil').id);
  c.refreshUnlocks();
  const before = [...c.unlocked].sort();

  const restored = deserialize(serialize(c)).city;
  assert.equal(restored.peakPopulation, 12_500);
  assert.deepEqual([...restored.unlocked].sort(), before, 'unlocks must come back intact');
  assert.ok(restored.everBuilt.has(def('oil').id));
});

test('dirty plants pollute and clean ones do not', () => {
  // Regression: nothing made civic buildings emit at all, so the coal plant the manual
  // called filthy was in fact perfectly clean.
  const build = (key: string) => {
    const c = new City(128, 1, FLAT_MAP);
    c.peakPopulation = 100_000;
    c.funds = 500_000;
    // Grant prerequisites — this test is about emissions, not the unlock chain.
    for (const d of CIVIC_DEFS) c.everBuilt.add(d.id);
    c.refreshUnlocks();
    assert.ok(c.placeCivic(c.grid.index(60, 60), def(key).id).ok, `could not place ${key}`);
    for (let t = 0; t < 12; t++) c.step();
    const p = c.fields.get('pollution');
    let peak = 0;
    for (let i = 0; i < p.length; i++) if (p[i] > peak) peak = p[i];
    return peak;
  };

  const coal = build('power');
  const gas = build('gas');
  const nuclear = build('nuclear');

  assert.ok(coal > 0, 'a coal plant must produce pollution');
  assert.ok(gas > 0 && gas < coal, `gas (${gas.toFixed(1)}) should be cleaner than coal (${coal.toFixed(1)})`);
  assert.equal(nuclear, 0, 'nuclear must be emission-free');
});

test('every unlockable building explains itself', () => {
  for (const d of CIVIC_DEFS) {
    const text = requirementText(d);
    assert.ok(text.length > 0, `${d.key} has no requirement text`);
    if (d.unlock) assert.notEqual(text, 'Available from the start');
  }
});

test('requirement text reads as English', () => {
  for (const d of CIVIC_DEFS) {
    const text = requirementText(d);
    // "a university" is correct — the article follows the sound, not the letter — so
    // the check exempts the /juː/ openings the code also special-cases.
    assert.ok(
      !/\ba (?!uni|use|usu|uti|ubi|eu|one)[aeiou]/i.test(text),
      `"${text}" needs "an", not "a"`,
    );
    assert.ok(!/\ban (?:uni|use|usu|uti|ubi|eu|one)/i.test(text), `"${text}" needs "a", not "an"`);
    assert.ok(!text.includes('  '), `"${text}" has a doubled space`);
  }
  assert.equal(
    requirementText(def('gas')),
    '6,000 residents and an oil power plant',
  );
  assert.equal(
    requirementText(def('nuclear')),
    '20,000 residents, a gas power plant and a university',
  );
});

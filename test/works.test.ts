import { test } from 'node:test';
import assert from 'node:assert/strict';
import { City } from '../src/sim/city.ts';
import { FLAT_MAP } from '../src/sim/terrain.ts';
import { CIVIC_DEFS, CIVIC_BY_KEY } from '../src/sim/tiles.ts';
import { WORLD_WORKS, WORKS_IDS, siblingOf, effectsOf, NO_EFFECTS, theName } from '../src/sim/works.ts';
import { lockReason, requirementText, worksBuilt } from '../src/sim/unlocks.ts';
import { ACHIEVEMENTS } from '../src/sim/achievements.ts';
import { LAND_VALUE_BASE } from '../src/sim/sim.ts';

function city(): City {
  const c = new City(128, 1, FLAT_MAP);
  c.funds = 50_000_000;
  c.peakPopulation = 1_000_000;
  for (const d of CIVIC_DEFS) if (!d.works) c.everBuilt.add(d.id);
  c.refreshUnlocks();
  return c;
}

test('there are world works, and each one states what it gives', () => {
  assert.ok(WORLD_WORKS.length >= 6, 'a handful is not a late game');
  for (const d of WORLD_WORKS) {
    assert.ok(d.works!.boon.length > 12, `${d.label} does not say what it does`);
    assert.ok(d.unlock, `${d.label} must be earned, not available from the start`);
    const b = d.works!.bonus;
    assert.ok(Object.keys(b).length > 0, `${d.label} has no bonus at all`);
  }
});

test('branch siblings pair up, and pair symmetrically', () => {
  for (const d of WORLD_WORKS) {
    const sib = siblingOf(d);
    if (!sib) continue;
    assert.equal(siblingOf(sib)?.id, d.id, `${d.label} and ${sib.label} do not agree`);
    assert.notEqual(sib.id, d.id);
  }
  const branched = WORLD_WORKS.filter((d) => d.works!.branch);
  assert.ok(branched.length >= 4, 'the choice between two versions is the point');
});

test('a branch never holds more than two, or the choice stops being a fork', () => {
  const counts = new Map<string, number>();
  for (const d of WORLD_WORKS) {
    const b = d.works!.branch;
    if (b) counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  for (const [branch, n] of counts) assert.equal(n, 2, `branch '${branch}' holds ${n}`);
});

test('a world work can only be built once', () => {
  const c = city();
  const park = CIVIC_BY_KEY.get('grandpark')!;
  assert.ok(c.placeCivic(c.grid.index(10, 10), park.id).ok);
  const second = c.placeCivic(c.grid.index(30, 30), park.id);
  assert.equal(second.ok, false, 'a second Grand Park must be refused');
  assert.match(second.error ?? '', /only one/i);
});

test('building one of a pair closes the other off for good', () => {
  const c = city();
  const park = CIVIC_BY_KEY.get('grandpark')!;
  const stadium = CIVIC_BY_KEY.get('stadium')!;
  assert.equal(lockReason(stadium, c.unlockState), null, 'both should start available');

  assert.ok(c.placeCivic(c.grid.index(10, 10), park.id).ok);
  assert.match(lockReason(stadium, c.unlockState) ?? '', /Grand Park/);
  assert.equal(c.placeCivic(c.grid.index(30, 30), stadium.id).ok, false);

  // And demolishing the park does NOT give the choice back. A choice you can walk back
  // is not a choice.
  for (let i = 0; i < c.tiles.civic.length; i++) if (c.tiles.civic[i] === park.id) c.bulldoze(i);
  assert.match(lockReason(stadium, c.unlockState) ?? '', /Grand Park/);
});

test('demolishing a work loses its bonus even though the choice stays spent', () => {
  const c = city();
  const park = CIVIC_BY_KEY.get('grandpark')!;
  assert.ok(c.placeCivic(c.grid.index(10, 10), park.id).ok);
  c.step();
  assert.deepEqual(c.worksEffects, effectsOf([park.id]), 'the bonus should be live');
  assert.ok(c.landValueBase > LAND_VALUE_BASE, 'and should have raised the land value floor');

  for (let i = 0; i < c.tiles.civic.length; i++) if (c.tiles.civic[i] === park.id) c.bulldoze(i);
  c.step();
  assert.deepEqual(c.worksEffects, NO_EFFECTS, 'a demolished work does nothing');
  assert.equal(c.landValueBase, LAND_VALUE_BASE);
});

test('the capstone counts the works already built', () => {
  const c = city();
  const monument = CIVIC_BY_KEY.get('monument')!;
  assert.match(lockReason(monument, c.unlockState) ?? '', /world work/i);

  const three = WORLD_WORKS.filter((d) => d.id !== monument.id).slice(0, 3);
  for (const d of three) c.everBuilt.add(d.id);
  assert.equal(worksBuilt(c.unlockState), 3);
  assert.equal(lockReason(monument, c.unlockState), null, 'three works should open it');
  assert.match(requirementText(monument), /3 other world works/);
});

test('bonuses compose, and an empty city has none', () => {
  assert.deepEqual(effectsOf([]), NO_EFFECTS);
  const park = CIVIC_BY_KEY.get('grandpark')!;
  const belt = CIVIC_BY_KEY.get('greenbelt')!;
  const both = effectsOf([park.id, belt.id]);
  // Multipliers multiply, flats add — two works that both clean the air genuinely stack.
  assert.ok(Math.abs(both.emission - park.works!.bonus.emission! * belt.works!.bonus.emission!) < 1e-9);
  assert.equal(both.landValue, park.works!.bonus.landValue! + belt.works!.bonus.landValue!);
});

test('a tax-yield work actually raises the tax take', () => {
  const hall = CIVIC_BY_KEY.get('cityhall')!;
  assert.ok(hall.works!.bonus.taxYield! > 1);
  const e = effectsOf([hall.id]);
  assert.equal(e.taxYield, hall.works!.bonus.taxYield);
  // and nothing else moved
  assert.equal(e.emission, 1);
  assert.equal(e.landValue, 0);
});

test('every world work has an achievement, named after it', () => {
  for (const d of WORLD_WORKS) {
    const a = ACHIEVEMENTS.find((x) => x.id === `works-${d.key}`);
    assert.ok(a, `${d.label} has no achievement`);
    assert.equal(a!.group, 'World works');
    assert.ok(a!.description.includes(d.label), 'the achievement should name the building');
  }
  assert.ok(ACHIEVEMENTS.some((a) => a.id === 'works-three'), 'and one for building several');
});

test('a works achievement is earned by building it, and survives demolition', () => {
  const c = city();
  const park = CIVIC_BY_KEY.get('grandpark')!;
  const a = ACHIEVEMENTS.find((x) => x.id === 'works-grandpark')!;
  assert.equal(a.test(c, {} as never), false);
  assert.ok(c.placeCivic(c.grid.index(10, 10), park.id).ok);
  assert.equal(a.test(c, {} as never), true);
  for (let i = 0; i < c.tiles.civic.length; i++) if (c.tiles.civic[i] === park.id) c.bulldoze(i);
  assert.equal(a.test(c, {} as never), true, 'you still built it');
});

test('every world work id is registered', () => {
  for (const d of WORLD_WORKS) assert.ok(WORKS_IDS.has(d.id), `${d.label} missing from WORKS_IDS`);
  for (const d of CIVIC_DEFS.filter((x) => !x.works)) {
    assert.equal(WORKS_IDS.has(d.id), false, `${d.label} is not a world work`);
  }
});

test('requirement text keeps a building name as its own name', () => {
  // "Needs a police hq" and "a green belt" read as typos. The label knows its casing.
  const hall = CIVIC_BY_KEY.get('cityhall')!;
  assert.match(requirementText(hall), /police HQ/);
  const belt = CIVIC_BY_KEY.get('greenbelt')!;
  assert.match(requirementText(belt), /reclamation works/, 'ordinary names still lowercase');
});

test('a work that carries its own article does not get a second one', () => {
  // "Build the The Monument" is how a generated string tells you it was generated.
  for (const d of WORLD_WORKS) {
    const a = ACHIEVEMENTS.find((x) => x.id === `works-${d.key}`)!;
    assert.doesNotMatch(a.description, /\bthe The\b/i, `${d.label}: ${a.description}`);
    assert.equal(theName('The Monument'), 'The Monument');
    assert.equal(theName('Grand Park'), 'the Grand Park');
  }
});

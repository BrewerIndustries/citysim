import { test } from 'node:test';
import assert from 'node:assert/strict';
import { City } from '../src/sim/city.ts';
import { FLAT_MAP } from '../src/sim/terrain.ts';
import { ZONE_RES, ZONE_COM, ZONE_IND, CIVIC_BY_KEY, CIVIC_DEFS } from '../src/sim/tiles.ts';
import { REASON } from '../src/sim/growth.ts';
import { LAND_VALUE_TERMS } from '../src/sim/sim.ts';
import {
  wasteAt, recycleFraction, isOverflowing, WASTE_PER_STEP, RECYCLE_MAX_CUT, FREE_DISPOSAL,
} from '../src/sim/waste.ts';
import { FIELD_MAX } from '../src/sim/fields.ts';
import { wireUtilities } from './helpers.ts';

const landfill = CIVIC_BY_KEY.get('landfill')!;
const recycling = CIVIC_BY_KEY.get('recycling')!;

function city(): City {
  const c = new City(128, 1, FLAT_MAP);
  c.funds = 5_000_000;
  c.peakPopulation = 100_000;
  c.setDisasters(false);
  c.refreshUnlocks();
  return c;
}

test('an empty lot throws away nothing', () => {
  assert.equal(wasteAt(ZONE_RES, 0, 0, 0), 0);
});

test('waste scales with level and density, and industry throws away most', () => {
  assert.equal(wasteAt(ZONE_RES, 1, 0, 0), WASTE_PER_STEP[ZONE_RES]);
  assert.equal(wasteAt(ZONE_RES, 2, 1, 0), WASTE_PER_STEP[ZONE_RES] * 2 * 2);
  assert.ok(
    wasteAt(ZONE_IND, 3, 1, 0) > wasteAt(ZONE_RES, 3, 1, 0),
    'industry must throw away more than housing at the same size',
  );
});

test('recycling cuts the stream at source, but never abolishes it', () => {
  assert.equal(recycleFraction(0), 0, 'no coverage, no cut');
  assert.equal(recycleFraction(FIELD_MAX), RECYCLE_MAX_CUT, 'full coverage gives the full cut');
  const bare = wasteAt(ZONE_IND, 3, 1, 0);
  const covered = wasteAt(ZONE_IND, 3, 1, FIELD_MAX);
  assert.ok(covered < bare, 'covered ground must produce less');
  assert.ok(covered > 0, 'recycling diverts a stream, it does not abolish it');
  assert.equal(covered, bare * (1 - RECYCLE_MAX_CUT));
});

test('a village needs no disposal at all', () => {
  // Otherwise the first thing you ever build is a landfill, which is a bad opening move
  // and a worse first lesson.
  assert.equal(isOverflowing(FREE_DISPOSAL, 0), false);
  assert.equal(isOverflowing(FREE_DISPOSAL + 1, 0), true);
  assert.equal(isOverflowing(FREE_DISPOSAL + 100, 100), false, 'capacity adds to the allowance');
});

/**
 * A serviced city with far more housing than a village and nowhere to put its refuse.
 *
 * The plant and any disposal sit on the row BELOW the main street, so the power line
 * wireUtilities lays along it touches their footprints. Getting this wrong gives every
 * cell NO_POWER, which masks the refuse gate entirely.
 */
function overflowingCity(): City {
  const c = city();
  const g = c.grid;
  for (let x = 8; x < 110; x++) c.buildRoad(g.index(x, 40));
  for (let y = 37; y < 40; y++) {
    for (let x = 20; x < 90; x++) {
      const i = g.index(x, y);
      c.paintZone(i, ZONE_RES, 2);
      c.tiles.level[i] = 2;
    }
  }
  // Jobs, or residential demand goes negative and nothing reaches a growth gate at all.
  for (let y = 42; y < 45; y++) {
    for (let x = 20; x < 90; x++) c.paintZone(g.index(x, y), ZONE_COM, 1);
  }
  // Serviced enough that desirability is not what stops it: dense unpoliced housing
  // declines on its own, and a declining cell never reaches the growth gate.
  for (let x = 22; x < 88; x += 5) c.placeCivic(g.index(x, 33), CIVIC_BY_KEY.get('park')!.id);
  for (let x = 24; x < 88; x += 10) c.placeCivic(g.index(x, 30), CIVIC_BY_KEY.get('police')!.id);
  // placeCivic takes the ANCHOR (top-left); only the UI centres a footprint on the
  // cursor. Anchored on row 41, the plant's top row sits against the street on row 40
  // and so picks up the power line laid along it.
  assert.ok(c.placeCivic(g.index(100, 41), CIVIC_BY_KEY.get('power')!.id).ok, 'plant');
  wireUtilities(c, { refuse: false });
  for (let t = 0; t < 12; t++) c.step();
  assert.ok(c.power.supply > 0 && !c.power.shortfall, 'the fixture must actually have power');
  return c;
}

/** x = 92..99 on rows 41-44 is left clear for disposal, between the shops and the plant. */
const DISPOSAL_A = 92;
const DISPOSAL_B = 96;

test('a city that outgrows its disposal stops growing and says why', () => {
  const c = overflowingCity();
  assert.equal(c.waste.capacity, 0, 'this city was built with nowhere to put anything');
  assert.ok(c.waste.produced > FREE_DISPOSAL, 'and it produces more than a village');
  assert.ok(c.waste.overflow, 'so it should be overflowing');
  assert.ok(
    [...c.reason].some((r) => r === REASON.REFUSE),
    'and the Why Panel should name refuse as the reason nothing grows',
  );
});

test('building a landfill clears the overflow', () => {
  const c = overflowingCity();
  const g = c.grid;
  assert.ok(c.waste.overflow, 'precondition: overflowing');

  assert.ok(c.placeCivic(g.index(DISPOSAL_A, 41), landfill.id).ok);
  for (let t = 0; t < 12; t++) c.step();
  assert.equal(c.waste.capacity, landfill.waste, 'the tip should be counted');

  // If one landfill was not enough, the incinerator is the answer at this scale — which
  // is exactly what it is for.
  if (c.waste.overflow) {
    const inc = CIVIC_BY_KEY.get('incinerator')!;
    assert.ok(c.placeCivic(g.index(DISPOSAL_B, 41), inc.id).ok);
    for (let t = 0; t < 12; t++) c.step();
    assert.equal(c.waste.capacity, landfill.waste! + inc.waste!, 'both should count');
  }
  assert.equal(c.waste.overflow, false, 'the overflow should be gone');
});

test('a disposal site with no power takes nothing, and is named', () => {
  // The same lesson the pumps taught: a site that counts toward capacity while doing
  // nothing makes the readout lie.
  const c = city();
  const g = c.grid;
  assert.ok(c.placeCivic(g.index(40, 40), landfill.id).ok);
  for (let t = 0; t < 4; t++) c.step();
  assert.equal(c.waste.capacity, 0, 'an unpowered tip must not count toward capacity');
  assert.equal(c.waste.unpoweredSites.length, 1);
  assert.match(c.waste.unpoweredSites[0], /Landfill at 40, 40/);
});

test('recycling is a positive term in land value', () => {
  // "Adds value" has to be a number the Why Panel can attribute, not a claim in prose.
  const term = LAND_VALUE_TERMS.find((t) => t.field === 'recycleCover');
  assert.ok(term, 'recycling coverage should be a land value term');
  assert.ok(term!.weight > 0, 'and a positive one — it is the waste building worth living near');
});

test('every refuse building is buildable and does something', () => {
  for (const d of CIVIC_DEFS.filter((x) => x.waste)) {
    assert.ok(d.waste! > 0, `${d.label} must take some refuse`);
    assert.ok(d.upkeep > 0, `${d.label} should cost something to run`);
  }
  // Recycling both takes refuse and cuts it at source; that is what distinguishes it.
  assert.ok(recycling.waste! > 0);
  assert.equal(recycling.source?.field, 'recycleSrc');
  assert.equal(landfill.source, undefined, 'a hole in the ground recycles nothing');
});

test('a landfill is filthier than an incinerator, which is why it is cheap', () => {
  const inc = CIVIC_BY_KEY.get('incinerator')!;
  assert.ok(landfill.pollution! > inc.pollution!, 'the cheap option must be the foul one');
  assert.ok(inc.cost > landfill.cost, 'and the clean option the expensive one');
  assert.ok(inc.waste! > landfill.waste!, 'and it should take more');
});

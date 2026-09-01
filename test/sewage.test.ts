import { test } from 'node:test';
import assert from 'node:assert/strict';
import { City, FOUL_REACH } from '../src/sim/city.ts';
import { FLAT_MAP } from '../src/sim/terrain.ts';
import { SEPTIC_MAX_LEVEL, REASON } from '../src/sim/growth.ts';
import { ZONE_RES, ZONE_COM, CIVIC_BY_KEY, CIVIC_DEFS } from '../src/sim/tiles.ts';
import { serialize, deserialize } from '../src/sim/save.ts';
import { wireUtilities } from './helpers.ts';
import { REMOVE_TARGETS } from '../src/app/tools.ts';

const outflow = CIVIC_BY_KEY.get('sewage')!;
const treatment = CIVIC_BY_KEY.get('treatment')!;
const cleanup = CIVIC_BY_KEY.get('cleanup')!;

function city(seed = FLAT_MAP): City {
  const c = new City(128, 1, seed);
  c.funds = 5_000_000;
  c.peakPopulation = 100_000;
  c.setDisasters(false);
  c.refreshUnlocks();
  return c;
}

test('a sewer may cross a water pipe on a single tile', () => {
  // A crossing is how the sewer reaches the other side of a street. One shared tile is
  // an intersection, and intersections are legal.
  const c = city();
  const i = c.grid.index(40, 40);
  assert.ok(c.buildUtility(i, 'pipe'));
  assert.ok(c.buildUtility(i, 'sewer'), 'a sewer must be able to cross a pipe');
  assert.equal(c.tiles.pipe[i], 1);
  assert.equal(c.tiles.sewer[i], 1);
  assert.equal(c.utilityBlockedBy(i, 'sewer'), null);

  // And in the other direction: a pipe may cross an existing sewer.
  const j = c.grid.index(50, 50);
  assert.ok(c.buildUtility(j, 'sewer'));
  assert.ok(c.buildUtility(j, 'pipe'), 'a pipe must be able to cross a sewer');
});

test('a sewer may not run alongside a water pipe for two tiles', () => {
  // Two shared tiles in a row is not a crossing, it is a foul line laid along the
  // drinking supply. The rule is local: no two shared tiles may touch.
  const c = city();
  const a = c.grid.index(40, 40);
  const b = c.grid.index(41, 40);
  assert.ok(c.buildUtility(a, 'pipe'));
  assert.ok(c.buildUtility(b, 'pipe'));
  assert.ok(c.buildUtility(a, 'sewer'), 'the first crossing is fine');
  assert.equal(c.buildUtility(b, 'sewer'), false, 'the second in a row is an overlay');
  assert.equal(c.tiles.sewer[b], 0);
  assert.match(c.utilityBlockedBy(b, 'sewer') ?? '', /cross .* not run alongside/i);
});

test('the no-touching rule applies vertically as well as horizontally', () => {
  const c = city();
  const a = c.grid.index(40, 40);
  const below = c.grid.index(40, 41);
  assert.ok(c.buildUtility(a, 'pipe'));
  assert.ok(c.buildUtility(below, 'pipe'));
  assert.ok(c.buildUtility(a, 'sewer'));
  assert.equal(c.buildUtility(below, 'sewer'), false, 'a vertical overlay is still an overlay');
});

test('crossings may repeat as long as they never touch', () => {
  // A sewer running the length of a pipe on every other tile would be an overlay in
  // spirit; on alternating tiles it is a sequence of genuine crossings, which is legal.
  const c = city();
  for (let x = 40; x < 50; x++) assert.ok(c.buildUtility(c.grid.index(x, 40), 'pipe'));
  for (let x = 40; x < 50; x += 2) {
    assert.ok(c.buildUtility(c.grid.index(x, 40), 'sewer'), `crossing at ${x}`);
  }
  for (let x = 41; x < 50; x += 2) {
    assert.equal(c.buildUtility(c.grid.index(x, 40), 'sewer'), false, `overlay at ${x}`);
  }
});

test('a crossing costs nothing extra and is removable on its own', () => {
  const c = city();
  const i = c.grid.index(40, 40);
  assert.ok(c.buildUtility(i, 'pipe'));
  assert.ok(c.buildUtility(i, 'sewer'));
  assert.ok(c.removeUtility(i, 'sewer'));
  assert.equal(c.tiles.sewer[i], 0);
  assert.equal(c.tiles.pipe[i], 1, 'removing the sewer must leave the pipe alone');
});

test('a sewer shares happily with a road and a power line', () => {
  const c = city();
  const i = c.grid.index(40, 40);
  assert.ok(c.buildRoad(i));
  assert.ok(c.buildUtility(i, 'powerLine'));
  assert.ok(c.buildUtility(i, 'sewer'));
  assert.equal(c.tiles.road[i], 1);
  assert.equal(c.tiles.powerLine[i], 1);
  assert.equal(c.tiles.sewer[i], 1);
});

test('without a sewer a building stops at septic level', () => {
  // Sewage is not a third hard gate: a hamlet manages on septic, a city does not. So
  // the rule is tested directly rather than through emergent growth, which would be
  // limited by desirability long before it reached the cap.
  const grow = (sewered: boolean) => {
    const c = city();
    const g = c.grid;
    for (let x = 8; x < 110; x++) c.buildRoad(g.index(x, 40));
    for (let y = 12; y < 40; y++) c.buildRoad(g.index(100, y));
    c.placeCivic(g.index(98, 8), CIVIC_BY_KEY.get('power')!.id);
    for (let y = 37; y < 40; y++) {
      for (let x = 20; x < 55; x++) {
        const i = g.index(x, y);
        c.paintZone(i, ZONE_RES, 2);
        c.tiles.level[i] = SEPTIC_MAX_LEVEL; // already at the septic ceiling
      }
    }
    // Serviced enough that desirability is not what stops it: dense unpoliced housing
    // decays from crime long before the septic rule gets a chance to bite.
    for (let x = 22; x < 54; x += 5) c.placeCivic(g.index(x, 33), CIVIC_BY_KEY.get('park')!.id);
    for (let x = 24; x < 54; x += 10) c.placeCivic(g.index(x, 30), CIVIC_BY_KEY.get('police')!.id);
    // And jobs, or residential demand goes negative and nothing grows at all.
    for (let y = 42; y < 45; y++) {
      for (let x = 20; x < 55; x++) c.paintZone(g.index(x, y), ZONE_COM, 1);
    }
    wireUtilities(c, { sewers: false });
    if (sewered) {
      for (let x = 8; x < 110; x++) c.buildUtility(g.index(x, 41), 'sewer');
      c.placeCivic(g.index(60, 43), outflow.id);
      c.buildUtility(g.index(60, 42), 'sewer');
    }
    for (let t = 0; t < 400; t++) c.step();
    let max = 0;
    for (const l of c.tiles.level) if (l > max) max = l;
    return { max, city: c };
  };

  const septic = grow(false);
  assert.equal(septic.max, SEPTIC_MAX_LEVEL, `unsewered land must not pass ${SEPTIC_MAX_LEVEL}`);
  assert.ok(
    [...septic.city.reason].some((r) => r === REASON.NO_SEWER),
    'and the reason should say why',
  );

  const sewered = grow(true);
  assert.ok(sewered.max > SEPTIC_MAX_LEVEL, `a sewered city should build higher, got ${sewered.max}`);
});

test('unsewered buildings leak into the pollution field', () => {
  // Whatever isn't carried away has to go somewhere.
  const emissionAt = (sewered: boolean) => {
    const c = city();
    const g = c.grid;
    const i = g.index(40, 40);
    c.tiles.zone[i] = ZONE_RES;
    c.tiles.density[i] = 2;
    c.tiles.level[i] = 2;
    if (sewered) {
      c.buildUtility(i, 'sewer');
      c.placeCivic(g.index(42, 40), outflow.id);
      // Sewage works need power like everything else.
      c.placeCivic(g.index(42, 46), CIVIC_BY_KEY.get('power')!.id);
      for (let y = 42; y < 46; y++) c.buildUtility(g.index(42, y), 'powerLine');
    }
    for (let t = 0; t < 12; t++) c.step();
    return { emission: c.fields.get('emission')[i], sewered: c.tiles.sewered[i] };
  };

  const septic = emissionAt(false);
  const connected = emissionAt(true);
  assert.equal(septic.sewered, 0, 'the control should genuinely be unsewered');
  assert.equal(connected.sewered, 1, 'and the other genuinely connected');
  assert.ok(
    septic.emission > connected.emission,
    `septic housing should emit more: ${septic.emission.toFixed(2)} vs ${connected.emission.toFixed(2)}`,
  );
});

test('a raw outflow ruins the waterfront around it', () => {
  const c = city(7);
  const g = c.grid;
  // Find a shore tile to build on.
  let shore = -1;
  for (let i = 0; i < c.terrain.shore.length && shore < 0; i++) {
    const x = i & 127;
    const y = i >>> 7;
    if (c.terrain.shore[i] && x > 20 && y > 20 && x < 100 && y < 100) shore = i;
  }
  assert.ok(shore >= 0);
  c.step();
  const amenity = c.fields.get('amenity');
  assert.ok(amenity[shore] > 0, 'the waterfront should be worth something to begin with');

  assert.ok(c.placeCivic(shore, outflow.id).ok);
  c.step();
  assert.equal(amenity[shore], 0, 'and nothing once raw sewage is discharged into it');

  // Only nearby: the far shore is untouched.
  let far = -1;
  const ox = shore & 127;
  const oy = shore >>> 7;
  for (let i = 0; i < c.terrain.shore.length && far < 0; i++) {
    if (!c.terrain.shore[i]) continue;
    const dx = (i & 127) - ox;
    const dy = (i >>> 7) - oy;
    if (dx * dx + dy * dy > (FOUL_REACH * 3) ** 2) far = i;
  }
  if (far >= 0) assert.ok(amenity[far] > 0, 'a distant shore should be unaffected');
});

test('treatment is far cleaner than dumping raw', () => {
  const measure = (key: string) => {
    const c = city();
    const def = CIVIC_BY_KEY.get(key)!;
    c.placeCivic(c.grid.index(60, 60), def.id);
    for (let t = 0; t < 16; t++) c.step();
    const p = c.fields.get('pollution');
    let peak = 0;
    for (let i = 0; i < p.length; i++) peak = Math.max(peak, p[i]);
    return peak;
  };
  const raw = measure('sewage');
  const treated = measure('treatment');
  assert.ok(raw > 0);
  assert.ok(treated < raw, `treatment (${treated.toFixed(1)}) should beat raw discharge (${raw.toFixed(1)})`);
});

test('a cleanup station scrubs pollution that is already there', () => {
  // Remediation, not prevention: a city that industrialised heavily can be cleaned up
  // rather than only demolished.
  const c = city();
  const g = c.grid;
  for (let x = 40; x < 60; x++) {
    for (let y = 40; y < 50; y++) {
      const i = g.index(x, y);
      c.tiles.zone[i] = 3;
      c.tiles.density[i] = 2;
      c.tiles.level[i] = 4;
    }
  }
  for (let t = 0; t < 20; t++) c.step();
  const p = c.fields.get('pollution');
  const before = p[g.index(50, 45)];
  assert.ok(before > 20, `expected heavy pollution, got ${before.toFixed(1)}`);

  assert.ok(c.placeCivic(g.index(48, 44), cleanup.id).ok);
  for (let t = 0; t < 30; t++) c.step();
  const after = p[g.index(50, 45)];
  assert.ok(after < before * 0.5, `cleanup should cut pollution: ${before.toFixed(1)} -> ${after.toFixed(1)}`);
});

test('sewers and cleanup survive a save round trip', () => {
  const c = city();
  for (let x = 20; x < 40; x++) c.buildUtility(c.grid.index(x, 30), 'sewer');
  c.placeCivic(c.grid.index(20, 34), outflow.id);
  c.placeCivic(c.grid.index(60, 60), cleanup.id);
  for (let t = 0; t < 20; t++) c.step();

  const restored = deserialize(serialize(c)).city;
  assert.deepEqual(Array.from(restored.tiles.sewer), Array.from(c.tiles.sewer));
  restored.step();
  assert.equal(restored.sewage.supply, c.sewage.supply);
});

test('every sewage and cleanup building is reachable in the unlock tree', () => {
  for (const key of ['sewage', 'treatment', 'cleanup', 'reclamation']) {
    const def = CIVIC_DEFS.find((d) => d.key === key);
    assert.ok(def, `${key} should exist`);
  }
  assert.ok(treatment.sewage! > outflow.sewage!, 'treatment should out-capacity a raw outflow');
  assert.ok((treatment.pollution ?? 0) < (outflow.pollution ?? 0), 'and be cleaner');
});

test('a water pump with no power pumps nothing', () => {
  // The dependency chain the city actually runs on: plant, line, pump, pipe, homes.
  const c = city();
  const g = c.grid;
  assert.ok(c.placeCivic(g.index(40, 40), CIVIC_BY_KEY.get('pump')!.id).ok);
  for (let x = 42; x < 60; x++) c.buildUtility(g.index(x, 40), 'pipe');
  c.step();
  assert.equal(c.water.supply, 0, 'an unpowered pump supplies nothing');
  assert.equal(c.water.unpoweredSources.length, 1);
  assert.deepEqual(c.water.unpoweredSources[0], { x: 40, y: 40 });

  // Give it power and it comes to life.
  assert.ok(c.placeCivic(g.index(40, 46), CIVIC_BY_KEY.get('power')!.id).ok);
  for (let y = 41; y < 46; y++) c.buildUtility(g.index(40, y), 'powerLine');
  c.step();
  c.step();
  assert.ok(c.water.supply > 0, 'a powered pump should supply water');
  assert.equal(c.water.unpoweredSources.length, 0);
});

test('cutting the power cuts the water with it', () => {
  const c = city();
  const g = c.grid;
  c.placeCivic(g.index(40, 40), CIVIC_BY_KEY.get('pump')!.id);
  c.placeCivic(g.index(40, 46), CIVIC_BY_KEY.get('power')!.id);
  for (let y = 41; y < 46; y++) c.buildUtility(g.index(40, y), 'powerLine');
  for (let t = 0; t < 4; t++) c.step();
  assert.ok(c.water.supply > 0);

  for (let y = 41; y < 46; y++) c.removeUtility(g.index(40, y), 'powerLine');
  for (let t = 0; t < 4; t++) c.step();
  assert.equal(c.water.supply, 0, 'no power, no water');
});

test('the remove tool takes utilities off a tile as well as the road', () => {
  const c = city();
  const i = c.grid.index(40, 40);
  assert.ok(c.buildRoad(i));
  assert.ok(c.buildUtility(i, 'powerLine'));
  assert.ok(c.buildUtility(i, 'pipe'));

  // A named target touches nothing else, which is the point of having them.
  assert.ok(c.removeAt(i, 'pipe'));
  assert.equal(c.tiles.pipe[i], 0);
  assert.equal(c.tiles.powerLine[i], 1, 'the line must survive removing the pipe');
  assert.equal(c.tiles.road[i], 1, 'and so must the road');

  assert.ok(c.removeAt(i, 'road'));
  assert.equal(c.tiles.road[i], 0);
  assert.equal(c.tiles.powerLine[i], 1, 'a line can outlive the street it ran under');
});

test("remove 'all' clears the tile but leaves zoning and buildings", () => {
  const c = city();
  const i = c.grid.index(42, 42);
  assert.ok(c.paintZone(i, ZONE_RES, 0));
  assert.ok(c.buildUtility(i, 'powerLine'));
  assert.ok(c.buildUtility(i, 'sewer'));
  const road = c.grid.index(42, 43);
  assert.ok(c.buildRoad(road));

  assert.ok(c.removeAt(i, 'all'));
  assert.equal(c.tiles.powerLine[i], 0);
  assert.equal(c.tiles.sewer[i], 0);
  assert.equal(c.tiles.zone[i], ZONE_RES, 'remove is not a bulldozer');
});

test('removing nothing costs nothing and reports it', () => {
  const c = city();
  const i = c.grid.index(44, 44);
  const before = c.funds;
  assert.equal(c.removeAt(i, 'all'), false, 'an empty tile has nothing to remove');
  assert.equal(c.removeAt(i, 'sewer'), false);
  assert.equal(c.funds, before, 'a no-op must never be charged for');
});

test('every remove target names something the sim can actually remove', () => {
  // The UI row is generated from REMOVE_TARGETS, so a typo there would be a button that
  // silently does nothing.
  const c = city();
  const i = c.grid.index(46, 46);
  for (const t of REMOVE_TARGETS) {
    if (t.target === 'all') continue;
    if (t.target === 'road') assert.ok(c.buildRoad(i));
    else assert.ok(c.buildUtility(i, t.target), `cannot build ${t.target} to remove it`);
    assert.ok(c.removeAt(i, t.target), `remove target '${t.target}' removed nothing`);
  }
});

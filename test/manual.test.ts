import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildManual, IDEAL_ROAD_SPACING } from '../src/app/manual.ts';
import { ROAD_REACH } from '../src/sim/roads.ts';
import { CIVIC_DEFS, MAX_LEVEL } from '../src/sim/tiles.ts';
import { SERIES, HISTORY_LIMIT } from '../src/sim/history-series.ts';
import { MAX_UNDO } from '../src/sim/history.ts';
import { AUTOSAVE_MONTHS } from '../src/app/autosave.ts';
import { SHORE_AMENITY } from '../src/sim/city.ts';
import { TOOLS, RESERVED_KEYS } from '../src/app/tools.ts';
import { DISASTERS } from '../src/sim/disasters.ts';
import { ACHIEVEMENTS } from '../src/sim/achievements.ts';
import { requiredDesirability } from '../src/sim/growth.ts';
import { LAND_VALUE_TERMS } from '../src/sim/sim.ts';
import { NEUTRAL_TAX } from '../src/sim/demand.ts';

const manual = buildManual();
const section = (id: string) => {
  const s = manual.find((x) => x.id === id);
  assert.ok(s, `missing manual section: ${id}`);
  return s!.html;
};
/** Strip tags so we test the text a player actually reads. */
const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

test('every manual section has a title and content', () => {
  assert.ok(manual.length >= 8);
  for (const s of manual) {
    assert.ok(s.id && s.title, 'section needs an id and title');
    assert.ok(s.html.length > 200, `${s.id} looks empty`);
  }
});

test('the roads section quotes the real reach and spacing', () => {
  // The manual is generated from simulation constants precisely so it can't go stale.
  // If ROAD_REACH is ever tuned, this fails rather than the manual quietly lying.
  assert.equal(IDEAL_ROAD_SPACING, 2 * ROAD_REACH + 1);
  const t = text(section('roads'));
  assert.match(t, new RegExp(`within ${ROAD_REACH} tiles`));
  assert.match(t, new RegExp(`${IDEAL_ROAD_SPACING} tiles apart`));
});

test('the road diagram is drawn to the real reach', () => {
  const html = section('roads');
  assert.match(html, /<svg/, 'roads section should include the spacing diagram');
  // Every tile between the two streets must be labelled with its true distance.
  for (let d = 1; d <= ROAD_REACH; d++) {
    assert.ok(html.includes(`>${d}</text>`), `diagram is missing a distance-${d} label`);
  }
  assert.ok(
    !html.includes(`>${ROAD_REACH + 1}</text>`),
    'diagram labels a tile beyond the reach, which would be unbuildable',
  );
});

test('the services table matches the real building definitions', () => {
  const t = text(section('services'));
  for (const d of CIVIC_DEFS) {
    assert.ok(t.includes(d.label), `manual omits ${d.label}`);
    assert.ok(t.includes(`$${d.cost.toLocaleString()}`), `wrong or missing cost for ${d.label}`);
    assert.ok(t.includes(`$${d.upkeep.toLocaleString()} / mo`), `wrong upkeep for ${d.label}`);
    assert.ok(t.includes(`${d.size}×${d.size}`), `wrong footprint for ${d.label}`);
  }
});

test('the zoning section quotes the real density caps and growth thresholds', () => {
  const t = text(section('zoning'));
  for (const max of MAX_LEVEL) assert.ok(t.includes(String(max)), `missing density cap ${max}`);
  for (let lvl = 1; lvl <= MAX_LEVEL[2]; lvl++) {
    assert.ok(
      t.includes(String(requiredDesirability(lvl - 1))),
      `missing the desirability needed to reach level ${lvl}`,
    );
  }
});

test('the land value section lists exactly the terms the simulation uses', () => {
  const t = text(section('landvalue'));
  for (const term of LAND_VALUE_TERMS) {
    assert.ok(t.includes(term.label), `manual omits the ${term.label} term`);
    const sign = term.weight >= 0 ? '+' : '−';
    assert.ok(
      t.includes(`${sign}${Math.abs(term.weight).toFixed(2)}`),
      `wrong weight shown for ${term.label}`,
    );
  }
});

test('the economy section quotes the real neutral tax rate', () => {
  assert.match(text(section('economy')), new RegExp(`${NEUTRAL_TAX}%`));
});

test('the manual documents every tool group and building', () => {
  const all = manual.map((s) => text(s.html)).join(' ');
  for (const d of CIVIC_DEFS) {
    assert.ok(all.includes(d.label), `manual never mentions ${d.label}`);
  }
});

test('the transit section exists now that transit is buildable', () => {
  const t = text(section('transit'));
  for (const d of CIVIC_DEFS.filter((x) => x.source?.field === 'transitSrc')) {
    assert.ok(t.includes(d.label), `transit section omits ${d.label}`);
    assert.ok(t.includes(`$${d.cost.toLocaleString()}`), `wrong cost for ${d.label}`);
  }
});

test('the saving section quotes the real autosave cadence and undo depth', () => {
  const t = text(section('saving'));
  assert.match(t, new RegExp(`every ${AUTOSAVE_MONTHS} months`));
  assert.match(t, new RegExp(`${MAX_UNDO} steps`));
});

test('the history section lists every series', () => {
  const t = text(section('history'));
  for (const s of SERIES) assert.ok(t.includes(s.label), `history section omits ${s.label}`);
  assert.ok(t.includes(String(HISTORY_LIMIT)), 'should quote the real retention limit');
});

test('the terrain section quotes the real waterfront amenity value', () => {
  const t = text(section('terrain'));
  assert.ok(t.includes(String(SHORE_AMENITY)), 'should quote the real shore amenity');
  assert.match(t, /nothing can be built on water/i);
});

test('no tool shortcut collides with a key the interface owns', () => {
  // Regression: once the tool list outgrew the digits it started handing out letters,
  // and 'p' went to the solar farm — which silently killed the pause shortcut, because
  // the tool lookup runs before the pause check.
  for (const t of TOOLS) {
    assert.ok(t.key, `${t.label} has no shortcut`);
    assert.ok(!RESERVED_KEYS.has(t.key), `${t.label} took the reserved key "${t.key}"`);
  }
  const keys = TOOLS.map((t) => t.key);
  assert.equal(new Set(keys).size, keys.length, 'two tools share a shortcut');
});

test('the manual documents every disaster and the achievement count', () => {
  const d = text(section('disasters'));
  for (const x of DISASTERS) {
    assert.ok(d.includes(x.label), `disasters section omits ${x.label}`);
  }
  const a = text(section('achievements'));
  assert.ok(a.includes(String(ACHIEVEMENTS.length)), 'should quote the real achievement count');
});

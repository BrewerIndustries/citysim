/**
 * Fire.
 *
 * Fire stations existed from the start but nothing consumed `fireCover` — they cost
 * $100 a month and did literally nothing. This is the mechanic that makes them matter.
 *
 * Design constraint: a disaster that destroys your work at random is infuriating, so
 * fire here is *legible and preventable*. Risk is a visible data layer, it is driven
 * entirely by what the player built and how well they covered it, and full fire cover
 * reduces it by 92%. Nothing burns that the player wasn't warned about.
 */
import type { Grid } from './grid.ts';
import type { Fields } from './fields.ts';
import { FIELD_MAX } from './fields.ts';
import type { Tiles } from './tiles.ts';
import type { Rng } from './rng.ts';
import type { ChangeLog } from './dirty.ts';

/** Fraction of base risk removed by complete fire coverage. */
const COVER_EFFECT = 0.92;
/** Per-tick ignition chance for one fully-exposed level-1 building. */
const IGNITION_RATE = 0.0000075;
/** Chance a fire spreads into each adjacent developed tile, before its own cover. */
const SPREAD_CHANCE = 0.35;

export interface FireEvent {
  x: number;
  y: number;
  burned: number;
}

/**
 * Risk is proportional to how much building is on the tile and how little cover it has.
 * Written to a field so it can be shown as a layer and quoted by the Why Panel — the
 * player should never be surprised by where a fire starts.
 */
export function updateFireRisk(fields: Fields, tiles: Tiles): void {
  const risk = fields.get('fireRisk');
  const cover = fields.get('fireCover');
  const { level, density } = tiles;
  for (let i = 0; i < risk.length; i++) {
    const lvl = level[i];
    if (lvl === 0) { risk[i] = 0; continue; }
    const exposure = 1 - COVER_EFFECT * (cover[i] / FIELD_MAX);
    // Denser, taller buildings carry more risk.
    const base = lvl * (density[i] + 1) * 14;
    risk[i] = Math.min(FIELD_MAX, base * exposure);
  }
}

/**
 * Roll for ignition across the city. Returns the fires that started this tick.
 * Sampling a fixed number of candidate tiles keeps the cost independent of city size.
 */
export function stepFires(
  grid: Grid, fields: Fields, tiles: Tiles, rng: Rng, developedCells: number,
  changes: ChangeLog,
): FireEvent[] {
  if (developedCells === 0) return [];
  const risk = fields.get('fireRisk');
  const cover = fields.get('fireCover');
  const { level } = tiles;
  const events: FireEvent[] = [];

  // One draw per developed tile per tick would be O(n) RNG calls; instead sample a
  // small number of tiles and scale the rate so the expected fires-per-tick matches.
  const samples = Math.min(64, Math.max(8, developedCells >> 4));
  const scale = developedCells / samples;

  for (let s = 0; s < samples; s++) {
    const i = rng.int(grid.size);
    if (level[i] === 0) continue;
    const p = (risk[i] / FIELD_MAX) * IGNITION_RATE * scale * FIELD_MAX;
    if (rng.next() >= p) continue;

    const burned = burn(grid, tiles, cover, rng, i, changes);
    events.push({ x: i & (grid.width - 1), y: i >>> grid.shift, burned });
  }
  return events;
}

/** Level the tile and try to spread into adjacent developed tiles. */
function burn(
  grid: Grid, tiles: Tiles, cover: Float32Array, rng: Rng, start: number, changes: ChangeLog,
): number {
  const { width, height } = grid;
  const { level, distress } = tiles;
  let burned = 0;
  const frontier = [start];

  while (frontier.length) {
    const i = frontier.pop()!;
    if (level[i] === 0) continue;
    level[i] = 0;
    distress[i] = 0;
    changes.addAt(i, i & (width - 1), i >>> grid.shift);
    burned++;
    if (burned > 24) break; // a single fire can't consume the whole city

    const x = i & (width - 1);
    const y = i >>> grid.shift;
    const trySpread = (j: number) => {
      if (level[j] === 0) return;
      const resist = COVER_EFFECT * (cover[j] / FIELD_MAX);
      if (rng.next() < SPREAD_CHANCE * (1 - resist)) frontier.push(j);
    };
    if (x > 0) trySpread(i - 1);
    if (x < width - 1) trySpread(i + 1);
    if (y > 0) trySpread(i - width);
    if (y < height - 1) trySpread(i + width);
  }
  return burned;
}

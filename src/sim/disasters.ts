/**
 * Natural disasters beyond fire.
 *
 * Same principle as fire: a disaster that destroys your work at random is infuriating,
 * so each of these is either PREVENTABLE or at least LEGIBLE.
 *
 *   Flood      — strikes only low ground near water, and that risk is a data layer you
 *                can read before you build. Entirely avoidable by building uphill.
 *   Earthquake — not preventable, but rare, and fire cover limits the fires it starts.
 *   Tornado    — not preventable, rare, and narrow. It takes a street, not a city.
 *
 * All of them are individually switchable, and every one reports where it hit.
 */
import type { Grid } from './grid.ts';
import type { Fields } from './fields.ts';
import { FIELD_MAX } from './fields.ts';
import type { Tiles } from './tiles.ts';
import type { Terrain } from './terrain.ts';
import type { Rng } from './rng.ts';
import type { ChangeLog } from './dirty.ts';

export interface DisasterDef {
  key: string;
  label: string;
  /** Shown in the manual and the options panel. */
  description: string;
  /** Roughly how often, in game years, on a developed city. */
  everyYears: number;
}

/** Ticks in a game year: TICKS_PER_MONTH * 12. Kept local to avoid a circular import. */
const TICKS_PER_YEAR = 8 * 12;

export const DISASTERS: DisasterDef[] = [
  {
    key: 'fire',
    label: 'Fires',
    description: 'Start in buildings with poor fire coverage and spread to neighbours.',
    everyYears: 0, // fire has its own per-building risk model, see fire.ts
  },
  {
    key: 'flood',
    label: 'Floods',
    description: 'Inundate low ground near water. Check the Flood risk layer before building.',
    everyYears: 14,
  },
  {
    key: 'earthquake',
    label: 'Earthquakes',
    description: 'Level buildings and roads around an epicentre, and start fires.',
    everyYears: 45,
  },
  {
    key: 'tornado',
    label: 'Tornadoes',
    description: 'Cut a narrow path across the map, destroying what stands in it.',
    everyYears: 18,
  },
];

export interface DisasterEvent {
  key: string;
  label: string;
  x: number;
  y: number;
  destroyed: number;
  message: string;
}

export interface DisasterContext {
  grid: Grid;
  tiles: Tiles;
  fields: Fields;
  terrain: Terrain;
  rng: Rng;
  changes: ChangeLog;
  developedCells: number;
  enabled: Record<string, boolean>;
  /**
   * Multiplies every disaster's rate. Exists so tests can provoke a flood in a hundred
   * ticks instead of sixty thousand — waiting out a realistic once-in-14-years event is
   * not a test, it's a stall.
   */
  rateScale: number;
}

/** Roll for each disaster. Returns whatever struck this tick. */
export function stepDisasters(ctx: DisasterContext): DisasterEvent[] {
  const out: DisasterEvent[] = [];
  if (ctx.developedCells < 40) return out; // a hamlet is not worth a hurricane

  for (const def of DISASTERS) {
    if (def.everyYears === 0) continue; // handled elsewhere
    if (!ctx.enabled[def.key]) continue;
    const chance = Math.min(1, ctx.rateScale / (def.everyYears * TICKS_PER_YEAR));
    if (ctx.rng.next() >= chance) continue;

    const event =
      def.key === 'flood' ? flood(ctx, def)
      : def.key === 'earthquake' ? earthquake(ctx, def)
      : tornado(ctx, def);
    if (event) out.push(event);
  }
  return out;
}

/** Level a developed cell, recording it so the source fields are rebuilt. */
function destroy(ctx: DisasterContext, i: number, alsoRoads = false): boolean {
  const { tiles, grid, changes } = ctx;
  let hit = false;
  if (tiles.level[i] > 0) {
    tiles.level[i] = 0;
    tiles.distress[i] = 0;
    hit = true;
  }
  if (alsoRoads && tiles.road[i]) { tiles.road[i] = 0; hit = true; }
  if (hit) changes.addAt(i, i & (grid.width - 1), i >>> grid.shift);
  return hit;
}

function flood(ctx: DisasterContext, def: DisasterDef): DisasterEvent | null {
  const { grid, tiles, terrain, rng } = ctx;
  const risk = terrain.floodRisk;

  // Pick a developed cell that is actually at risk; if the city sensibly built on high
  // ground there is nothing to flood, and the disaster simply doesn't happen.
  let origin = -1;
  for (let attempt = 0; attempt < 400 && origin < 0; attempt++) {
    const i = rng.int(grid.size);
    if (tiles.level[i] > 0 && risk[i] > 40) origin = i;
  }
  if (origin < 0) return null;

  const ox = origin & (grid.width - 1);
  const oy = origin >>> grid.shift;
  const reach = 10 + rng.int(18);
  let destroyed = 0;

  for (let y = Math.max(0, oy - reach); y <= Math.min(grid.height - 1, oy + reach); y++) {
    for (let x = Math.max(0, ox - reach); x <= Math.min(grid.width - 1, ox + reach); x++) {
      const i = grid.index(x, y);
      if (risk[i] === 0) continue;
      const dx = x - ox;
      const dy = y - oy;
      if (dx * dx + dy * dy > reach * reach) continue;
      // Damage follows the risk: the lowest, wettest ground goes first.
      if (rng.next() < (risk[i] / FIELD_MAX) * 0.85) {
        if (destroy(ctx, i)) destroyed++;
      }
    }
  }

  return {
    key: def.key, label: def.label, x: ox, y: oy, destroyed,
    message: destroyed > 0
      ? `Flooding at ${ox}, ${oy} — ${destroyed} buildings lost. Low ground by the water.`
      : `Flooding at ${ox}, ${oy}, but nothing was built low enough to be lost.`,
  };
}

function earthquake(ctx: DisasterContext, def: DisasterDef): DisasterEvent | null {
  const { grid, tiles, fields, rng } = ctx;
  const origin = rng.int(grid.size);
  if (ctx.terrain.water[origin]) return null;

  const ox = origin & (grid.width - 1);
  const oy = origin >>> grid.shift;
  const magnitude = 0.4 + rng.next() * 0.6;
  const reach = Math.round(14 + magnitude * 26);
  const cover = fields.get('fireCover');
  let destroyed = 0;

  for (let y = Math.max(0, oy - reach); y <= Math.min(grid.height - 1, oy + reach); y++) {
    for (let x = Math.max(0, ox - reach); x <= Math.min(grid.width - 1, ox + reach); x++) {
      const dx = x - ox;
      const dy = y - oy;
      const d2 = dx * dx + dy * dy;
      if (d2 > reach * reach) continue;
      const falloff = 1 - Math.sqrt(d2) / reach;
      const i = grid.index(x, y);
      // Shaking levels buildings and cracks roads near the epicentre.
      if (rng.next() < falloff * magnitude * 0.7) {
        if (destroy(ctx, i, rng.next() < falloff * 0.35)) destroyed++;
      } else if (tiles.level[i] > 0 && rng.next() < falloff * 0.25) {
        // Fires follow earthquakes — unless the fire service can reach them.
        const resist = 0.92 * (cover[i] / FIELD_MAX);
        if (rng.next() > resist) { if (destroy(ctx, i)) destroyed++; }
      }
    }
  }

  return {
    key: def.key, label: def.label, x: ox, y: oy, destroyed,
    message: `Earthquake near ${ox}, ${oy} — ${destroyed} buildings lost.`,
  };
}

function tornado(ctx: DisasterContext, def: DisasterDef): DisasterEvent | null {
  const { grid, rng } = ctx;
  const w = grid.width;
  const h = grid.height;

  // Enter from an edge and cross, wandering as it goes.
  let x = rng.int(w);
  let y = rng.int(h);
  let angle = rng.next() * Math.PI * 2;
  const length = 60 + rng.int(140);
  const width = 1 + rng.int(3);
  let destroyed = 0;
  const startX = Math.round(x);
  const startY = Math.round(y);

  for (let step = 0; step < length; step++) {
    angle += (rng.next() - 0.5) * 0.35;
    x += Math.cos(angle);
    y += Math.sin(angle);
    if (x < 0 || y < 0 || x >= w || y >= h) break;
    const cx = Math.round(x);
    const cy = Math.round(y);
    for (let dy = -width; dy <= width; dy++) {
      for (let dx = -width; dx <= width; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (dx * dx + dy * dy > width * width) continue;
        if (rng.next() < 0.8 && destroy(ctx, grid.index(nx, ny))) destroyed++;
      }
    }
  }

  return {
    key: def.key, label: def.label, x: startX, y: startY, destroyed,
    message: destroyed > 0
      ? `Tornado touched down near ${startX}, ${startY} — ${destroyed} buildings lost.`
      : `A tornado passed near ${startX}, ${startY} over open ground.`,
  };
}

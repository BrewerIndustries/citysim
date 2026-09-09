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

/**
 * The kinds of infrastructure a disaster may destroy, each switchable on its own.
 *
 * Separate from which disasters are enabled, because they are different questions: one
 * is "does the weather happen", the other is "how much does it cost me when it does".
 * A player who wants earthquakes for the drama but not the week of rebuilding sewers can
 * say so.
 */
export const DAMAGE_KINDS: ReadonlyArray<{ key: string; label: string; hint: string }> = [
  { key: 'roads', label: 'Roads', hint: 'Earthquakes tear up the carriageway' },
  { key: 'powerLine', label: 'Power lines', hint: 'Cutting one strands everything beyond it' },
  { key: 'pipe', label: 'Water pipes', hint: 'A cut main leaves a district without water' },
  { key: 'sewer', label: 'Sewers', hint: 'A cut sewer sends its district back to septic' },
];

/**
 * Defaults chosen to leave the game exactly as it was.
 *
 * Earthquakes have always taken roads — it is in the disaster's own description — so that
 * stays on. Cutting buried services is NEW, and switching it on for everybody by default
 * would quietly make every existing city harder: one severed line strands everything
 * beyond it, which is a great deal of consequence for one tile. So these start off, and
 * the toggles exist to dial the game UP rather than to walk back a change nobody asked
 * for.
 */
export const DEFAULT_DAMAGE: Record<string, boolean> = {
  roads: true, powerLine: false, pipe: false, sewer: false,
};

export interface DisasterEvent {
  key: string;
  label: string;
  x: number;
  y: number;
  destroyed: number;
  /**
   * Road tiles the event took.
   *
   * Reported separately because losing a road is a different kind of loss from losing a
   * building: it silently cuts access to everything behind it, and the city has to be
   * told rather than left to notice its outskirts dying.
   */
  roadsLost: number;
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
  /** Incremented by `destroy` for every road tile taken. The city reads it and recounts. */
  roadsLost: number;
  /** Set when a utility line was cut, for the same reason. */
  linesLost: number;
  /** Which kinds of infrastructure a disaster is allowed to take. See DAMAGE_KINDS. */
  damage: Record<string, boolean>;
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

/**
 * Level a developed cell, recording it so the source fields are rebuilt.
 *
 * When it takes a road it takes the WHOLE road: the class, the height, the junction
 * marking and any control standing on it. Clearing `road` alone left a tile that was not
 * a road but still remembered being a six-lane arterial with signals on it — and left the
 * city paying upkeep for it, and every building behind it still believing it had access,
 * because nothing marked the road network dirty. `ctx.roadsLost` is how the city finds
 * out it needs to recount.
 */
function destroy(ctx: DisasterContext, i: number, alsoRoads = false): boolean {
  const { tiles, grid, changes } = ctx;
  let hit = false;
  if (tiles.level[i] > 0) {
    tiles.level[i] = 0;
    tiles.distress[i] = 0;
    hit = true;
  }
  if (alsoRoads) {
    if (ctx.damage.roads && tiles.road[i]) {
      tiles.road[i] = 0;
      tiles.roadClass[i] = 0;
      tiles.roadLevel[i] = 0;
      tiles.junction[i] = 0;
      tiles.control[i] = 0;
      ctx.roadsLost++;
      hit = true;
    }
    // Buried services go the same way as the surface above them, each switchable on its
    // own: a player who wants dramatic weather without rebuilding their sewers can have
    // exactly that.
    if (ctx.damage.powerLine && tiles.powerLine[i]) { tiles.powerLine[i] = 0; ctx.linesLost++; hit = true; }
    if (ctx.damage.pipe && tiles.pipe[i]) { tiles.pipe[i] = 0; ctx.linesLost++; hit = true; }
    if (ctx.damage.sewer && tiles.sewer[i]) { tiles.sewer[i] = 0; ctx.linesLost++; hit = true; }
  }
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
    key: def.key, label: def.label, x: ox, y: oy, destroyed, roadsLost: 0,
    message: destroyed > 0
      ? `Flooding at ${ox}, ${oy} — ${destroyed} buildings lost. Low ground by the water.`
      : `Flooding at ${ox}, ${oy}, but nothing was built low enough to be lost.`,
  };
}

function earthquake(ctx: DisasterContext, def: DisasterDef): DisasterEvent | null {
  // Only earthquakes take roads, so only earthquakes have to count them.
  const roadsBefore = ctx.roadsLost;
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
    roadsLost: ctx.roadsLost - roadsBefore,
    message: ctx.roadsLost - roadsBefore > 0
      ? `Earthquake near ${ox}, ${oy} — ${destroyed} buildings and `
        + `${ctx.roadsLost - roadsBefore} road tiles lost.`
      : `Earthquake near ${ox}, ${oy} — ${destroyed} buildings lost.`,
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
        // Buildings only. A tornado "destroys what stands in it" — the description is
        // the specification, and the ground is not something that stands.
        if (rng.next() < 0.8 && destroy(ctx, grid.index(nx, ny))) destroyed++;
      }
    }
  }

  return {
    key: def.key, label: def.label, x: startX, y: startY, destroyed, roadsLost: 0,
    message: destroyed > 0
      ? `Tornado touched down near ${startX}, ${startY} — ${destroyed} buildings lost.`
      : `A tornado passed near ${startX}, ${startY} over open ground.`,
  };
}

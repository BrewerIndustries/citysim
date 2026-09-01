import { CIVIC_DEFS } from '../sim/tiles.ts';
import { ROAD_COST, ROAD_REMOVE_COST, ZONE_COST, BULLDOZE_COST } from '../sim/city.ts';

export type ToolKind = 'inspect' | 'road' | 'removeroad' | 'zone' | 'civic' | 'bulldoze';

export interface Tool {
  id: string;
  kind: ToolKind;
  label: string;
  key: string;
  cost: number;
  zone?: number;
  civicId?: number;
  colour?: string;
  group: string;
}

/**
 * Keys the interface owns. Tools must never be assigned one of these.
 *
 * This bit us: once the tool list grew past the digits it started handing out letters,
 * and 'p' went to the solar farm — which silently killed the pause shortcut, because
 * the tool lookup runs first.
 */
export const RESERVED_KEYS = new Set(['p', 'h', 'a', '?', '[', ']', '=', '-', '+', '_']);

/**
 * Shortcut keys, in rail order. Digits first, then letters — skipping the reserved ones.
 * (`String(8 + n)` used to hand out "10" and "11", which no single keypress produces.)
 */
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0',
  'q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o',
  's', 'd', 'f', 'g', 'z', 'x', 'c', 'v', 'b', 'n', 'm']
  .filter((k) => !RESERVED_KEYS.has(k));

/** Which rail section each building belongs to. */
const GROUP_OF: Record<string, string> = {
  power: 'Power', wind: 'Power', oil: 'Power', gas: 'Power',
  solar: 'Power', nuclear: 'Power', fusion: 'Power',
  bus: 'Transit', metro: 'Transit', rail: 'Transit',
};

export const TOOLS: Tool[] = assignKeys([
  { id: 'inspect', kind: 'inspect', label: 'Inspect', key: '', cost: 0, group: 'Basics' },
  { id: 'road', kind: 'road', label: 'Road', key: '', cost: ROAD_COST, colour: '#42464e', group: 'Basics' },
  { id: 'removeroad', kind: 'removeroad', label: 'Remove road', key: '', cost: ROAD_REMOVE_COST, colour: '#5c5f68', group: 'Basics' },
  { id: 'bulldoze', kind: 'bulldoze', label: 'Bulldoze', key: '', cost: BULLDOZE_COST, colour: '#8a3f38', group: 'Basics' },

  { id: 'zone-r', kind: 'zone', label: 'Residential', key: '', cost: ZONE_COST, zone: 1, colour: '#6cb46f', group: 'Zoning' },
  { id: 'zone-c', kind: 'zone', label: 'Commercial', key: '', cost: ZONE_COST, zone: 2, colour: '#5a9ed0', group: 'Zoning' },
  { id: 'zone-i', kind: 'zone', label: 'Industrial', key: '', cost: ZONE_COST, zone: 3, colour: '#c8a45a', group: 'Zoning' },

  ...CIVIC_DEFS.map((d) => ({
    id: `civic-${d.key}`,
    kind: 'civic' as const,
    label: d.label,
    key: '',
    cost: d.cost,
    civicId: d.id,
    colour: d.colour,
    group: GROUP_OF[d.key] ?? 'Services',
  })),
]);

function assignKeys(tools: Array<Omit<Tool, 'key'> & { key: string }>): Tool[] {
  return tools.map((t, n) => ({ ...t, key: KEYS[n] ?? '' }));
}

export const DENSITY_LABELS = ['Low', 'Med', 'High'];

/**
 * How a drag is interpreted.
 *
 *   pencil     follows the cursor exactly — good for organic streets and touching up
 *   line       an L-shaped run from where you pressed to where you are
 *   rectangle  fills the whole box between press and release
 *
 * Roads default to lines and zoning to rectangles, because that is what each is almost
 * always used for; pencil stays available for both.
 */
export type DrawMode = 'pencil' | 'line' | 'rectangle';

export const DRAW_MODES: ReadonlyArray<{ mode: DrawMode; label: string; hint: string }> = [
  { mode: 'pencil', label: 'Free', hint: 'Follow the cursor exactly' },
  { mode: 'line', label: 'Line', hint: 'Straight run from press to release' },
  { mode: 'rectangle', label: 'Rect', hint: 'Fill the box between press and release' },
];

/** Which modes make sense for a tool, and which it starts on. */
export function modesFor(kind: ToolKind): { modes: DrawMode[]; preferred: DrawMode } {
  switch (kind) {
    case 'road':
    case 'removeroad':
      return { modes: ['line', 'pencil', 'rectangle'], preferred: 'line' };
    case 'zone':
    case 'bulldoze':
      return { modes: ['rectangle', 'pencil', 'line'], preferred: 'rectangle' };
    default:
      return { modes: [], preferred: 'pencil' };
  }
}

/** Every cell in the box between two corners, clipped to the map. */
export function rectCells(
  ax: number, ay: number, bx: number, by: number, width: number, height: number,
): number[] {
  const x0 = Math.max(0, Math.min(ax, bx));
  const x1 = Math.min(width - 1, Math.max(ax, bx));
  const y0 = Math.max(0, Math.min(ay, by));
  const y1 = Math.min(height - 1, Math.max(ay, by));
  const cells: number[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) cells.push(y * width + x);
  }
  return cells;
}

/** Cells along a line from a to b, stepped as an L so roads stay axis-aligned. */
export function lineCells(
  ax: number, ay: number, bx: number, by: number, width: number,
): number[] {
  const cells: number[] = [];
  const horizontalFirst = Math.abs(bx - ax) >= Math.abs(by - ay);
  const stepX = bx > ax ? 1 : -1;
  const stepY = by > ay ? 1 : -1;
  if (horizontalFirst) {
    for (let x = ax; x !== bx + stepX; x += stepX) cells.push(ay * width + x);
    for (let y = ay + stepY; y !== by + stepY; y += stepY) cells.push(y * width + bx);
  } else {
    for (let y = ay; y !== by + stepY; y += stepY) cells.push(y * width + ax);
    for (let x = ax + stepX; x !== bx + stepX; x += stepX) cells.push(by * width + x);
  }
  return cells;
}

/** Top-left cell of a footprint of `size` centred on (cx, cy). */
export function anchorFor(cx: number, cy: number, size: number): { x: number; y: number } {
  const half = (size - 1) >> 1;
  return { x: cx - half, y: cy - half };
}

/** Square brush footprint clipped to the map. */
export function brushCells(
  cx: number, cy: number, size: number, width: number, height: number,
): number[] {
  const half = (size - 1) >> 1;
  const cells: number[] = [];
  for (let y = cy - half; y < cy - half + size; y++) {
    for (let x = cx - half; x < cx - half + size; x++) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      cells.push(y * width + x);
    }
  }
  return cells;
}

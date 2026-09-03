import { CIVIC_DEFS } from '../sim/tiles.ts';
import {
  ROAD_REMOVE_COST, ZONE_COST, BULLDOZE_COST, LINE_COST, PIPE_COST,
  type RemoveTarget,
} from '../sim/city.ts';
import { ROAD_CLASSES } from '../sim/roads.ts';

export type ToolKind =
  | 'inspect' | 'road' | 'remove' | 'zone' | 'civic' | 'bulldoze'
  | 'powerline' | 'pipe' | 'sewer';

/**
 * What the Remove tool takes off a tile. `all` is the default because "remove" with a
 * qualifier you have to go and find is a worse tool than one that just clears the tile;
 * the named targets are there for the one case that needs care — pulling a sewer out
 * from under a road you want to keep.
 */
export const REMOVE_TARGETS: ReadonlyArray<{ target: RemoveTarget; label: string; hint: string }> = [
  { target: 'all', label: 'All', hint: 'Road and any lines, pipes or sewers on the tile' },
  { target: 'road', label: 'Road', hint: 'The road only, leaving the utilities under it' },
  { target: 'powerLine', label: 'Line', hint: 'Power lines only' },
  { target: 'pipe', label: 'Pipe', hint: 'Water pipes only' },
  { target: 'sewer', label: 'Sewer', hint: 'Sewers only' },
];

export interface Tool {
  id: string;
  kind: ToolKind;
  /** Which class of road this lays. Road tools only. */
  roadClass?: number;
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
 *
 * There are now more tools than there are sensible single keys, so the list runs out and
 * the tail of the rail is mouse-only. That is the right way round: the tools you reach
 * for constantly — roads, utilities, zoning — come first and keep their shortcuts.
 * (`String(8 + n)` used to hand out "10" and "11", which no single keypress produces.)
 */
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0',
  'q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o',
  's', 'd', 'f', 'g', 'z', 'x', 'c', 'v', 'b', 'n', 'm']
  .filter((k) => !RESERVED_KEYS.has(k));

/**
 * The workspace tabs.
 *
 * Forty-six tools in one rail is a wall, and most of them are irrelevant to whatever you
 * are actually doing: laying sewers has nothing to do with choosing a power plant. Tabs
 * split the rail by the JOB you are doing, so the rail shows ten things instead of
 * forty-six and the groups inside it stay as the headings they already were.
 *
 * A tab owns GROUPS, not tools — the group a tool belongs to already exists and is the
 * thing the rail headings are built from, so this is one mapping rather than a second
 * label on every tool that could fall out of step with the first. `test/tools.test.ts`
 * pins that every group lands in exactly one tab.
 */
export const TABS: ReadonlyArray<{ id: string; label: string; groups: string[]; hint: string }> = [
  { id: 'works', label: 'Public Works', hint: 'Roads, and the power, water and sewer networks',
    groups: ['Roads', 'Utilities', 'Power', 'Water'] },
  { id: 'zoning', label: 'Zoning', hint: 'What the city is allowed to build where',
    groups: ['Zoning'] },
  { id: 'education', label: 'Education', hint: 'Schools and universities',
    groups: ['Education'] },
  { id: 'safety', label: 'Safety', hint: 'Police and fire',
    groups: ['Safety'] },
  { id: 'environment', label: 'Environment', hint: 'Parks, cleanup and refuse',
    groups: ['Parks', 'Environment', 'Refuse'] },
  { id: 'transit', label: 'Transit', hint: 'Moving people without a car',
    groups: ['Transit'] },
  { id: 'works-world', label: 'World Works', hint: 'One per city, forever',
    groups: ['World works'] },
];

/**
 * Tools every tab shows, because they are how you look at and undo everything else.
 * Kept out of the tabs so that switching tabs never takes away the pointer.
 */
export const ALWAYS_ON = new Set(['inspect', 'remove', 'bulldoze']);

/** The tab a group belongs to, or undefined if nothing claims it. */
export function tabOfGroup(group: string): string | undefined {
  return TABS.find((t) => t.groups.includes(group))?.id;
}

/** Which rail section each building belongs to. */
const GROUP_OF: Record<string, string> = {
  power: 'Power', wind: 'Power', oil: 'Power', gas: 'Power',
  solar: 'Power', nuclear: 'Power', fusion: 'Power',
  pump: 'Water', waterworks: 'Water', sewage: 'Water', treatment: 'Water',
  police: 'Safety', policehq: 'Safety', fire: 'Safety', firehq: 'Safety',
  school: 'Education', university: 'Education',
  park: 'Parks', bigpark: 'Parks',
  cleanup: 'Environment', reclamation: 'Environment',
  landfill: 'Refuse', incinerator: 'Refuse', recycling: 'Refuse', recovery: 'Refuse',
  grandpark: 'World works', stadium: 'World works', terminus: 'World works',
  interchange: 'World works', cityhall: 'World works', courts: 'World works',
  greenbelt: 'World works', monument: 'World works',
  bus: 'Transit', metro: 'Transit', rail: 'Transit',
};

export const TOOLS: Tool[] = assignKeys([
  { id: 'inspect', kind: 'inspect', label: 'Inspect', key: '', cost: 0, group: 'Basics' },
  { id: 'remove', kind: 'remove', label: 'Remove', key: '', cost: ROAD_REMOVE_COST, colour: '#5c5f68', group: 'Basics' },
  { id: 'bulldoze', kind: 'bulldoze', label: 'Bulldoze', key: '', cost: BULLDOZE_COST, colour: '#8a3f38', group: 'Basics' },

  ...ROAD_CLASSES.map((c) => ({
    id: `road-${c.key}`,
    kind: 'road' as const,
    label: c.label,
    key: '',
    cost: c.cost,
    roadClass: c.id,
    colour: c.colour,
    group: 'Roads',
    note: c.note,
  })),

  { id: 'powerline', kind: 'powerline', label: 'Power line', key: '', cost: LINE_COST, colour: '#e0c65a', group: 'Utilities' },
  { id: 'pipe', kind: 'pipe', label: 'Water pipe', key: '', cost: PIPE_COST, colour: '#4fa3c8', group: 'Utilities' },
  { id: 'sewer', kind: 'sewer', label: 'Sewer', key: '', cost: PIPE_COST, colour: '#8f7a4a', group: 'Utilities' },

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
    case 'remove':
    case 'powerline':
    case 'pipe':
    case 'sewer':
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
  // The walk steps by one until it hits the end exactly, so a NaN or fractional endpoint
  // never terminates and pushes until the array is too long to exist. That happened for
  // real, from a viewport that had collapsed to zero size: the pointer maths produced a
  // cell off the map and a drag became an unrecoverable RangeError.
  if (!isCell(ax) || !isCell(ay) || !isCell(bx) || !isCell(by)) return [];
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

/** A usable grid coordinate: a whole number, in range, and actually a number. */
function isCell(v: number): boolean {
  return Number.isInteger(v) && v >= 0 && v < 4096;
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

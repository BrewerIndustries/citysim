import { CIVIC_DEFS } from '../sim/tiles.ts';
import {
  ROAD_REMOVE_COST, ZONE_COST, BULLDOZE_COST, LINE_COST, PIPE_COST, TERRAFORM_COST,
  TREE_COST, type RemoveTarget,
} from '../sim/city.ts';
import { ROAD_CLASSES } from '../sim/roads.ts';
import { JUNCTIONS, JUNCTION_BY_ID } from '../sim/junctions.ts';
import { CONTROLS } from '../sim/controls.ts';

export type ToolKind =
  | 'inspect' | 'road' | 'junction' | 'remove' | 'zone' | 'civic' | 'bulldoze'
  | 'powerline' | 'pipe' | 'sewer' | 'terraform' | 'trees' | 'water' | 'control';

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
  /** Which junction this stamps. Junction tools only. */
  junctionId?: number;
  /** How many steps of height one click moves. Terraform tools only. */
  terraform?: number;
  /** How many steps of planting one click moves. Tree tools only. */
  trees?: number;
  /** Whether this brush makes water or dry land. Water tools only. */
  wet?: boolean;
  /** Which traffic control this places. 0 removes whatever is there. Control tools only. */
  controlId?: number;
  /** Short note shown on hover, for tools that need one. */
  note?: string;
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
 * The workspace tabs, and the sections inside them.
 *
 * Forty-six tools in one rail is a wall, and most of them are irrelevant to whatever you
 * are actually doing: laying sewers has nothing to do with choosing a power plant. Tabs
 * split the rail by the JOB you are doing, and sections split a big job into the parts
 * you do one at a time — shaping the ground, drawing the streets, running the services.
 *
 * A section owns GROUPS, not tools — the group a tool belongs to already exists and is
 * the thing the rail headings are built from, so this is one mapping rather than a second
 * label on every tool that could fall out of step with the first. A tab's `groups` is
 * derived from its sections below, so there is still exactly one place that decides where
 * a group lives. `test/unlocks.test.ts` pins that every group lands in exactly one tab.
 *
 * Tabs with a single section show no section bar: a row of one choice is not a choice.
 */
export interface Section { id: string; label: string; groups: string[] }
export interface Tab { id: string; label: string; hint: string; sections: Section[]; groups: string[] }

const TAB_DEFS: ReadonlyArray<Omit<Tab, 'groups'>> = [
  { id: 'works', label: 'Public Works', hint: 'Roads, and the power, water and sewer networks',
    sections: [
      { id: 'land', label: 'Land', groups: ['Land'] },
      { id: 'roads', label: 'Roads', groups: ['Roads'] },
      { id: 'utilities', label: 'Utilities', groups: ['Utilities', 'Power', 'Water'] },
    ] },
  { id: 'zoning', label: 'Zoning', hint: 'What the city is allowed to build where',
    sections: [{ id: 'zoning', label: 'Zoning', groups: ['Zoning'] }] },
  { id: 'education', label: 'Education', hint: 'Schools and universities',
    sections: [{ id: 'education', label: 'Education', groups: ['Education'] }] },
  { id: 'safety', label: 'Safety', hint: 'Police and fire',
    sections: [{ id: 'safety', label: 'Safety', groups: ['Safety'] }] },
  { id: 'environment', label: 'Environment', hint: 'Parks, cleanup and refuse',
    sections: [
      { id: 'parks', label: 'Parks', groups: ['Parks'] },
      { id: 'cleanup', label: 'Cleanup', groups: ['Environment'] },
      { id: 'refuse', label: 'Refuse', groups: ['Refuse'] },
    ] },
  { id: 'transit', label: 'Transit', hint: 'Moving people without a car',
    sections: [{ id: 'transit', label: 'Transit', groups: ['Transit'] }] },
  { id: 'works-world', label: 'World Works', hint: 'One per city, forever',
    sections: [{ id: 'world', label: 'World works', groups: ['World works'] }] },
];

export const TABS: ReadonlyArray<Tab> = TAB_DEFS.map((t) => ({
  ...t,
  groups: t.sections.flatMap((s) => s.groups),
}));

/**
 * Tools every tab shows, because they are how you look at and undo everything else.
 * Kept out of the tabs so that switching tabs never takes away the pointer.
 */
export const ALWAYS_ON = new Set(['inspect', 'remove', 'bulldoze']);

/** The tab a group belongs to, or undefined if nothing claims it. */
export function tabOfGroup(group: string): string | undefined {
  return TABS.find((t) => t.groups.includes(group))?.id;
}

/**
 * Where a group lives, as the pair you need to show it: tab and section.
 *
 * A shortcut can reach a tool whose section is not showing, and switching the tab alone
 * would land you in the right tab looking at the wrong half of it.
 */
export function placeOfGroup(group: string): { tab: string; section: string } | undefined {
  for (const t of TABS) {
    const s = t.sections.find((sec) => sec.groups.includes(group));
    if (s) return { tab: t.id, section: s.id };
  }
  return undefined;
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

  { id: 'plant', kind: 'trees' as const, label: 'Plant trees', key: '', cost: TREE_COST,
    trees: 1, colour: '#4e8f52', group: 'Land',
    note: 'Worth living near. Whatever gets built here clears them' },
  { id: 'fell', kind: 'trees' as const, label: 'Clear trees', key: '', cost: 0,
    trees: -1, colour: '#7a6a4a', group: 'Land',
    note: 'Free — you are not charged to cut something down' },
  { id: 'flood', kind: 'water' as const, label: 'Add water', key: '', cost: TERRAFORM_COST,
    wet: true, colour: '#3f7fb0', group: 'Land',
    note: 'Puts a tile straight under sea level, without counting clicks' },
  { id: 'drain', kind: 'water' as const, label: 'Fill water', key: '', cost: TERRAFORM_COST,
    wet: false, colour: '#9a8a62', group: 'Land',
    note: 'And straight back over it' },

  { id: 'raise', kind: 'terraform' as const, label: 'Raise land', key: '', cost: TERRAFORM_COST,
    terraform: 1, colour: '#8a9a70', group: 'Land',
    note: 'Bare land only. Above sea level, water becomes ground' },
  { id: 'lower', kind: 'terraform' as const, label: 'Lower land', key: '', cost: TERRAFORM_COST,
    terraform: -1, colour: '#5a7088', group: 'Land',
    note: 'Bare land only. Below sea level, ground becomes water' },

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

  ...CONTROLS.map((c) => ({
    id: `control-${c.key}`,
    kind: 'control' as const,
    label: c.label,
    key: '',
    cost: c.cost,
    controlId: c.id,
    colour: c.colour,
    group: 'Roads',
    note: c.note,
  })),
  { id: 'control-none', kind: 'control' as const, label: 'Remove control', key: '', cost: 0,
    controlId: 0, colour: '#6a6e78', group: 'Roads',
    note: 'Takes the sign or signals away and leaves the crossing to sort itself out' },

  ...JUNCTIONS.map((j) => ({
    id: `junction-${j.key}`,
    kind: 'junction' as const,
    label: j.label,
    key: '',
    cost: j.premium,
    junctionId: j.id,
    colour: '#7a8296',
    group: 'Roads',
    note: j.note,
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
export type DrawMode = 'pencil' | 'line' | 'curve' | 'rectangle';

export const DRAW_MODES: ReadonlyArray<{ mode: DrawMode; label: string; hint: string }> = [
  { mode: 'pencil', label: 'Free', hint: 'Follow the cursor exactly' },
  { mode: 'line', label: 'Line', hint: 'Straight run from press to release' },
  { mode: 'curve', label: 'Curve', hint: 'Sweeps round the corner instead of turning square' },
  { mode: 'rectangle', label: 'Rect', hint: 'Fill the box between press and release' },
];

/** Which modes make sense for a tool, and which it starts on. */
export function modesFor(kind: ToolKind): { modes: DrawMode[]; preferred: DrawMode } {
  switch (kind) {
    case 'road':
      return { modes: ['line', 'curve', 'pencil', 'rectangle'], preferred: 'line' };
    case 'control':
      // Signs go on individual crossings, so a brush; a line of them would be nonsense.
      return { modes: ['pencil'], preferred: 'pencil' };
    case 'terraform':
    case 'trees':
    case 'water':
      // Landscaping is a brush, not a line: you sculpt by going over it.
      return { modes: ['pencil', 'rectangle'], preferred: 'pencil' };
    case 'remove':
    case 'powerline':
    case 'pipe':
    case 'sewer':
      // Curves are for roads. A curved pipe is the same pipe, drawn slower.
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

/**
 * A curved run from A to B, as a quadratic Bezier through the elbow.
 *
 * The control point is the corner `lineCells` would have turned at, so a curve is the
 * same drag as a line — press, release — just rounded off. That matters: needing a third
 * click to place a control point would make curves something you do deliberately rather
 * than something you reach for.
 *
 * The result is forced to be 4-CONNECTED. A rasterised curve naturally produces diagonal
 * steps, and a road network that steps diagonally is not connected: the distance search,
 * the utility flood and the traffic relaxation all walk orthogonally, so a diagonal road
 * is a road with a gap in it.
 */
export function curveCells(
  ax: number, ay: number, bx: number, by: number, width: number,
): number[] {
  if (!isCell(ax) || !isCell(ay) || !isCell(bx) || !isCell(by)) return [];
  // Same elbow lineCells would use, so line and curve agree about which way they bend.
  const horizontalFirst = Math.abs(bx - ax) >= Math.abs(by - ay);
  const cx = horizontalFirst ? bx : ax;
  const cy = horizontalFirst ? ay : by;

  const span = Math.abs(bx - ax) + Math.abs(by - ay);
  const steps = Math.max(1, span * 2);
  const cells: number[] = [];
  let px = ax;
  let py = ay;
  const push = (x: number, y: number) => {
    const i = y * width + x;
    if (cells[cells.length - 1] !== i) cells.push(i);
  };
  push(ax, ay);
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const u = 1 - t;
    const x = Math.round(u * u * ax + 2 * u * t * cx + t * t * bx);
    const y = Math.round(u * u * ay + 2 * u * t * cy + t * t * by);
    if (x === px && y === py) continue;
    // Fill the orthogonal steps between the last cell and this one. Rounding a curve can
    // move both axes at once, and a road that only touches at a corner is not a road.
    while (px !== x) { px += px < x ? 1 : -1; push(px, py); }
    while (py !== y) { py += py < y ? 1 : -1; push(px, py); }
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

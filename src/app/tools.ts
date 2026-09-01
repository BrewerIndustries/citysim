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

export const TOOLS: Tool[] = [
  { id: 'inspect', kind: 'inspect', label: 'Inspect', key: '1', cost: 0, group: 'Basics' },
  { id: 'road', kind: 'road', label: 'Road', key: '2', cost: ROAD_COST, colour: '#42464e', group: 'Basics' },
  { id: 'removeroad', kind: 'removeroad', label: 'Remove road', key: '3', cost: ROAD_REMOVE_COST, colour: '#5c5f68', group: 'Basics' },
  { id: 'bulldoze', kind: 'bulldoze', label: 'Bulldoze', key: '4', cost: BULLDOZE_COST, colour: '#8a3f38', group: 'Basics' },

  { id: 'zone-r', kind: 'zone', label: 'Residential', key: '5', cost: ZONE_COST, zone: 1, colour: '#6cb46f', group: 'Zoning' },
  { id: 'zone-c', kind: 'zone', label: 'Commercial', key: '6', cost: ZONE_COST, zone: 2, colour: '#5a9ed0', group: 'Zoning' },
  { id: 'zone-i', kind: 'zone', label: 'Industrial', key: '7', cost: ZONE_COST, zone: 3, colour: '#c8a45a', group: 'Zoning' },

  ...CIVIC_DEFS.map((d, n) => ({
    id: `civic-${d.key}`,
    kind: 'civic' as const,
    label: d.label,
    key: String(8 + n),
    cost: d.cost,
    civicId: d.id,
    colour: d.colour,
    group: 'Services',
  })),
];

export const DENSITY_LABELS = ['Low', 'Med', 'High'];

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

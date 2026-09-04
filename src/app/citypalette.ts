/**
 * Colours for the city view (distinct from the data-layer ramps in palette.ts).
 *
 * The palette is SEMANTIC, per docs/CAMERA-AND-ART.md: each land use owns a hue family
 * so a zoomed-out city reads as a land-use map with no overlay switched on. Building
 * level drives lightness within that family.
 */

import { CIVIC_DEFS } from '../sim/tiles.ts';
import { ROAD_CLASSES } from '../sim/roads.ts';

/** Little-endian 0xAABBGGRR, written straight into a Uint32 view of ImageData. */
export function rgb(r: number, g: number, b: number): number {
  return (255 << 24) | (b << 16) | (g << 8) | r;
}

export const GROUND = rgb(26, 32, 27);
/** Water, shaded by depth so lakes read as bodies rather than flat cutouts. */
export const WATER_DEEP = rgb(14, 26, 44);
export const WATER_SHALLOW = rgb(30, 58, 84);
export const SHORE = rgb(48, 62, 52);
/** Utility networks. Warm for power, cool for water — legible together or apart. */
export const POWER_LINE = rgb(224, 198, 90);
export const PIPE_LINE = rgb(79, 163, 200);
export const SEWER_LINE = rgb(160, 134, 74);
/** Land inside a live network's reach, shown behind the lines themselves. */
export const POWER_REACH = rgb(74, 66, 28);
export const PIPE_REACH = rgb(28, 58, 74);
export const SEWER_REACH = rgb(58, 48, 26);
export const DEAD_UTILITY = rgb(88, 74, 74);
/** Plants and pumps in a network view — where the network has to reach. */
export const SOURCE_MARK = rgb(255, 255, 255);
export const GROUND_ALT = rgb(29, 35, 30);
export const ROAD = rgb(66, 70, 78);
export const ROAD_EDGE = rgb(52, 56, 63);
export const UNPOWERED = rgb(120, 52, 48);
export const GRID_LINE = 'rgba(255,255,255,0.05)';
/** Outline drawn around contiguous developed blocks so built land reads as built. */
export const DEVELOPED_OUTLINE = 'rgba(255,255,255,0.42)';

/**
 * Empty zoned land: a dim wash of the land use's hue, so painted zones read immediately
 * but stay clearly darker than anything built on them. The first pass made empty lots
 * nearly as bright as level-1 buildings and you couldn't tell developed land from
 * land merely painted.
 */
export const ZONE_TINT = [
  GROUND,
  rgb(28, 42, 31),
  rgb(26, 36, 47),
  rgb(45, 38, 25),
];

/** Building colour ramps by zone: index is level 1..6. */
// Wider brightness span than the first pass, so level reads at a glance rather than
// requiring a side-by-side comparison. Level 1 already sits well clear of ZONE_TINT.
const RES = [rgb(62, 112, 66), rgb(84, 142, 84), rgb(108, 170, 100), rgb(136, 196, 118), rgb(168, 218, 142), rgb(202, 238, 176)];
const COM = [rgb(54, 96, 138), rgb(70, 126, 174), rgb(92, 156, 202), rgb(120, 184, 224), rgb(154, 208, 240), rgb(190, 228, 250)];
const IND = [rgb(124, 96, 48), rgb(154, 120, 58), rgb(182, 144, 70), rgb(206, 168, 88), rgb(226, 194, 118), rgb(242, 218, 158)];

export const BUILDING = [null, RES, COM, IND] as const;

/** Blend two packed colours. t = 0 gives a, t = 1 gives b. */
export function mix(a: number, b: number, t: number): number {
  const ar = a & 255, ag = (a >>> 8) & 255, ab = (a >>> 16) & 255;
  const br = b & 255, bg = (b >>> 8) & 255, bb = (b >>> 16) & 255;
  return (255 << 24) |
    (((ab + (bb - ab) * t) | 0) << 16) |
    (((ag + (bg - ag) * t) | 0) << 8) |
    ((ar + (br - ar) * t) | 0);
}

export function buildingColour(zone: number, level: number): number {
  const ramp = BUILDING[zone];
  if (!ramp) return GROUND;
  return ramp[Math.min(ramp.length - 1, Math.max(0, level - 1))];
}

/** Parse the `#rrggbb` a building defines into a packed pixel value. */
export function parseHex(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  return rgb((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

/**
 * Civic building colours, indexed by civic id — derived from the definitions rather
 * than listed here.
 *
 * This was a hand-written table of five entries while the game had five civic
 * buildings. By the time there were twenty, fifteen of them — every plant past coal,
 * both HQs, the university, the metro, and the water pump — fell through to the ground
 * colour and were simply invisible on the map once placed. Deriving it means a new
 * building cannot be forgotten.
 */
/**
 * One colour per road class, so the network's hierarchy is legible at a glance without
 * turning a layer on. Derived from ROAD_CLASSES so a new class cannot render as nothing.
 */
export const ROAD_COLOUR: Record<number, number> =
  Object.fromEntries(ROAD_CLASSES.map((c) => [c.id, parseHex(c.colour)]));

/**
 * Roads get lighter the higher they are, so a crossing reads as one road passing over
 * another rather than as a junction. Ground level is the class colour itself; each level
 * up is mixed further towards white.
 */
export const LEVEL_LIFT: readonly number[] = [0, 0.22, 0.42, 0.6];
export const ROAD_HIGH = parseHex('#e6ebf5');

/** Junction tiles read brighter than the road they are made of, so a stamp is visible. */
export const JUNCTION_MARK = parseHex('#a8b0c4');

export const CIVIC_COLOUR: Record<number, number> = Object.fromEntries(
  CIVIC_DEFS.map((d) => [d.id, parseHex(d.colour)]),
);

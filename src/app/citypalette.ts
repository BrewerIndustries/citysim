/**
 * Colours for the city view (distinct from the data-layer ramps in palette.ts).
 *
 * The palette is SEMANTIC, per docs/CAMERA-AND-ART.md: each land use owns a hue family
 * so a zoomed-out city reads as a land-use map with no overlay switched on. Building
 * level drives lightness within that family.
 */

/** Little-endian 0xAABBGGRR, written straight into a Uint32 view of ImageData. */
export function rgb(r: number, g: number, b: number): number {
  return (255 << 24) | (b << 16) | (g << 8) | r;
}

export const GROUND = rgb(26, 32, 27);
export const GROUND_ALT = rgb(29, 35, 30);
export const ROAD = rgb(66, 70, 78);
export const ROAD_EDGE = rgb(52, 56, 63);
export const UNPOWERED = rgb(120, 52, 48);
export const GRID_LINE = 'rgba(255,255,255,0.05)';

/** Empty zoned land: a wash of the land use's hue, so painted zones read immediately. */
export const ZONE_TINT = [
  GROUND,
  rgb(34, 54, 38),
  rgb(32, 46, 62),
  rgb(58, 48, 30),
];

/** Building colour ramps by zone: index is level 1..6. */
const RES = [rgb(52, 92, 58), rgb(66, 116, 70), rgb(84, 142, 84), rgb(108, 168, 100), rgb(138, 192, 120), rgb(176, 214, 150)];
const COM = [rgb(48, 82, 118), rgb(58, 104, 148), rgb(70, 128, 176), rgb(92, 154, 200), rgb(124, 182, 220), rgb(164, 208, 238)];
const IND = [rgb(112, 88, 44), rgb(140, 108, 52), rgb(166, 128, 60), rgb(190, 150, 74), rgb(210, 174, 100), rgb(228, 200, 138)];

export const BUILDING = [null, RES, COM, IND] as const;

export function buildingColour(zone: number, level: number): number {
  const ramp = BUILDING[zone];
  if (!ramp) return GROUND;
  return ramp[Math.min(ramp.length - 1, Math.max(0, level - 1))];
}

/** Civic building colours, indexed by civic id. */
export const CIVIC_COLOUR: Record<number, number> = {
  1: rgb(79, 127, 208),
  2: rgb(208, 90, 79),
  3: rgb(200, 164, 79),
  4: rgb(79, 168, 106),
  5: rgb(138, 143, 156),
};

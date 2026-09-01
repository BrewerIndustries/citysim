/**
 * Data-layer palettes.
 *
 * Overlays are a core feature, not polish (docs/FEATURES.md), so they get real colour
 * design from the start: perceptually ordered ramps, dark background, and semantically
 * matched hue per layer — nuisances run hot, amenities run cool, value runs neutral.
 */
export type Ramp = ReadonlyArray<readonly [number, number, number]>;

export const RAMPS: Record<string, Ramp> = {
  // Nuisance: dark -> ember -> hot.
  nuisance: [[10, 10, 14], [58, 22, 30], [122, 38, 40], [190, 72, 40], [238, 140, 58], [252, 214, 140]],
  // Coverage / access: dark -> teal -> pale.
  coverage: [[10, 12, 16], [16, 52, 62], [22, 96, 104], [40, 148, 148], [110, 200, 190], [214, 244, 236]],
  // Value: dark -> indigo -> gold.
  value: [[12, 12, 20], [40, 38, 84], [82, 66, 132], [140, 106, 148], [200, 160, 128], [246, 224, 176]],
  // Raw source data: neutral greyscale.
  source: [[8, 8, 10], [48, 48, 54], [96, 96, 104], [148, 148, 156], [200, 200, 208], [246, 246, 250]],
};

/**
 * Every diffused and derived field is normalised to 0-255 in the simulation
 * (see src/sim/fields.ts FIELD_MAX), so overlays share one scale. Only the raw
 * source layers carry their own units and need a custom display maximum.
 */
export const LAYERS: ReadonlyArray<{
  field: string; label: string; ramp: keyof typeof RAMPS; max: number;
  /**
   * The layer's identity colour, used when several layers are shown at once. A ramp
   * can't do that job: three different nuisances share the `nuisance` ramp and would
   * be indistinguishable, so each layer carries its own hue for composite mode.
   */
  key: readonly [number, number, number];
  /** Networks are drawn from tile planes by the renderer, not sampled from a field. */
  network?: 'power' | 'water' | 'sewer';
}> = [
  { field: 'powerNetwork', label: 'Power network', ramp: 'nuisance', max: 255, key: [250, 208, 70], network: 'power' },
  { field: 'waterNetwork', label: 'Water network', ramp: 'coverage', max: 255, key: [80, 176, 244], network: 'water' },
  { field: 'sewerNetwork', label: 'Sewer network', ramp: 'nuisance', max: 255, key: [166, 132, 74], network: 'sewer' },
  { field: 'waterTable', label: 'Water table', ramp: 'coverage', max: 255, key: [60, 132, 200] },
  { field: 'landValue', label: 'Land value', ramp: 'value', max: 120, key: [246, 214, 132] },
  { field: 'desirabilityR', label: 'Desirability — residential', ramp: 'value', max: 120, key: [110, 208, 130] },
  { field: 'desirabilityC', label: 'Desirability — commercial', ramp: 'value', max: 120, key: [92, 172, 246] },
  { field: 'desirabilityI', label: 'Desirability — industrial', ramp: 'value', max: 200, key: [240, 176, 92] },
  { field: 'pollution', label: 'Pollution', ramp: 'nuisance', max: 255, key: [236, 110, 58] },
  { field: 'crime', label: 'Crime', ramp: 'nuisance', max: 255, key: [232, 70, 110] },
  { field: 'fireRisk', label: 'Fire risk', ramp: 'nuisance', max: 255, key: [250, 150, 40] },
  { field: 'floodRisk', label: 'Flood risk', ramp: 'coverage', max: 255, key: [70, 200, 232] },
  { field: 'policeCover', label: 'Police coverage', ramp: 'coverage', max: 255, key: [96, 132, 246] },
  { field: 'fireCover', label: 'Fire coverage', ramp: 'coverage', max: 255, key: [238, 122, 122] },
  { field: 'schoolCover', label: 'School coverage', ramp: 'coverage', max: 255, key: [196, 128, 244] },
  { field: 'transitAccess', label: 'Transit access', ramp: 'coverage', max: 255, key: [88, 216, 200] },
  { field: 'cleanupCover', label: 'Cleanup coverage', ramp: 'coverage', max: 255, key: [96, 220, 150] },
  { field: 'recycleCover', label: 'Recycling coverage', ramp: 'coverage', max: 255, key: [120, 232, 168] },
  { field: 'amenityAccess', label: 'Amenity access', ramp: 'coverage', max: 255, key: [152, 224, 108] },
  { field: 'jobAccess', label: 'Job access', ramp: 'coverage', max: 255, key: [224, 196, 84] },
  { field: 'popR', label: 'Residents (raw)', ramp: 'source', max: 30, key: [208, 208, 216] },
  { field: 'emission', label: 'Emissions (raw)', ramp: 'source', max: 70, key: [200, 128, 96] },
  { field: 'wasteSrc', label: 'Refuse (raw)', ramp: 'source', max: 40, key: [180, 172, 130] },
];

/** Build a 256-entry RGBA lookup table so the hot pixel loop is a single array read. */
export function buildLut(ramp: Ramp): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4);
  const segments = ramp.length - 1;
  for (let i = 0; i < 256; i++) {
    const t = (i / 255) * segments;
    const seg = Math.min(Math.floor(t), segments - 1);
    const f = t - seg;
    const a = ramp[seg];
    const b = ramp[seg + 1];
    lut[i * 4 + 0] = a[0] + (b[0] - a[0]) * f;
    lut[i * 4 + 1] = a[1] + (b[1] - a[1]) * f;
    lut[i * 4 + 2] = a[2] + (b[2] - a[2]) * f;
    lut[i * 4 + 3] = 255;
  }
  return lut;
}

/**
 * How many data layers may be shown at once. Every selected field plane is copied out
 * of the worker each frame, so this is a bandwidth ceiling as much as a legibility one —
 * and past four hues a composite stops being readable anyway.
 */
export const MAX_LAYERS = 4;

/**
 * Toggle a layer in the current selection.
 *
 * Kept here rather than in the UI because the rules are worth pinning by test: single
 * mode replaces, multi mode adds up to `MAX_LAYERS` and refuses beyond that, and
 * re-selecting the only active layer clears the overlay rather than leaving a selection
 * you can't turn off.
 */
export function toggleLayer(active: readonly number[], i: number, multi: boolean): number[] {
  if (!multi) return active.length === 1 && active[0] === i ? [] : [i];
  if (active.includes(i)) return active.filter((n) => n !== i);
  if (active.length >= MAX_LAYERS) return [...active];
  return [...active, i];
}

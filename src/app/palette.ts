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
export const LAYERS: ReadonlyArray<{ field: string; label: string; ramp: keyof typeof RAMPS; max: number }> = [
  { field: 'landValue', label: 'Land value', ramp: 'value', max: 120 },
  { field: 'desirabilityR', label: 'Desirability — residential', ramp: 'value', max: 120 },
  { field: 'desirabilityC', label: 'Desirability — commercial', ramp: 'value', max: 120 },
  { field: 'desirabilityI', label: 'Desirability — industrial', ramp: 'value', max: 200 },
  { field: 'pollution', label: 'Pollution', ramp: 'nuisance', max: 255 },
  { field: 'crime', label: 'Crime', ramp: 'nuisance', max: 255 },
  { field: 'fireRisk', label: 'Fire risk', ramp: 'nuisance', max: 255 },
  { field: 'policeCover', label: 'Police coverage', ramp: 'coverage', max: 255 },
  { field: 'fireCover', label: 'Fire coverage', ramp: 'coverage', max: 255 },
  { field: 'schoolCover', label: 'School coverage', ramp: 'coverage', max: 255 },
  { field: 'transitAccess', label: 'Transit access', ramp: 'coverage', max: 255 },
  { field: 'amenityAccess', label: 'Amenity access', ramp: 'coverage', max: 255 },
  { field: 'jobAccess', label: 'Job access', ramp: 'coverage', max: 255 },
  { field: 'popR', label: 'Residents (raw)', ramp: 'source', max: 30 },
  { field: 'emission', label: 'Emissions (raw)', ramp: 'source', max: 70 },
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

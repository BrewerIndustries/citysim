/**
 * Synthetic city generator.
 *
 * Exists so we can measure Tier 1/2/3 performance BEFORE any real content exists — the
 * rule from docs/TECH-STACK.md. It is not a map generator for the game; it just fills the
 * source fields with a plausible city-shaped load so the tick cost is realistic.
 *
 * Deterministic from the seed.
 */
import { Simulation } from '../sim/sim.ts';
import { Rng } from '../sim/rng.ts';

export interface GeneratedCity {
  sim: Simulation;
  population: number;
  builtCells: number;
}

export function generateCity(width: number, height: number, seed = 1, forceAllPasses = false): GeneratedCity {
  const sim = new Simulation({ width, height, seed, forceAllPasses });
  const { grid, fields } = sim;
  const rng = new Rng(seed);

  const emission = fields.get('emission');
  const crimeGen = fields.get('crimeGen');
  const amenity = fields.get('amenity');
  const popR = fields.get('popR');
  const jobsC = fields.get('jobsC');
  const jobsI = fields.get('jobsI');
  const policeSrc = fields.get('policeSrc');
  const fireSrc = fields.get('fireSrc');
  const schoolSrc = fields.get('schoolSrc');
  const transitSrc = fields.get('transitSrc');

  // One downtown per ~250k cells, so bigger grids get polycentric cities rather than
  // one enormous blob — which is what a real metropolis looks like and what stresses
  // the diffusion passes hardest (many overlapping gradients).
  const centreCount = Math.max(1, Math.round(grid.size / 250_000));
  const centres: Array<{ x: number; y: number; r: number }> = [];
  for (let i = 0; i < centreCount; i++) {
    centres.push({
      x: rng.int(width),
      y: rng.int(height),
      r: rng.range(width * 0.10, width * 0.28),
    });
  }

  let population = 0;
  let builtCells = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Density = strongest nearby centre's radial falloff.
      let density = 0;
      for (const c of centres) {
        const dx = x - c.x;
        const dy = y - c.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < c.r) {
          const v = 1 - d / c.r;
          if (v > density) density = v;
        }
      }
      if (density <= 0.02) continue;

      const roll = rng.next();
      if (roll > density * 0.85) continue; // undeveloped gaps

      const i = grid.index(x, y);
      builtCells++;

      // Industry is ~7% of built area, not 15%: at 15% with a radius-12 plume it
      // blankets the whole map in pollution and every other field stops mattering.
      const kind = rng.next();
      if (kind < 0.58) {
        // Residential — denser toward the centre.
        const people = 2 + density * density * 26;
        popR[i] = people;
        population += people;
        crimeGen[i] = 2 + density * 8;
        emission[i] = density * 1.5;
      } else if (kind < 0.93) {
        // Commercial.
        jobsC[i] = 2 + density * density * 18;
        crimeGen[i] = 3 + density * 6;
        emission[i] = density * 2.5;
      } else {
        // Industry — sited toward the edges in a real city, and dirty.
        jobsI[i] = 3 + (1 - density) * 12;
        emission[i] = 14 + (1 - density) * 22;
        crimeGen[i] = 2;
      }

      // Sparse civic infrastructure.
      const civic = rng.next();
      if (civic < 0.0012) policeSrc[i] = 140;
      else if (civic < 0.0022) fireSrc[i] = 130;
      else if (civic < 0.0034) schoolSrc[i] = 150;
      else if (civic < 0.0130) transitSrc[i] = 80;
      else if (civic < 0.0600) amenity[i] = 60 + rng.next() * 60;
    }
  }

  return { sim, population: Math.round(population), builtCells };
}

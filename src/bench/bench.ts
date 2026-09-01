/**
 * Performance benchmark across the scaling ladder in docs/TECH-STACK.md.
 *
 *   Tier 1 —  512^2, ~200k pop      ship gate: 60fps + 10 ticks/s
 *   Tier 2 — 1024^2, ~1M pop        must remain reachable
 *   Tier 3 — 2048^2, multi-million  may degrade, must never stall
 *
 * Budget: at 10 ticks/sec the simulation has 100ms per tick, shared with rendering.
 *
 * Three regimes are reported, because with dirty-region tracking a single number would
 * be dishonest — the cost depends entirely on how much is changing:
 *
 *   cold     every field recomputed over the whole grid (first tick, or after a load)
 *   growing  a live city with buildings developing and decaying
 *   settled  nothing changing; the diffusion is skipped outright
 *
 * The GATE is the growing figure: it's what a player actually experiences.
 *
 *   node src/bench/bench.ts               # tiers 1 and 2
 *   node src/bench/bench.ts --tiers=1,2,3
 */
import { generateCity } from './generate.ts';
import type { City } from '../sim/city.ts';

const TIERS: Record<string, { size: number; label: string }> = {
  '1': { size: 512, label: 'Tier 1  (ship gate)' },
  '2': { size: 1024, label: 'Tier 2  (must stay reachable)' },
  '3': { size: 2048, label: 'Tier 3  (metropolis mode)' },
};

const TICK_BUDGET_MS = 100;

const arg = process.argv.find((a) => a.startsWith('--tiers='));
const wanted: string[] = (arg ? arg.slice('--tiers='.length) : '1,2').split(',');

function timeTicks(city: City, ticks: number): { median: number; p95: number; max: number } {
  const samples: number[] = [];
  for (let i = 0; i < ticks; i++) {
    const t0 = performance.now();
    city.step();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return {
    median: samples[Math.floor(samples.length / 2)],
    p95: samples[Math.floor(samples.length * 0.95)],
    max: samples[samples.length - 1],
  };
}

console.log('\ncitysim benchmark — full City.step()');
console.log(`node ${process.version} | budget ${TICK_BUDGET_MS}ms/tick at 10 ticks/sec\n`);

for (const key of wanted) {
  const tier = TIERS[key.trim()];
  if (!tier) continue;

  const t0 = performance.now();
  const { city, population, builtCells } = generateCity(tier.size, 1);
  const genMs = performance.now() - t0;

  // Cold: the first tick rebuilds every source and diffuses the entire grid.
  const coldStart = performance.now();
  city.step();
  const coldMs = performance.now() - coldStart;

  const ticks = tier.size >= 2048 ? 24 : 60;
  for (let i = 0; i < 4; i++) city.step(); // warm the JIT
  const growing = timeTicks(city, ticks);

  // Settled: freeze the city so nothing changes and only the fixed costs remain.
  city.firesEnabled = false;
  const demand = { r: -1, c: -1, i: -1 };
  Object.defineProperty(city, 'demand', { get: () => demand, set: () => {}, configurable: true });
  for (let i = 0; i < 20; i++) city.step();
  const settled = timeTicks(city, ticks);

  const g = city.grid;
  const memMB = city.fields.bytes / 1024 / 1024;
  const verdict = growing.p95 < TICK_BUDGET_MS ? 'PASS' : 'OVER BUDGET';

  console.log(`${tier.label}  —  ${g.toString()}`);
  console.log(`  population       ${population.toLocaleString()} across ${builtCells.toLocaleString()} built cells`);
  console.log(`  field memory     ${memMB.toFixed(1)} MB`);
  console.log(`  generate         ${genMs.toFixed(0)} ms`);
  console.log(`  cold tick        ${coldMs.toFixed(1)} ms   (full recompute, e.g. after a load)`);
  console.log(`  growing          median ${growing.median.toFixed(2)} ms   p95 ${growing.p95.toFixed(2)} ms   max ${growing.max.toFixed(2)} ms`);
  console.log(`  settled          median ${settled.median.toFixed(2)} ms   p95 ${settled.p95.toFixed(2)} ms`);
  console.log(`  budget           ${((growing.median / TICK_BUDGET_MS) * 100).toFixed(1)}% of ${TICK_BUDGET_MS}ms  ->  ${verdict}`);
  console.log(`  headroom         ${(TICK_BUDGET_MS / growing.median).toFixed(1)}x\n`);
}

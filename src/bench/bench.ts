/**
 * Performance benchmark across the scaling ladder in docs/TECH-STACK.md.
 *
 *   Tier 1 —  512^2, ~200k pop      ship gate: 60fps + 10 ticks/s
 *   Tier 2 — 1024^2, ~1M pop        must remain reachable
 *   Tier 3 — 2048^2, multi-million  may degrade, must never stall
 *
 * Budget: at 10 ticks/sec the simulation has 100ms per tick. It shares the frame with
 * rendering, so the real working target is well under that.
 *
 *   node src/bench/bench.ts               # tiers 1 and 2
 *   node src/bench/bench.ts --tiers=1,2,3
 */
import { generateCity } from './generate.ts';

const TIERS: Record<string, { size: number; label: string }> = {
  '1': { size: 512, label: 'Tier 1  (ship gate)' },
  '2': { size: 1024, label: 'Tier 2  (must stay reachable)' },
  '3': { size: 2048, label: 'Tier 3  (metropolis mode)' },
};

const TICK_BUDGET_MS = 100;

const arg = process.argv.find((a) => a.startsWith('--tiers='));
const wanted = (arg ? arg.slice('--tiers='.length) : '1,2').split(',');

function measure(size: number, forceAllPasses: boolean, ticks: number) {
  const t0 = performance.now();
  const { sim, population, builtCells } = generateCity(size, size, 1, forceAllPasses);
  const genMs = performance.now() - t0;

  for (let i = 0; i < 3; i++) sim.step(); // warm up the JIT

  const samples: number[] = [];
  for (let i = 0; i < ticks; i++) {
    const s = performance.now();
    sim.step();
    samples.push(performance.now() - s);
  }
  samples.sort((a, b) => a - b);
  return {
    sim,
    population,
    builtCells,
    genMs,
    median: samples[Math.floor(samples.length / 2)],
    p95: samples[Math.floor(samples.length * 0.95)],
    max: samples[samples.length - 1],
  };
}

console.log('\ncitysim simulation benchmark');
console.log(`node ${process.version} | budget ${TICK_BUDGET_MS}ms/tick at 10 ticks/sec\n`);

for (const key of wanted) {
  const tier = TIERS[key.trim()];
  if (!tier) continue;

  const ticks = tier.size >= 2048 ? 20 : 60;
  const staggered = measure(tier.size, false, ticks);
  const worst = measure(tier.size, true, ticks);

  const g = staggered.sim.grid;
  const memMB = staggered.sim.fields.bytes / 1024 / 1024;
  const pct = (staggered.median / TICK_BUDGET_MS) * 100;
  const verdict = staggered.p95 < TICK_BUDGET_MS ? 'PASS' : 'OVER BUDGET';

  console.log(`${tier.label}  —  ${g.toString()}`);
  console.log(`  population       ${staggered.population.toLocaleString()} across ${staggered.builtCells.toLocaleString()} built cells`);
  console.log(`  field memory     ${memMB.toFixed(1)} MB (${(staggered.sim.fields.byName.size)} planes + scratch)`);
  console.log(`  generate         ${staggered.genMs.toFixed(0)} ms`);
  console.log(`  tick (staggered) median ${staggered.median.toFixed(2)} ms   p95 ${staggered.p95.toFixed(2)} ms   max ${staggered.max.toFixed(2)} ms`);
  console.log(`  tick (all passes) median ${worst.median.toFixed(2)} ms   p95 ${worst.p95.toFixed(2)} ms`);
  console.log(`  budget           ${pct.toFixed(1)}% of ${TICK_BUDGET_MS}ms   ->  ${verdict}`);
  console.log(`  headroom         ${(TICK_BUDGET_MS / staggered.median).toFixed(1)}x\n`);
}

/// <reference lib="webworker" />
/**
 * The simulation runs here, off the render thread. It owns the field buffer and posts
 * a copy of the requested layer to the UI each frame — the renderer never drives the sim
 * (docs/SIMULATION-MODEL.md rule 5).
 */
import { generateCity } from '../bench/generate.ts';
import type { FieldName } from '../sim/fields.ts';
import type { Simulation } from '../sim/sim.ts';

let sim: Simulation | null = null;
let running = true;
let layer: FieldName = 'landValue';
let tickMs = 0;

type InMsg =
  | { type: 'init'; size: number }
  | { type: 'layer'; layer: FieldName }
  | { type: 'running'; running: boolean }
  | { type: 'inspect'; index: number };

self.onmessage = (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    const built = generateCity(msg.size, msg.size, 1);
    sim = built.sim;
    self.postMessage({
      type: 'ready',
      width: sim.grid.width,
      height: sim.grid.height,
      areaKm2: sim.grid.areaKm2(),
      population: built.population,
      builtCells: built.builtCells,
      memMB: sim.fields.bytes / 1024 / 1024,
    });
    loop();
  } else if (msg.type === 'layer') {
    layer = msg.layer;
  } else if (msg.type === 'running') {
    running = msg.running;
  } else if (msg.type === 'inspect' && sim) {
    const i = msg.index;
    const values: Record<string, number> = {};
    for (const [name, plane] of sim.fields.byName) values[name] = plane[i];
    self.postMessage({ type: 'inspect', index: i, values });
  }
};

function loop(): void {
  if (sim) {
    if (running) {
      const t0 = performance.now();
      sim.step();
      tickMs = tickMs * 0.9 + (performance.now() - t0) * 0.1;
    }
    const plane = sim.fields.get(layer);
    // Copy out — the sim keeps ownership of its buffer.
    const copy = new Float32Array(plane);
    self.postMessage({ type: 'frame', tick: sim.tick, tickMs, layer, data: copy }, [copy.buffer]);
  }
  setTimeout(loop, 100); // 10 sim ticks/sec, the budget in docs/TECH-STACK.md
}

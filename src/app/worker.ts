/// <reference lib="webworker" />
/**
 * The simulation lives here, off the render thread. It owns the City and posts a
 * snapshot of the arrays the renderer needs; the UI never mutates simulation state
 * directly, it sends actions (docs/SIMULATION-MODEL.md rule 5).
 */
import { City } from '../sim/city.ts';
import { serialize, deserialize } from '../sim/save.ts';
import type { FieldName } from '../sim/fields.ts';
import type { ToWorker, Snapshot } from './protocol.ts';

let city: City | null = null;
let stepsPerSecond = 4;
let layerName: string | null = null;
let simMs = 0;
let accumulator = 0;
let lastSeriesMonth = -1;
let last = performance.now();

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'init':
      city = new City(msg.size, msg.seed);
      self.postMessage({ type: 'ready', width: city.grid.width, height: city.grid.height });
      last = performance.now();
      loop();
      break;
    case 'speed':
      stepsPerSecond = msg.stepsPerSecond;
      break;
    case 'layer':
      layerName = msg.layer;
      break;
    case 'tax':
      if (city) city.tax = msg.tax;
      break;
    case 'options':
      if (city) city.firesEnabled = msg.firesEnabled;
      break;
    case 'inspect':
      if (city) self.postMessage({ type: 'inspect', cell: city.inspect(msg.index) });
      break;
    case 'act':
      if (city) {
        city.beginStroke(msg.strokeId, msg.label);
        apply(city, msg.action);
      }
      break;
    case 'endstroke':
      if (city) city.endStroke();
      break;
    case 'undo': {
      const label = city?.undo();
      if (city && label) city.pushMessage(`Undid: ${label}.`);
      break;
    }
    case 'redo': {
      const label = city?.redo();
      if (city && label) city.pushMessage(`Redid: ${label}.`);
      break;
    }
    case 'save': {
      if (!city) break;
      const bytes = serialize(city);
      self.postMessage({ type: 'saved', slot: msg.slot, bytes }, [bytes.buffer]);
      break;
    }
    case 'load':
      try {
        const loaded = deserialize(msg.bytes);
        city = loaded.city;
        self.postMessage({ type: 'ready', width: city.grid.width, height: city.grid.height });
        if (msg.slot !== 'auto') {
          city.pushMessage(`Loaded ${city.stats.population.toLocaleString()} residents, ${monthName(city.month)} ${city.year}.`);
        }
      } catch (err) {
        self.postMessage({ type: 'notice', text: `Could not load: ${(err as Error).message}`, error: true });
      }
      break;
    case 'new':
      city = new City(msg.size, msg.seed);
      self.postMessage({ type: 'ready', width: city.grid.width, height: city.grid.height });
      break;
  }
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
function monthName(m: number): string { return MONTHS[m] ?? ''; }

function apply(c: City, a: import('./protocol.ts').Action): void {
  switch (a.kind) {
    case 'road': for (const i of a.cells) c.buildRoad(i); break;
    case 'removeroad': for (const i of a.cells) c.removeRoad(i); break;
    case 'zone': for (const i of a.cells) c.paintZone(i, a.zone, a.density); break;
    case 'bulldoze': for (const i of a.cells) c.bulldoze(i); break;
    case 'civic': {
      const r = c.placeCivic(a.cell, a.civicId);
      if (!r.ok && r.error) c.pushMessage(`Can't build there — ${r.error}.`);
      break;
    }
  }
}

function loop(): void {
  const c = city;
  if (!c) return;

  const now = performance.now();
  const dt = Math.min(0.25, (now - last) / 1000); // clamp so a stall can't cause a burst
  last = now;

  if (stepsPerSecond > 0) {
    accumulator += dt * stepsPerSecond;
    let budget = 6; // never spend the whole frame catching up
    while (accumulator >= 1 && budget-- > 0) {
      const t0 = performance.now();
      c.step();
      simMs = simMs * 0.85 + (performance.now() - t0) * 0.15;
      accumulator -= 1;
    }
    if (accumulator > 3) accumulator = 3;
  }

  const t = c.tiles;
  const layer = layerName ? new Float32Array(c.fields.get(layerName as FieldName)) : null;
  const snap: Snapshot = {
    type: 'frame',
    tick: c.tick, month: c.month, year: c.year, funds: c.funds,
    demand: c.demand, stats: c.stats, power: c.power, ledger: c.ledger, tax: c.tax,
    messages: c.activeMessages(3),
    simMs,
    firesEnabled: c.firesEnabled,
    firesTotal: c.firesTotal,
    tilesLostToFire: c.tilesLostToFire,
    canUndo: c.history.canUndo,
    canRedo: c.history.canRedo,
    undoLabel: c.history.undoLabel,
    redoLabel: c.history.redoLabel,
    // Six 600-point arrays every frame would be ~500KB/s of pure waste; the data only
    // changes once a game month.
    series: c.month !== lastSeriesMonth ? c.series : null,
    zone: new Uint8Array(t.zone),
    density: new Uint8Array(t.density),
    road: new Uint8Array(t.road),
    level: new Uint8Array(t.level),
    civic: new Uint8Array(t.civic),
    powered: new Uint8Array(t.powered),
    layer, layerName,
  };
  lastSeriesMonth = c.month;
  const transfer: Transferable[] = [
    snap.zone.buffer, snap.density.buffer, snap.road.buffer,
    snap.level.buffer, snap.civic.buffer, snap.powered.buffer,
  ];
  if (layer) transfer.push(layer.buffer);
  self.postMessage(snap, transfer);

  setTimeout(loop, 33); // ~30 snapshots/sec
}

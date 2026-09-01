import './style.css';
import { Camera } from './camera.ts';
import { CityRenderer, type Overlay } from './render.ts';
import { LAYERS, RAMPS, buildLut } from './palette.ts';
import { TOOLS, DENSITY_LABELS, lineCells, brushCells, anchorFor, type Tool } from './tools.ts';
import { REASON, REASON_TEXT, requiredDesirability } from '../sim/growth.ts';
import { LAND_VALUE_BASE, LAND_VALUE_TERMS } from '../sim/sim.ts';
import { ZONE_LABEL, CIVIC_BY_ID, MAX_LEVEL } from '../sim/tiles.ts';
import type { FromWorker, Snapshot, ToWorker, Action } from './protocol.ts';

const MAP_SIZE = 256;
const SPEEDS = [
  { label: '❚❚', value: 0 },
  { label: '▶', value: 4 },
  { label: '▶▶', value: 12 },
  { label: '▶▶▶', value: 30 },
];

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('view');
const ctx = canvas.getContext('2d')!;
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

let camera = new Camera(MAP_SIZE, MAP_SIZE);
let renderer = new CityRenderer(MAP_SIZE);
let snap: Snapshot | null = null;
let tool: Tool = TOOLS[0];
let density = 0;
let brush = 3;
let layerIndex = -1;
let overlay: Overlay | null = null;
let hover: { x: number; y: number } | null = null;
let selected: number | null = null;
let speed = 1;

const post = (m: ToWorker, transfer?: Transferable[]) =>
  worker.postMessage(m, transfer ?? []);
const act = (a: Action) => post({ type: 'act', action: a });

// ---------------------------------------------------------------- tool rail
function buildTools(): void {
  const rail = $('tools');
  rail.innerHTML = '';
  let group = '';
  let container: HTMLElement | null = null;
  for (const t of TOOLS) {
    if (t.group !== group) {
      group = t.group;
      container = document.createElement('div');
      container.className = 'toolgroup';
      container.innerHTML = `<h3>${group}</h3>`;
      rail.appendChild(container);
    }
    const b = document.createElement('button');
    b.className = 'tool';
    b.dataset.id = t.id;
    b.setAttribute('aria-pressed', String(t === tool));
    b.innerHTML =
      `${t.colour ? `<i class="swatch" style="background:${t.colour}"></i>` : '<i class="swatch"></i>'}` +
      `<span>${t.label}</span>` +
      `<span class="cost">${t.cost ? `$${t.cost}` : ''} <kbd>${t.key}</kbd></span>`;
    b.onclick = () => selectTool(t);
    container!.appendChild(b);

    if (t.kind === 'zone') {
      const row = document.createElement('div');
      row.className = 'densities';
      row.dataset.for = t.id;
      DENSITY_LABELS.forEach((label, d) => {
        const db = document.createElement('button');
        db.textContent = label;
        db.setAttribute('aria-pressed', String(d === density));
        db.onclick = (e) => { e.stopPropagation(); density = d; selectTool(t); };
        row.appendChild(db);
      });
      row.style.display = t === tool ? 'flex' : 'none';
      container!.appendChild(row);
    }
  }
}

function selectTool(t: Tool): void {
  tool = t;
  for (const b of document.querySelectorAll<HTMLElement>('.tool')) {
    b.setAttribute('aria-pressed', String(b.dataset.id === t.id));
  }
  for (const row of document.querySelectorAll<HTMLElement>('.densities')) {
    row.style.display = row.dataset.for === t.id ? 'flex' : 'none';
    row.querySelectorAll('button').forEach((db, d) =>
      db.setAttribute('aria-pressed', String(d === density)));
  }
  const civicDef = t.civicId ? CIVIC_BY_ID.get(t.civicId) : null;
  brush = t.kind === 'zone' || t.kind === 'bulldoze' ? 3 : civicDef ? civicDef.size : 1;
  if (t.kind === 'removeroad') brush = 1;
}

// ---------------------------------------------------------------- chrome
function buildSpeeds(): void {
  const el = $('speeds');
  el.innerHTML = '';
  SPEEDS.forEach((s, i) => {
    const b = document.createElement('button');
    b.textContent = s.label;
    b.setAttribute('aria-pressed', String(i === speed));
    b.onclick = () => setSpeed(i);
    el.appendChild(b);
  });
}

function setSpeed(i: number): void {
  speed = i;
  post({ type: 'speed', stepsPerSecond: SPEEDS[i].value });
  $('speeds').querySelectorAll('button').forEach((b, n) =>
    b.setAttribute('aria-pressed', String(n === speed)));
}

function buildLayers(): void {
  const el = $('layers');
  el.innerHTML = '';
  const none = document.createElement('button');
  none.textContent = 'None';
  none.setAttribute('aria-pressed', 'true');
  none.onclick = () => setLayer(-1);
  el.appendChild(none);
  LAYERS.forEach((l, i) => {
    const b = document.createElement('button');
    b.textContent = l.label.replace(/^Desirability — /, 'Des. ');
    b.onclick = () => setLayer(i);
    el.appendChild(b);
  });
}

function setLayer(i: number): void {
  layerIndex = i;
  const buttons = $('layers').querySelectorAll('button');
  buttons.forEach((b, n) => b.setAttribute('aria-pressed', String(n === i + 1)));
  if (i < 0) {
    overlay = null;
    post({ type: 'layer', layer: null });
  } else {
    const l = LAYERS[i];
    overlay = { lut: buildLut(RAMPS[l.ramp]), max: l.max, alpha: 0.68 };
    post({ type: 'layer', layer: l.field });
  }
}

function buildTaxes(): void {
  const el = $('taxes');
  el.innerHTML = '';
  for (const [key, label] of [['r', 'Residential'], ['c', 'Commercial'], ['i', 'Industrial']] as const) {
    const wrap = document.createElement('label');
    wrap.innerHTML =
      `<span>${label}</span><input type="range" min="0" max="20" step="1" data-tax="${key}"><span data-out="${key}">9%</span>`;
    el.appendChild(wrap);
  }
  el.querySelectorAll<HTMLInputElement>('input').forEach((input) => {
    input.value = '9';
    input.oninput = () => {
      const tax = { r: 9, c: 9, i: 9 };
      el.querySelectorAll<HTMLInputElement>('input').forEach((x) => {
        const k = x.dataset.tax as 'r' | 'c' | 'i';
        tax[k] = Number(x.value);
        (el.querySelector(`[data-out="${k}"]`) as HTMLElement).textContent = `${x.value}%`;
      });
      post({ type: 'tax', tax });
    };
  });
}

// ---------------------------------------------------------------- input
let dragging = false;
let panning = false;
let spaceDown = false;
let lastCell: { x: number; y: number } | null = null;
let lastPan = { x: 0, y: 0 };

function viewSize(): [number, number] { return [canvas.width, canvas.height]; }

/**
 * Pointer position in CANVAS pixels.
 *
 * offsetX/offsetY are relative to whatever the event was dispatched on, which during a
 * captured drag is not necessarily the canvas, and they ignore any difference between
 * the element's CSS size and its backing-store size. Deriving from the bounding rect
 * scales correctly at any devicePixelRatio.
 */
function pointerPos(e: PointerEvent | WheelEvent): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * (canvas.width / r.width),
    y: (e.clientY - r.top) * (canvas.height / r.height),
  };
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', (e) => {
  // Capture can throw for synthetic or already-released pointers; it's an
  // optimisation for drag-outside-the-canvas, never a requirement.
  try { canvas.setPointerCapture(e.pointerId); } catch { /* not fatal */ }
  const [vw, vh] = viewSize();
  if (e.button === 2 || e.button === 1 || spaceDown) {
    panning = true;
    canvas.classList.add('panning');
    lastPan = pointerPos(e);
    return;
  }
  const q = pointerPos(e);
  const cell = camera.cellIndexAt(q.x, q.y, vw, vh);
  if (!cell) return;
  dragging = true;
  lastCell = cell;
  applyAt(cell);
});

canvas.addEventListener('pointermove', (e) => {
  const [vw, vh] = viewSize();
  if (panning) {
    const q = pointerPos(e);
    camera.panByPixels(q.x - lastPan.x, q.y - lastPan.y, vw, vh);
    lastPan = q;
    return;
  }
  const cell = camera.cellIndexAt(pointerPos(e).x, pointerPos(e).y, vw, vh);
  hover = cell;
  if (!dragging || !cell || !lastCell) return;
  if (cell.x === lastCell.x && cell.y === lastCell.y) return;
  if (tool.kind === 'road') {
    act({ kind: 'road', cells: lineCells(lastCell.x, lastCell.y, cell.x, cell.y, MAP_SIZE) });
  } else if (tool.kind === 'removeroad') {
    act({ kind: 'removeroad', cells: lineCells(lastCell.x, lastCell.y, cell.x, cell.y, MAP_SIZE) });
  } else {
    applyAt(cell);
  }
  lastCell = cell;
});

const endDrag = () => { dragging = false; panning = false; lastCell = null; canvas.classList.remove('panning'); };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('pointerleave', () => { hover = null; });

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const [vw, vh] = viewSize();
  const q = pointerPos(e);
  camera.zoomAt(e.deltaY < 0 ? 1 : -1, q.x, q.y, vw, vh);
}, { passive: false });

function applyAt(cell: { x: number; y: number }): void {
  const i = cell.y * MAP_SIZE + cell.x;
  switch (tool.kind) {
    case 'inspect':
      selected = i;
      post({ type: 'inspect', index: i });
      break;
    case 'road':
      act({ kind: 'road', cells: [i] });
      break;
    case 'removeroad':
      act({ kind: 'removeroad', cells: brushCells(cell.x, cell.y, brush, MAP_SIZE, MAP_SIZE) });
      break;
    case 'zone':
      act({ kind: 'zone', cells: brushCells(cell.x, cell.y, brush, MAP_SIZE, MAP_SIZE), zone: tool.zone!, density });
      break;
    case 'bulldoze':
      act({ kind: 'bulldoze', cells: brushCells(cell.x, cell.y, brush, MAP_SIZE, MAP_SIZE) });
      break;
    case 'civic': {
      // The preview rect is drawn CENTRED on the cursor, but placeCivic anchors at the
      // footprint's top-left. Without converting here, a 3x3 school and 4x4 plant landed
      // a tile down-right of the highlight while 2x2 buildings looked correct — which is
      // why the misalignment only showed up on some tools.
      const a = anchorFor(cell.x, cell.y, brush);
      act({ kind: 'civic', cell: a.y * MAP_SIZE + a.x, civicId: tool.civicId! });
      break;
    }
  }
}

window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
  if (e.code === 'Space') { spaceDown = true; e.preventDefault(); return; }
  const t = TOOLS.find((x) => x.key === e.key);
  if (t) { selectTool(t); return; }
  if (e.key === '[') setSpeed(Math.max(0, speed - 1));
  if (e.key === ']') setSpeed(Math.min(SPEEDS.length - 1, speed + 1));
  if (e.key === 'p' || e.key === 'P') setSpeed(speed === 0 ? 1 : 0);
  const [vw, vh] = viewSize();
  if (e.key === '=' || e.key === '+') camera.zoomAt(1, vw / 2, vh / 2, vw, vh);
  if (e.key === '-' || e.key === '_') camera.zoomAt(-1, vw / 2, vh / 2, vw, vh);
});
window.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceDown = false; });

// ---------------------------------------------------------------- HUD
const money = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString()}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function updateHud(s: Snapshot): void {
  $('date').textContent = `${MONTHS[s.month]} ${s.year}`;
  const funds = $('funds');
  funds.textContent = money(s.funds);
  funds.classList.toggle('neg', s.funds < 0);
  $('pop').textContent = s.stats.population.toLocaleString();
  $('jobs').textContent = (s.stats.jobsC + s.stats.jobsI).toLocaleString();
  const p = $('power');
  p.textContent = `${Math.round(s.power.demand)} / ${s.power.supply} MW`;
  p.classList.toggle('neg', s.power.brownout);

  setBar('rci-r', s.demand.r, 'var(--res)');
  setBar('rci-c', s.demand.c, 'var(--com)');
  setBar('rci-i', s.demand.i, 'var(--ind)');

  const l = s.ledger;
  $('budget').innerHTML = [
    ['Residential tax', money(l.taxR)],
    ['Commercial tax', money(l.taxC)],
    ['Industrial tax', money(l.taxI)],
    ['Services', money(-l.upkeepCivic)],
    ['Roads', money(-l.upkeepRoads)],
    ['Net / month', money(l.net)],
  ].map(([k, v], n) =>
    `<dt>${k}</dt><dd class="${n >= 3 || (n === 5 && l.net < 0) ? (n === 5 && l.net >= 0 ? '' : 'neg') : ''}">${v}</dd>`,
  ).join('');

  const ticker = $('ticker');
  ticker.innerHTML = s.messages.slice(0, 3).map((m) => `<div>${m}</div>`).join('');
}

function setBar(id: string, value: number, colour: string): void {
  const el = $(id);
  const v = Math.max(-1, Math.min(1, value));
  const h = Math.abs(v) * 13;
  el.style.background = colour;
  el.style.height = `${h}px`;
  el.style.bottom = v >= 0 ? '50%' : `${50 - (h / 26) * 100}%`;
  el.style.opacity = Math.abs(v) < 0.02 ? '0.25' : '1';
}

type InspectedCell = Extract<FromWorker, { type: 'inspect' }>['cell'];

function renderWhy(cell: InspectedCell): void {
  const v = cell.values;
  const sections: string[][] = [];
  let parts: string[] = [];
  const endSection = () => { if (parts.length) { sections.push(parts); parts = []; } };
  const zoneName = cell.civic
    ? CIVIC_BY_ID.get(cell.civic)?.label ?? 'civic building'
    : cell.road ? 'road' : ZONE_LABEL[cell.zone];

  parts.push(`<b>Tile ${cell.x}, ${cell.y}</b> — ${zoneName}`);

  if (cell.zone && !cell.civic && !cell.road) {
    const cap = MAX_LEVEL[cell.density];
    parts.push(`Level ${cell.level} of ${cap} · ${DENSITY_LABELS[cell.density].toLowerCase()} density`);
    const reason = cell.reason;
    let verdict = REASON_TEXT[reason] ?? '';
    if (reason === REASON.NO_ROAD) {
      verdict = cell.roadDist >= 255
        ? `No road anywhere near. Needs one within ${cell.roadReach} tiles.`
        : `Nearest road is ${cell.roadDist} tiles away. Needs ${cell.roadReach} or closer.`;
    } else if (reason === REASON.NO_POWER) {
      verdict = 'Not connected to the power grid.';
    } else if (reason === REASON.LOW_DESIRABILITY) {
      const des = cell.zone === 1 ? v.desirabilityR : cell.zone === 2 ? v.desirabilityC : v.desirabilityI;
      verdict = `Desirability ${des.toFixed(0)}, needs ${requiredDesirability(cell.level)} to reach level ${cell.level + 1}.`;
    } else if (reason === REASON.NO_DEMAND) {
      verdict = 'No demand for this zone right now.';
    } else if (reason === REASON.AT_CAPACITY) {
      verdict = 'Built out. Re-zone to a higher density to grow further.';
    } else if (reason === REASON.ABANDONING) {
      verdict = `In decline (${cell.distress}/40 to losing a level).`;
    } else if (reason === REASON.GROWING) {
      verdict = 'Developing.';
    }
    parts.push(`<span class="verdict">${verdict}</span>`);
  }
  endSection();

  // Land value, attributed. Terms come from the simulation itself (LAND_VALUE_TERMS),
  // so this breakdown cannot drift from the formula that produced the number.
  const terms = LAND_VALUE_TERMS
    .map((t) => ({ label: t.label, n: (v[t.field] ?? 0) * t.weight }))
    .filter((t) => Math.abs(t.n) >= 0.5)
    .sort((a, b) => Math.abs(b.n) - Math.abs(a.n));

  parts.push(`Land value <b>${v.landValue.toFixed(1)}</b>  (base ${LAND_VALUE_BASE})`);
  parts.push(terms.length
    ? terms.map((t) =>
        `   <span class="${t.n >= 0 ? 'good' : 'bad'}">${t.n >= 0 ? '+' : '−'}${Math.abs(t.n).toFixed(1)}</span>  ${t.label}`,
      ).join('\n')
    : '   nothing nearby yet');
  endSection();

  parts.push(
    `Pollution ${v.pollution.toFixed(0)} · Crime ${v.crime.toFixed(0)}` +
    `\nJob access ${v.jobAccess.toFixed(0)} · Amenity ${v.amenityAccess.toFixed(0)}` +
    `\nPolice ${v.policeCover.toFixed(0)} · School ${v.schoolCover.toFixed(0)}`,
  );

  endSection();
  // Sections are joined with exactly one blank line between them. Composing this from
  // ad-hoc '\n' prefixes on individual lines left ragged double and triple gaps.
  $('why').innerHTML = sections.map((s) => s.join('\n')).join('\n\n');
}

// ---------------------------------------------------------------- loop
function dpr(): number { return window.devicePixelRatio || 1; }

function fit(): void {
  const r = canvas.getBoundingClientRect();
  const d = dpr();
  canvas.width = Math.max(1, Math.round(r.width * d));
  canvas.height = Math.max(1, Math.round(r.height * d));
}
window.addEventListener('resize', fit);
// A window resize event doesn't fire when the surrounding layout changes without the
// window changing (panel toggles, an embedding pane resizing), and the canvas silently
// keeps a stale size. Observe the element itself.
new ResizeObserver(fit).observe(canvas);

worker.onmessage = (e: MessageEvent<FromWorker>) => {
  const msg = e.data;
  if (msg.type === 'ready') {
    camera = new Camera(msg.width, msg.height);
    renderer = new CityRenderer(msg.width);
    fit();
  } else if (msg.type === 'frame') {
    snap = msg;
    updateHud(msg);
    if (selected !== null && msg.tick % 8 === 0) post({ type: 'inspect', index: selected });
  } else if (msg.type === 'inspect') {
    renderWhy(msg.cell);
  }
};

// Dev-only inspection hook, so the running game can be interrogated from the console
// (and by automated checks) without reaching into module scope.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__citysim = {
    get snap() { return snap; },
    get overlay() { return overlay; },
    get camera() { return camera; },
    get tool() { return tool; },
  };
}

function frame(): void {
  const [vw, vh] = viewSize();
  // A collapsed viewport (hidden tab, minimised window, an embedding pane with no size)
  // is a normal state, not an error. Render nothing rather than throwing every frame.
  if (snap && vw > 4 && vh > 4) {
    renderer.draw(ctx, vw, vh, snap, camera, overlay, hover, brush);
  }
  requestAnimationFrame(frame);
}

buildTools();
buildSpeeds();
buildLayers();
buildTaxes();
fit();
post({ type: 'init', size: MAP_SIZE, seed: 1 });
setSpeed(1);
requestAnimationFrame(frame);

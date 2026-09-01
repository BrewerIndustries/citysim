import './style.css';
import { Camera } from './camera.ts';
import { CityRenderer, type Overlay } from './render.ts';
import { View3D } from './view3d.ts';
import { LAYERS, RAMPS, buildLut } from './palette.ts';
import {
  TOOLS, DENSITY_LABELS, DRAW_MODES, lineCells, brushCells, rectCells, anchorFor, modesFor,
  type Tool, type DrawMode,
} from './tools.ts';
import { REASON, REASON_TEXT, requiredDesirability } from '../sim/growth.ts';
import { LAND_VALUE_BASE, LAND_VALUE_TERMS } from '../sim/sim.ts';
import { ZONE_LABEL, CIVIC_BY_ID, MAX_LEVEL } from '../sim/tiles.ts';
import { buildManual, type ManualSection } from './manual.ts';
import { writeSlot, readSlot, describeSlot, clearSlot } from './storage.ts';
import { Chart } from './chart.ts';
import { AUTOSAVE_MONTHS } from './autosave.ts';
import { FLAT_MAP } from '../sim/terrain.ts';
import { DISASTERS } from '../sim/disasters.ts';
import { ACHIEVEMENTS } from '../sim/achievements.ts';
import { SERIES, type SeriesData, type SeriesKey } from '../sim/history-series.ts';
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
const canvas3d = $<HTMLCanvasElement>('view3d');
const ctx = canvas.getContext('2d')!;

/**
 * Two presentation modes over ONE simulation, as planned in docs/CAMERA-AND-ART.md.
 * Plan Mode is the top-down schematic you build in; the ¾ view is for reading and
 * admiring the city. Neither is a separate game — both consume the same snapshot.
 */
type ViewMode = 'plan' | 'iso';
let viewMode: ViewMode = 'plan';
let view3d: View3D | null = null;
let terrain3d: { water: Uint8Array; shore: Uint8Array; height: Uint8Array; floodRisk: Uint8Array } | null = null;
let overlayDirtyAt = 0;
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

let camera = new Camera(MAP_SIZE, MAP_SIZE);
let renderer = new CityRenderer(MAP_SIZE);
let snap: Snapshot | null = null;
let tool: Tool = TOOLS[0];
let density = 0;
let brush = 3;
let drawMode: DrawMode = 'pencil';
/**
 * Each kind of tool remembers its own draw mode, starting from what suits it — lines
 * for roads, rectangles for zoning. Sharing one mode across every tool meant picking
 * the road tool silently changed how zoning would behave.
 */
const modeByKind = new Map<string, DrawMode>();
/** Cells a line/rectangle drag would affect, previewed until the button is released. */
let preview: number[] = [];
let layerIndex = -1;
let overlay: Overlay | null = null;
let hover: { x: number; y: number } | null = null;
/**
 * Overlays backed by terrain rather than by a simulation field. Terrain never changes
 * during play, so these are sent once with the map instead of every frame.
 */
let terrainLayers: Record<string, Uint8Array> = {};
let selected: number | null = null;
let speed = 1;

const post = (m: ToWorker, transfer?: Transferable[]) =>
  worker.postMessage(m, transfer ?? []);
// One pointer-down..pointer-up gesture is one undo step, so a dragged road is taken
// back in a single press rather than fifty.
let strokeId = 'stroke-0';
let strokeSeq = 0;
function newStroke(): void { strokeId = `stroke-${++strokeSeq}`; }
const act = (a: Action) => post({ type: 'act', action: a, strokeId, label: tool.label });

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
    if (t.civicId) b.dataset.civic = String(t.civicId);
    b.setAttribute('aria-pressed', String(t === tool));
    b.innerHTML =
      `${t.colour ? `<i class="swatch" style="background:${t.colour}"></i>` : '<i class="swatch"></i>'}` +
      `<span class="tool-label">${t.label}</span>` +
      `<span class="cost">${t.cost ? `$${t.cost.toLocaleString()}` : ''} <kbd>${t.key}</kbd></span>`;
    b.onclick = () => {
      if (b.classList.contains('locked')) {
        note(b.dataset.reason ?? 'Not available yet.');
        return;
      }
      selectTool(t);
    };
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

    const { modes } = modesFor(t.kind);
    if (modes.length) {
      const row = document.createElement('div');
      row.className = 'densities modes';
      row.dataset.modesFor = t.id;
      for (const m of DRAW_MODES) {
        if (!modes.includes(m.mode)) continue;
        const mb = document.createElement('button');
        mb.textContent = m.label;
        mb.title = m.hint;
        mb.dataset.mode = m.mode;
        mb.onclick = (e) => { e.stopPropagation(); modeByKind.set(t.kind, m.mode); selectTool(t); };
        row.appendChild(mb);
      }
      row.style.display = t === tool ? 'flex' : 'none';
      container!.appendChild(row);
    }
  }
}

/** Reflect what the city has unlocked onto the rail. */
function applyLocks(s: Snapshot): void {
  const unlocked = new Set(s.unlocked);
  for (const b of document.querySelectorAll<HTMLElement>('.tool[data-civic]')) {
    const id = Number(b.dataset.civic);
    const reason = s.lockReasons[id];
    const locked = reason !== undefined && !unlocked.has(id);
    b.classList.toggle('locked', locked);
    if (locked) {
      b.dataset.reason = reason;
      b.title = reason;
    } else {
      delete b.dataset.reason;
      b.title = '';
    }
  }
  // If the selected tool just became unavailable (a fresh city, a load), fall back.
  if (tool.civicId && !unlocked.has(tool.civicId)) selectTool(TOOLS[0]);
}

function showNetworkLayer(field: string): void {
  const idx = LAYERS.findIndex((l) => l.field === field);
  if (idx >= 0 && layerIndex !== idx) setLayer(idx);
}

function selectTool(t: Tool): void {
  tool = t;
  for (const b of document.querySelectorAll<HTMLElement>('.tool')) {
    b.setAttribute('aria-pressed', String(b.dataset.id === t.id));
  }
  for (const row of document.querySelectorAll<HTMLElement>('.densities:not(.modes)')) {
    row.style.display = row.dataset.for === t.id ? 'flex' : 'none';
    row.querySelectorAll('button').forEach((db, d) =>
      db.setAttribute('aria-pressed', String(d === density)));
  }

  const { modes, preferred } = modesFor(t.kind);
  drawMode = modes.length ? (modeByKind.get(t.kind) ?? preferred) : 'pencil';
  for (const row of document.querySelectorAll<HTMLElement>('.densities.modes')) {
    row.style.display = row.dataset.modesFor === t.id ? 'flex' : 'none';
    row.querySelectorAll('button').forEach((mb) =>
      mb.setAttribute('aria-pressed', String(mb.dataset.mode === drawMode)));
  }
  // Picking a utility tool switches to that network's view: you cannot lay a line
  // sensibly without seeing what is already connected.
  if (t.kind === 'powerline') showNetworkLayer('powerNetwork');
  else if (t.kind === 'pipe') showNetworkLayer('waterNetwork');
  else if (t.kind === 'sewer') showNetworkLayer('sewerNetwork');

  const civicDef = t.civicId ? CIVIC_BY_ID.get(t.civicId) : null;
  brush = t.kind === 'zone' || t.kind === 'bulldoze' ? 3 : civicDef ? civicDef.size : 1;
  if (t.kind === 'powerline' || t.kind === 'pipe' || t.kind === 'sewer') brush = 1;
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
    renderer.setStaticLayer(null);
    renderer.setNetwork(null);
  } else {
    const l = LAYERS[i];
    overlay = { lut: buildLut(RAMPS[l.ramp]), max: l.max, alpha: 0.68 };
    const terrainLayer = terrainLayers[l.field];
    renderer.setStaticLayer(terrainLayer ?? null);
    renderer.setNetwork(l.network ?? null);
    post({ type: 'layer', layer: terrainLayer || l.network ? null : l.field });
  }
}

// ---------------------------------------------------------------- achievements
let earned = new Set<string>();

function buildAchievementsUi(): void {
  $('ach-open').onclick = () => openAchievements();
  $('ach-close').onclick = () => closeAchievements();
  $('achievements').querySelector('[data-close-ach]')!.addEventListener('click', closeAchievements);
  renderAchievements();
}

function renderAchievements(): void {
  const body = $('ach-body');
  const groups = [...new Set(ACHIEVEMENTS.map((a) => a.group))];
  const pct = Math.round((earned.size / ACHIEVEMENTS.length) * 100);
  $('ach-count').textContent = `${earned.size} of ${ACHIEVEMENTS.length}`;
  body.innerHTML =
    `<div class="ach-progress"><span style="width:${pct}%"></span></div>` +
    groups.map((g) =>
      `<div class="ach-group">${g}</div>` +
      ACHIEVEMENTS.filter((a) => a.group === g).map((a) => {
        const got = earned.has(a.id);
        // Locked achievements still show their description: one you can't see isn't
        // something you can aim at.
        return `<div class="ach ${got ? 'got' : ''}"><div class="mark">${got ? '★' : '☆'}</div>` +
          `<div><div class="name">${a.name}</div><div class="desc">${a.description}</div></div></div>`;
      }).join(''),
    ).join('');
}

function openAchievements(): void { renderAchievements(); $('achievements').hidden = false; }
function closeAchievements(): void { $('achievements').hidden = true; }
function achievementsOpen(): boolean { return !$('achievements').hidden; }

// ---------------------------------------------------------------- history graph
let chart: Chart | null = null;
let series: SeriesData | null = null;

function buildChart(): void {
  chart = new Chart($<HTMLCanvasElement>('chart'));
  const el = $('series');
  el.innerHTML = '';
  for (const s of SERIES) {
    const b = document.createElement('button');
    b.innerHTML = `<i style="background:${s.colour}"></i>${s.label}`;
    b.setAttribute('aria-pressed', String(chart!.visible.has(s.key)));
    b.onclick = () => {
      chart!.toggle(s.key);
      b.setAttribute('aria-pressed', String(chart!.visible.has(s.key)));
      chart!.draw(series);
    };
    el.appendChild(b);
  }
  new ResizeObserver(() => chart?.draw(series)).observe($('chart'));
}

function updateSeriesReadout(s: Snapshot): void {
  if (!series) return;
  const latest = (key: SeriesKey) => {
    const arr = series![key];
    return arr.length ? arr[arr.length - 1] : 0;
  };
  const fmt = (key: SeriesKey, v: number) =>
    key === 'funds' || key === 'net' ? money(v) : Math.round(v).toLocaleString();
  $('series-now').innerHTML = SERIES
    .filter((x) => chart?.visible.has(x.key))
    .map((x) => `<dt>${x.label}</dt><dd>${fmt(x.key, latest(x.key))}</dd>`)
    .join('');
  void s;
}

// ---------------------------------------------------------------- saving
let lastAutosaveMonth = -1;
let pendingSlot: string | null = null;

function buildSaveUi(): void {
  $('btn-undo').onclick = () => post({ type: 'undo' });
  $('btn-redo').onclick = () => post({ type: 'redo' });
  $('btn-save').onclick = () => requestSave('manual');
  $('btn-load').onclick = () => loadSlot('manual');
  $('btn-new').onclick = () => {
    if (!confirm('Start a new city? Anything unsaved is lost.')) return;
    clearSlot('auto');
    lastAutosaveMonth = -1;
    // A fresh map each time, so New actually means a new place.
    const flat = $<HTMLInputElement>('opt-flat').checked;
    const mapSeed = flat ? FLAT_MAP : ((Math.random() * 0x7ffffffe) | 0) + 1;
    post({ type: 'new', size: MAP_SIZE, seed: 1, mapSeed });
    note(flat ? 'Started a new city on a flat map.' : 'Started a new city on a new map.');
  };
  refreshSaveNote();
}

function requestSave(slot: string): void {
  pendingSlot = slot;
  post({ type: 'save', slot });
}

function loadSlot(slot: string): void {
  const bytes = readSlot(slot);
  if (!bytes) { note(`No ${slot} save found.`); return; }
  post({ type: 'load', slot, bytes });
}

function note(text: string): void {
  $('save-note').textContent = text;
}

function refreshSaveNote(): void {
  const manual = describeSlot('manual');
  const auto = describeSlot('auto');
  note(manual === 'empty' && auto === 'empty'
    ? 'No saves yet. Autosaves every ' + AUTOSAVE_MONTHS + ' months.'
    : `Saved: ${manual}\nAuto: ${auto}`);
}

function buildOptions(): void {
  const box = $('disaster-opts');
  box.innerHTML = '';
  for (const d of DISASTERS) {
    const label = document.createElement('label');
    label.className = 'toggle';
    label.title = d.description;
    label.innerHTML = `<input type="checkbox" data-disaster="${d.key}" checked><span>${d.label}</span>`;
    box.appendChild(label);
  }
  box.querySelectorAll<HTMLInputElement>('input').forEach((input) => {
    input.onchange = () => {
      const disasters: Record<string, boolean> = {};
      box.querySelectorAll<HTMLInputElement>('input').forEach((x) => {
        disasters[x.dataset.disaster!] = x.checked;
      });
      post({ type: 'options', disasters });
    };
  });
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

// ---------------------------------------------------------------- manual
const MANUAL: ManualSection[] = buildManual();
let manualSection = MANUAL[0].id;

function buildManualUi(): void {
  const nav = $('manual-nav');
  nav.innerHTML = '';
  for (const s of MANUAL) {
    const b = document.createElement('button');
    b.textContent = s.title;
    b.dataset.section = s.id;
    b.onclick = () => showManual(s.id);
    nav.appendChild(b);
  }
  $('manual-open').onclick = () => openManual();
  $('manual-close').onclick = () => closeManual();
  $('manual').querySelector('[data-close]')!.addEventListener('click', () => closeManual());
}

function showManual(id: string): void {
  manualSection = id;
  const s = MANUAL.find((x) => x.id === id) ?? MANUAL[0];
  const content = $('manual-content');
  content.innerHTML = `<h3>${s.title}</h3>${s.html}`;
  content.scrollTop = 0;
  $('manual-nav').querySelectorAll('button').forEach((b) =>
    b.setAttribute('aria-current', String(b.dataset.section === id)));
}

function openManual(section = manualSection): void {
  showManual(section);
  $('manual').hidden = false;
}

function closeManual(): void {
  $('manual').hidden = true;
}

function manualOpen(): boolean {
  return !$('manual').hidden;
}

// ---------------------------------------------------------------- input
let dragging = false;
let panning = false;
let spaceDown = false;
let lastCell: { x: number; y: number } | null = null;
let anchor: { x: number; y: number } | null = null;
let lastPan = { x: 0, y: 0 };

function viewSize(): [number, number] {
  const c = viewMode === 'plan' ? canvas : canvas3d;
  return [c.width, c.height];
}

/**
 * Pointer position in CANVAS pixels.
 *
 * offsetX/offsetY are relative to whatever the event was dispatched on, which during a
 * captured drag is not necessarily the canvas, and they ignore any difference between
 * the element's CSS size and its backing-store size. Deriving from the bounding rect
 * scales correctly at any devicePixelRatio.
 */
function pointerPos(e: PointerEvent | WheelEvent): { x: number; y: number } {
  const c = viewMode === 'plan' ? canvas : canvas3d;
  const r = c.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * (c.width / r.width),
    y: (e.clientY - r.top) * (c.height / r.height),
  };
}

for (const c of [canvas, canvas3d]) c.addEventListener('contextmenu', (e) => e.preventDefault());

/**
 * Pointer handling is registered on BOTH canvases; only one is visible at a time, so
 * whichever receives the event is the active view.
 */
function forEachCanvas(fn: (c: HTMLCanvasElement) => void): void {
  fn(canvas);
  fn(canvas3d);
}

/** Cell under a screen position, in whichever view is showing. */
function cellUnder(e: PointerEvent | WheelEvent): { x: number; y: number } | null {
  const [vw, vh] = viewSize();
  const q = pointerPos(e);
  if (viewMode === 'plan') return camera.cellIndexAt(q.x, q.y, vw, vh);
  return view3d?.cellAtScreen(q.x, q.y, vw, vh) ?? null;
}

forEachCanvas((el) => el.addEventListener('pointerdown', (e) => {
  // Capture can throw for synthetic or already-released pointers; it's an
  // optimisation for drag-outside-the-canvas, never a requirement.
  const surface = viewMode === 'plan' ? canvas : canvas3d;
  try { surface.setPointerCapture(e.pointerId); } catch { /* not fatal */ }
  const [vw, vh] = viewSize();
  if (e.button === 2 || e.button === 1 || spaceDown) {
    panning = true;
    canvas.classList.add('panning');
    canvas3d.classList.add('panning');
    lastPan = pointerPos(e);
    return;
  }
  const cell = cellUnder(e);
  if (!cell) return;
  newStroke();
  dragging = true;
  lastCell = cell;
  anchor = cell;
  if (drawMode === 'pencil' || tool.kind === 'inspect' || tool.kind === 'civic') applyAt(cell);
  else preview = previewFor(cell);
}));

forEachCanvas((el) => el.addEventListener('pointermove', (e) => {
  const [vw, vh] = viewSize();
  if (panning) {
    const q = pointerPos(e);
    if (viewMode === 'plan') camera.panByPixels(q.x - lastPan.x, q.y - lastPan.y, vw, vh);
    else view3d?.cam.panByPixels(q.x - lastPan.x, q.y - lastPan.y, vh);
    lastPan = q;
    return;
  }
  const cell = cellUnder(e);
  hover = cell;
  if (!dragging || !cell || !lastCell) return;
  if (cell.x === lastCell.x && cell.y === lastCell.y) return;

  if (drawMode !== 'pencil' && anchor) {
    // Nothing is built until the button comes up, so the shape can be adjusted freely.
    preview = previewFor(cell);
    lastCell = cell;
    return;
  }

  if (tool.kind === 'road') {
    act({ kind: 'road', cells: lineCells(lastCell.x, lastCell.y, cell.x, cell.y, MAP_SIZE) });
  } else if (tool.kind === 'powerline' || tool.kind === 'pipe' || tool.kind === 'sewer') {
    act({
      kind: 'utility',
      cells: lineCells(lastCell.x, lastCell.y, cell.x, cell.y, MAP_SIZE),
      utility: tool.kind === 'powerline' ? 'powerLine' : tool.kind === 'pipe' ? 'pipe' : 'sewer',
    });
  } else if (tool.kind === 'removeroad') {
    act({ kind: 'removeroad', cells: lineCells(lastCell.x, lastCell.y, cell.x, cell.y, MAP_SIZE) });
  } else {
    applyAt(cell);
  }
  lastCell = cell;
}));

const endDrag = () => {
  if (dragging && preview.length) commitPreview();
  preview = [];
  anchor = null;
  if (dragging) post({ type: 'endstroke' });
  dragging = false;
  panning = false;
  lastCell = null;
  canvas.classList.remove('panning');
  canvas3d.classList.remove('panning');
};
forEachCanvas((el) => {
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);
  el.addEventListener('pointerleave', () => { hover = null; });
});

forEachCanvas((el) => el.addEventListener('wheel', (e) => {
  e.preventDefault();
  const [vw, vh] = viewSize();
  if (viewMode === 'plan') {
    const q = pointerPos(e);
    camera.zoomAt(e.deltaY < 0 ? 1 : -1, q.x, q.y, vw, vh);
  } else {
    view3d?.cam.zoomBy(e.deltaY < 0 ? 1 : -1);
  }
}, { passive: false }));

/** The cells a line or rectangle drag would affect, from the anchor to `cell`. */
function previewFor(cell: { x: number; y: number }): number[] {
  if (!anchor) return [];
  if (drawMode === 'rectangle') {
    return rectCells(anchor.x, anchor.y, cell.x, cell.y, MAP_SIZE, MAP_SIZE);
  }
  return lineCells(anchor.x, anchor.y, cell.x, cell.y, MAP_SIZE);
}

/** Build whatever the preview is showing, as one undo step. */
function commitPreview(): void {
  const cells = preview;
  if (!cells.length) return;
  switch (tool.kind) {
    case 'road': act({ kind: 'road', cells }); break;
    case 'removeroad': act({ kind: 'removeroad', cells }); break;
    case 'bulldoze': act({ kind: 'bulldoze', cells }); break;
    case 'zone': act({ kind: 'zone', cells, zone: tool.zone!, density }); break;
    case 'powerline': act({ kind: 'utility', cells, utility: 'powerLine' }); break;
    case 'pipe': act({ kind: 'utility', cells, utility: 'pipe' }); break;
    case 'sewer': act({ kind: 'utility', cells, utility: 'sewer' }); break;
    default: break;
  }
}

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
    case 'powerline':
      act({ kind: 'utility', cells: [i], utility: 'powerLine' });
      break;
    case 'pipe':
      act({ kind: 'utility', cells: [i], utility: 'pipe' });
      break;
    case 'sewer':
      act({ kind: 'utility', cells: [i], utility: 'sewer' });
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
  if (e.key === 'Escape') {
    if (achievementsOpen()) { closeAchievements(); return; }
    if (manualOpen()) { closeManual(); return; }
  }
  if (e.key === 'a' || e.key === 'A') {
    achievementsOpen() ? closeAchievements() : openAchievements();
    return;
  }
  if (achievementsOpen()) return;
  if (e.key === '?' || e.key === 'h' || e.key === 'H') {
    manualOpen() ? closeManual() : openManual();
    return;
  }
  // While the manual is up it owns the keyboard — otherwise reading the Roads page
  // silently reassigns your tool.
  if (manualOpen()) return;
  if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault();
    post({ type: e.shiftKey ? 'redo' : 'undo' });
    return;
  }
  if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || e.key === 'Y')) {
    e.preventDefault();
    post({ type: 'redo' });
    return;
  }
  if (e.metaKey || e.ctrlKey) return; // leave browser shortcuts alone
  if (e.code === 'Tab') {
    e.preventDefault();
    setViewMode(viewMode === 'plan' ? 'iso' : 'plan');
    return;
  }
  if (viewMode === 'iso' && view3d) {
    // Rotation and tilt only mean something in the ¾ view.
    if (e.key === ',' || e.key === '<') { view3d.cam.rotate(-1); return; }
    if (e.key === '.' || e.key === '>') { view3d.cam.rotate(1); return; }
    if (e.key === 'PageUp') { view3d.cam.tiltBy(0.09); return; }
    if (e.key === 'PageDown') { view3d.cam.tiltBy(-0.09); return; }
  }
  if (e.code === 'Space') { spaceDown = true; e.preventDefault(); return; }
  const t = TOOLS.find((x) => x.key === e.key);
  if (t) { selectTool(t); return; }
  if (e.key === '[') setSpeed(Math.max(0, speed - 1));
  if (e.key === ']') setSpeed(Math.min(SPEEDS.length - 1, speed + 1));
  if (e.key === 'p' || e.key === 'P') setSpeed(speed === 0 ? 1 : 0);
  const [vw, vh] = viewSize();
  if (e.key === '=' || e.key === '+') {
    if (viewMode === 'plan') camera.zoomAt(1, vw / 2, vh / 2, vw, vh);
    else view3d?.cam.zoomBy(1);
  }
  if (e.key === '-' || e.key === '_') {
    if (viewMode === 'plan') camera.zoomAt(-1, vw / 2, vh / 2, vw, vh);
    else view3d?.cam.zoomBy(-1);
  }
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
  p.classList.toggle('neg', s.power.shortfall);
  const wtr = $('water');
  wtr.textContent = `${Math.round(s.water.demand)} / ${s.water.supply}`;
  wtr.classList.toggle('neg', s.water.shortfall);
  const sew = $('sewage');
  sew.textContent = `${Math.round(s.sewage.demand)} / ${s.sewage.supply}`;
  sew.classList.toggle('neg', s.sewage.shortfall);

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

  const undo = $<HTMLButtonElement>('btn-undo');
  const redo = $<HTMLButtonElement>('btn-redo');
  undo.disabled = !s.canUndo;
  redo.disabled = !s.canRedo;
  undo.title = s.canUndo ? `Undo ${s.undoLabel} (Cmd/Ctrl+Z)` : 'Nothing to undo';
  redo.title = s.canRedo ? `Redo ${s.redoLabel} (Cmd/Ctrl+Shift+Z)` : 'Nothing to redo';

  applyLocks(s);

  if (s.earned.length !== earned.size) {
    earned = new Set(s.earned);
    if (achievementsOpen()) renderAchievements();
  }

  const struck = DISASTERS
    .map((d) => ({ d, n: s.disasterCounts[d.key] ?? 0 }))
    .filter((x) => x.n > 0);
  $('disaster-note').textContent = struck.length === 0
    ? (DISASTERS.every((d) => !s.disasters[d.key]) ? 'Disasters are off.' : 'Nothing has gone wrong yet.')
    : `${struck.map((x) => `${x.n} ${x.d.label.toLowerCase()}`).join(', ')} — ` +
      `${s.tilesLostToDisaster.toLocaleString()} buildings lost.`;

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
      verdict = `No power. Needs a power line within ${cell.roadReach} tiles, carrying supply from a plant.`;
    } else if (reason === REASON.NO_WATER) {
      verdict = `No water. Needs a pipe within ${cell.roadReach} tiles, fed by a pump.`;
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
  const active = viewMode === 'plan' ? canvas : canvas3d;
  const r = active.getBoundingClientRect();
  const d = dpr();
  for (const c of [canvas, canvas3d]) {
    c.width = Math.max(1, Math.round(r.width * d));
    c.height = Math.max(1, Math.round(r.height * d));
  }
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
    renderer.setTerrain(msg.water, msg.shore, msg.terrainHeight);
    terrainLayers = { floodRisk: msg.floodRisk, waterTable: msg.waterTable };
    terrain3d = {
      water: msg.water, shore: msg.shore, height: msg.terrainHeight, floodRisk: msg.floodRisk,
    };
    if (view3d) { view3d.dispose(); view3d = null; }
    if (viewMode === 'iso') ensure3d();
    fit();
  } else if (msg.type === 'frame') {
    snap = msg;
    if (viewMode === 'iso') applyOverlay3d();
    if (msg.series) {
      series = msg.series;
      chart?.draw(series);
      updateSeriesReadout(msg);
    }
    updateHud(msg);
    // Autosave on a month boundary rather than a tick count, so the cadence is the same
    // whatever speed the player is running at.
    if (msg.month !== lastAutosaveMonth && msg.month % AUTOSAVE_MONTHS === 0 && msg.stats.developedCells > 0) {
      lastAutosaveMonth = msg.month;
      if (!pendingSlot) requestSave('auto');
    }
    if (selected !== null && msg.tick % 8 === 0) post({ type: 'inspect', index: selected });
  } else if (msg.type === 'inspect') {
    renderWhy(msg.cell);
  } else if (msg.type === 'saved') {
    const s = snap;
    const err = writeSlot(msg.slot, msg.bytes, {
      population: s?.stats.population ?? 0,
      month: s?.month ?? 0,
      year: s?.year ?? 0,
    });
    if (err) note(err);
    else if (msg.slot === 'manual') { note('Saved.'); setTimeout(refreshSaveNote, 1400); }
    else refreshSaveNote();
    pendingSlot = null;
  } else if (msg.type === 'notice') {
    note(msg.text);
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
    get renderer() { return renderer; },
    get terrain3d() { return terrain3d; },
    get viewMode() { return viewMode; },
  };
}

function ensure3d(): View3D | null {
  if (!terrain3d || !snap) return null;
  if (!view3d) {
    view3d = new View3D(canvas3d, camera.width, camera.height);
    view3d.setTerrain(terrain3d);
    view3d.cam.lookAtCell(camera.cx, camera.cy);
    applyOverlay3d(true);
  }
  return view3d;
}

/** Push the active data layer onto the ground plane of the ¾ view. */
function applyOverlay3d(force = false): void {
  if (!view3d || !snap) return;
  const now = performance.now();
  // Recolouring the whole ground is a per-vertex walk; a few times a second is plenty
  // for a field that moves over months.
  if (!force && now - overlayDirtyAt < 400) return;
  overlayDirtyAt = now;
  if (layerIndex < 0 || !overlay) { view3d.setGroundOverlay(null, null, 1); return; }
  const l = LAYERS[layerIndex];
  const data = terrainLayers[l.field] ?? snap.layer;
  view3d.setGroundOverlay(data ?? null, overlay.lut, overlay.max);
}

function setViewMode(mode: ViewMode): void {
  viewMode = mode;
  canvas.hidden = mode !== 'plan';
  canvas3d.hidden = mode !== 'iso';
  $('view-toggle').textContent = mode === 'plan' ? 'Plan' : '¾ view';
  if (mode === 'iso') {
    const v = ensure3d();
    v?.cam.lookAtCell(camera.cx, camera.cy);
    applyOverlay3d(true);
  } else if (view3d) {
    // Carry the position back so switching modes never loses your place.
    camera.cx = view3d.cam.target.x;
    camera.cy = view3d.cam.target.z;
  }
  fit();
}

function frame(): void {
  const [vw, vh] = viewSize();
  // A collapsed viewport (hidden tab, minimised window, an embedding pane with no size)
  // is a normal state, not an error. Render nothing rather than throwing every frame.
  if (snap && vw > 4 && vh > 4) {
    if (viewMode === 'plan') {
      renderer.draw(ctx, vw, vh, snap, camera, overlay, hover, brush, preview);
    } else {
      const v = ensure3d();
      if (v) {
        v.update(snap, vw / vh);
        v.setHover(hover);
        v.setPreview(preview);
        v.render(vw, vh);
      }
    }
  }
  requestAnimationFrame(frame);
}

buildTools();
$('view-toggle').onclick = () => setViewMode(viewMode === 'plan' ? 'iso' : 'plan');
buildManualUi();
buildAchievementsUi();
buildChart();
buildSpeeds();
buildLayers();
buildOptions();
buildSaveUi();
buildTaxes();
fit();
// Resume the autosave if there is one, so a refresh doesn't cost a city.
post({ type: 'init', size: MAP_SIZE, seed: 1 });
const resume = readSlot('auto');
if (resume) post({ type: 'load', slot: 'auto', bytes: resume });
setSpeed(1);
requestAnimationFrame(frame);

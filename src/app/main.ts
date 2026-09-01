import './style.css';
import { LAYERS, RAMPS, buildLut } from './palette.ts';
import type { FieldName } from '../sim/fields.ts';

const SIZE = 512; // Tier 1 (docs/TECH-STACK.md)

const canvas = document.getElementById('view') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const layersEl = document.getElementById('layers')!;
const statsEl = document.getElementById('stats')!;
const whyEl = document.getElementById('why')!;

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

let width = SIZE;
let height = SIZE;
let active = LAYERS[0];
let lut = buildLut(RAMPS[active.ramp]);
let image: ImageData | null = null;
// The field is blitted 1:1 into an offscreen canvas, then scaled onto the visible one.
// Drawing the visible canvas onto itself corrupts the image (the source region already
// contains the previous scaled draw).
const off = document.createElement('canvas');
const offCtx = off.getContext('2d')!;
let frameMs = 0;
let meta = { population: 0, builtCells: 0, areaKm2: 0, memMB: 0 };

// --- layer buttons -----------------------------------------------------------
const buttons = LAYERS.map((layer) => {
  const b = document.createElement('button');
  b.textContent = layer.label;
  b.setAttribute('aria-pressed', String(layer === active));
  b.onclick = () => {
    active = layer;
    lut = buildLut(RAMPS[layer.ramp]);
    worker.postMessage({ type: 'layer', layer: layer.field as FieldName });
    buttons.forEach((x, i) => x.setAttribute('aria-pressed', String(LAYERS[i] === active)));
  };
  layersEl.appendChild(b);
  return b;
});

// --- canvas ------------------------------------------------------------------
function fit(): void {
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(r.width));
  canvas.height = Math.max(1, Math.round(r.height));
}
addEventListener('resize', fit);

canvas.addEventListener('click', (e) => {
  const r = canvas.getBoundingClientRect();
  const scale = Math.min(canvas.width / width, canvas.height / height);
  const ox = (canvas.width - width * scale) / 2;
  const oy = (canvas.height - height * scale) / 2;
  const x = Math.floor(((e.clientX - r.left) * (canvas.width / r.width) - ox) / scale);
  const y = Math.floor(((e.clientY - r.top) * (canvas.height / r.height) - oy) / scale);
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  worker.postMessage({ type: 'inspect', index: y * width + x });
});

// --- worker messages ---------------------------------------------------------
worker.onmessage = (e: MessageEvent<any>) => {
  const msg = e.data;

  if (msg.type === 'ready') {
    width = msg.width;
    height = msg.height;
    meta = msg;
    image = new ImageData(width, height);
    off.width = width;
    off.height = height;
    fit();
    return;
  }

  if (msg.type === 'frame') {
    frameMs = msg.tickMs;
    paint(msg.data as Float32Array);
    renderStats(msg.tick);
    return;
  }

  if (msg.type === 'inspect') {
    renderWhy(msg.index, msg.values as Record<string, number>);
  }
};

function paint(data: Float32Array): void {
  if (!image) return;
  const px = image.data;
  const inv = 255 / active.max;
  for (let i = 0, p = 0; i < data.length; i++, p += 4) {
    let v = data[i] * inv;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    const o = (v | 0) * 4;
    px[p] = lut[o];
    px[p + 1] = lut[o + 1];
    px[p + 2] = lut[o + 2];
    px[p + 3] = 255;
  }
  offCtx.putImageData(image, 0, 0);
  const scale = Math.min(canvas.width / width, canvas.height / height);
  ctx.fillStyle = '#06070a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    off,
    (canvas.width - width * scale) / 2, (canvas.height - height * scale) / 2,
    width * scale, height * scale,
  );
}

function renderStats(tick: number): void {
  const rows: Array<[string, string]> = [
    ['Grid', `${width}x${height}`],
    ['Area', `${meta.areaKm2.toFixed(1)} km²`],
    ['Population', meta.population.toLocaleString()],
    ['Built cells', meta.builtCells.toLocaleString()],
    ['Field memory', `${meta.memMB.toFixed(1)} MB`],
    ['Tick', String(tick)],
    ['Sim cost', `${frameMs.toFixed(2)} ms`],
    ['Budget', `${((frameMs / 100) * 100).toFixed(1)}% of 100 ms`],
  ];
  statsEl.innerHTML = rows
    .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
    .join('');
}

/**
 * The seed of the Why Panel. Right now it just names the strongest contributors to land
 * value at this cell — but that is the whole point of the field model: every number on
 * screen is a real value in an array, attributable to a cause.
 */
function renderWhy(index: number, v: Record<string, number>): void {
  const x = index % width;
  const y = Math.floor(index / width);
  const contributions: Array<[string, number]> = [
    ['amenity access', v.amenityAccess * 0.45],
    ['transit access', v.transitAccess * 0.30],
    ['school coverage', v.schoolCover * 0.20],
    ['police coverage', v.policeCover * 0.10],
    ['pollution', -v.pollution * 0.55],
    ['crime', -v.crime * 0.40],
  ]
    .filter(([, n]) => Math.abs(n) >= 0.5)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));

  const lines = contributions
    .map(([name, n]) => `   ${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}  ${name}`)
    .join('\n');

  whyEl.innerHTML =
    `<b>Cell ${x}, ${y}</b>\n` +
    `Land value <b>${v.landValue.toFixed(1)}</b>  (base 20)\n` +
    (lines || '   no significant influences') +
    `\n\nResidents ${v.popR.toFixed(0)} · jobs C ${v.jobsC.toFixed(0)} / I ${v.jobsI.toFixed(0)}`;
}

worker.postMessage({ type: 'init', size: SIZE });

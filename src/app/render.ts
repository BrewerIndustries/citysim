/**
 * City renderer.
 *
 * Draws only the visible cell rect into an ImageData at 1px per cell, then blits it
 * scaled with smoothing off. That keeps cost proportional to the VIEWPORT rather than
 * the map, so a 2048² city renders as cheaply as a 256² one — which is the whole reason
 * Cities: Skylines II fell over (docs/DO-NOT-DO.md #11).
 *
 * Pixels are written through a Uint32 view; per-channel byte writes measurably slower.
 */
import type { Camera } from './camera.ts';
import type { Snapshot } from './protocol.ts';
import {
  GROUND, GROUND_ALT, ROAD, ROAD_COLOUR, JUNCTION_MARK, LEVEL_LIFT, ROAD_HIGH, TREE_COLOUR,
  UNPOWERED, ZONE_TINT, GRID_LINE, DEVELOPED_OUTLINE,
  WATER_DEEP, WATER_SHALLOW, SHORE, mix, buildingColour, CIVIC_COLOUR,
  POWER_LINE, PIPE_LINE, SEWER_LINE, POWER_REACH, PIPE_REACH, SEWER_REACH,
  DEAD_UTILITY, SOURCE_MARK,
} from './citypalette.ts';
import { SEA_LEVEL } from '../sim/terrain.ts';
import { CIVIC_BY_ID } from '../sim/tiles.ts';

/**
 * One data layer ready to draw: where its values come from, how to scale them, the ramp
 * to use on its own, and the identity colour to use when it is one of several.
 */
export interface Overlay {
  data: ArrayLike<number>;
  lut: Uint8ClampedArray;
  max: number;
  alpha: number;
  key: readonly [number, number, number];
}

export class CityRenderer {
  private readonly off = document.createElement('canvas');
  private readonly offCtx: CanvasRenderingContext2D;
  private image: ImageData | null = null;
  private pixels: Uint32Array | null = null;
  private imgW = 0;
  private imgH = 0;

  private readonly gridWidth: number;
  private terrain: { water: Uint8Array; shore: Uint8Array; height: Uint8Array } | null = null;
  private networks: ReadonlyArray<'power' | 'water' | 'sewer'> = [];

  constructor(gridWidth: number) {
    this.gridWidth = gridWidth;
    const ctx = this.off.getContext('2d', { willReadFrequently: false });
    if (!ctx) throw new Error('2d context unavailable');
    this.offCtx = ctx;
  }

  setTerrain(water: Uint8Array, shore: Uint8Array, height: Uint8Array): void {
    this.terrain = { water, shore, height };
  }

  /**
   * Show utility networks instead of a field overlay. More than one may be shown at
   * once, which is the view you want when checking whether a street carries everything
   * it should.
   *
   * These are drawn from the tile planes rather than sampled from a diffused field,
   * because a pipe is a thing you laid, not a value that spread.
   */
  setNetworks(kinds: ReadonlyArray<'power' | 'water' | 'sewer'>): void {
    this.networks = kinds;
  }

  private ensure(w: number, h: number): void {
    if (this.imgW === w && this.imgH === h && this.image) return;
    this.imgW = w;
    this.imgH = h;
    this.off.width = w;
    this.off.height = h;
    this.image = new ImageData(w, h);
    this.pixels = new Uint32Array(this.image.data.buffer);
  }

  draw(
    ctx: CanvasRenderingContext2D,
    vw: number, vh: number,
    snap: Snapshot,
    cam: Camera,
    overlays: ReadonlyArray<Overlay>,
    hover: { x: number; y: number } | null,
    brush: number,
    preview: number[] = [],
  ): void {
    const r = cam.viewRect(vw, vh);
    this.ensure(r.w, r.h);
    const px = this.pixels!;
    const gw = this.gridWidth;
    const {
      zone, density, road, roadClass, roadLevel, junction, trees,
      level, civic, powered, watered, sewered,
      powerLine, pipe, sewer,
    } = snap;
    const nets = this.networks;
    // Hoisted out of the pixel loop: these decide the branch taken for every cell.
    const solo = overlays.length === 1 ? overlays[0] : null;
    const multi = overlays.length > 1 ? overlays : null;

    for (let y = 0; y < r.h; y++) {
      const srcRow = (r.y0 + y) * gw;
      const dstRow = y * r.w;
      for (let x = 0; x < r.w; x++) {
        const i = srcRow + r.x0 + x;
        let c: number;

        const terrain = this.terrain;
        if (terrain && terrain.water[i]) {
          // Depth shading: the further below sea level, the darker the water.
          const depth = Math.min(1, (SEA_LEVEL - terrain.height[i]) / SEA_LEVEL);
          px[dstRow + x] = mix(WATER_SHALLOW, WATER_DEEP, depth);
          continue;
        }

        if (road[i]) {
          // Wider roads read lighter, so the hierarchy of the network is visible without
          // turning on a layer to see it.
          c = ROAD_COLOUR[roadClass[i]] ?? ROAD;
          // Height reads as brightness: a raised carriageway is visibly above the one it
          // crosses rather than merging into it.
          const lift = LEVEL_LIFT[roadLevel[i]] ?? 0;
          if (lift > 0) c = mix(c, ROAD_HIGH, lift);
          // A junction is worth more than the tiles it is made of, so it should not look
          // identical to them.
          if (junction[i]) c = mix(c, JUNCTION_MARK, 0.55);
        } else if (civic[i]) {
          c = CIVIC_COLOUR[civic[i]] ?? GROUND;
        } else if (level[i] > 0) {
          c = buildingColour(zone[i], level[i]);
          if (!powered[i]) c = UNPOWERED;
        } else if (zone[i]) {
          c = ZONE_TINT[zone[i]];
          // Density reads as a subtle stipple on empty lots, so you can tell what you
          // painted before anything is built on it.
          if (density[i] > 0 && ((r.x0 + x + r.y0 + y) & 1) === 0) c = lighten(c, density[i] * 10);
        } else if (terrain && terrain.shore[i]) {
          c = SHORE;
        } else {
          c = ((r.x0 + x) ^ (r.y0 + y)) & 4 ? GROUND : GROUND_ALT;
        }

        // Planting sits under everything built, so a treed street still reads as a
        // street — it is landscaping, not a land use.
        if (trees[i] && level[i] === 0 && !civic[i]) {
          c = mix(c, TREE_COLOUR, 0.3 + (trees[i] / 3) * 0.55);
        }

        // Gentle elevation shading on open land, so the map reads as terrain rather
        // than a flat plain. Cosmetic only — height has no gameplay effect yet.
        if (terrain && level[i] === 0 && !road[i] && !civic[i]) {
          const lift = (terrain.height[i] - SEA_LEVEL) / (255 - SEA_LEVEL);
          c = mix(c, 0xff000000 | 0x00ffffff, Math.max(0, Math.min(0.16, lift * 0.16)));
        }

        if (nets.length) {
          // Network view: the source, the conductor, the land it reaches, and — in red —
          // anything built that the network is failing to serve. With several networks
          // shown at once the strongest statement wins: an unserved building is more
          // urgent than a conductor, and a conductor than mere reach, so a tile that is
          // piped on one network and stranded on another reads as stranded.
          let mark = 0;
          let line = 0;
          let dead = false;
          let reach = 0;
          for (const net of nets) {
            const conductor = net === 'power' ? powerLine[i] : net === 'water' ? pipe[i] : sewer[i];
            const served = net === 'power' ? powered[i] : net === 'water' ? watered[i] : sewered[i];
            const def = civic[i] ? CIVIC_BY_ID.get(civic[i]) : undefined;
            const isSource = net === 'power' ? !!def?.supply
              : net === 'water' ? !!def?.water
              : !!def?.sewage;
            // Picked out in white: this is the thing the network has to reach, and an
            // unattached one is the single most confusing state to be in.
            if (isSource) mark = SOURCE_MARK;
            else if (conductor) {
              const col = net === 'power' ? POWER_LINE : net === 'water' ? PIPE_LINE : SEWER_LINE;
              // Where two conductors share a tile — a sewer crossing a water main — the
              // colours average, so crossings are visibly not plain runs of either.
              line = line ? mix(line, col, 0.5) : col;
            } else if (level[i] > 0 && !served) dead = true;
            else if (served) {
              const col = net === 'power' ? POWER_REACH : net === 'water' ? PIPE_REACH : SEWER_REACH;
              reach = reach ? mix(reach, col, 0.5) : col;
            }
          }
          if (mark) c = mark;
          else if (dead) c = DEAD_UTILITY;
          else if (line) c = line;
          else if (reach) c = mix(c, reach, 0.55);
          px[dstRow + x] = c;
          continue;
        }

        // Infrastructure takes a lighter wash than open land, so the street grid and
        // civic buildings stay readable underneath a data view. Without this the
        // overlay drowns the city and you can't tell where you are on the map.
        const wash = (road[i] || civic[i]) ? 0.45 : 1;

        if (solo) {
          const v = Math.max(0, Math.min(255, (solo.data[i] / solo.max) * 255)) | 0;
          const o = v * 4;
          c = blend(c, solo.lut[o], solo.lut[o + 1], solo.lut[o + 2], solo.alpha * wash);
        } else if (multi) {
          // With several layers up, a shared ramp would make them indistinguishable, so
          // each cell is painted by whichever layer is strongest there, in that layer's
          // own colour, at an intensity that is its own value. The question it answers
          // is "which of these is the dominant pressure here", which is the question you
          // open several layers to ask.
          let best = 0;
          let bestKey: readonly [number, number, number] | null = null;
          let bestAlpha = 0;
          for (const o of multi) {
            const v = o.data[i] / o.max;
            if (v > best) { best = v; bestKey = o.key; bestAlpha = o.alpha; }
          }
          if (bestKey && best > 0.02) {
            const t = Math.min(1, best);
            c = blend(c, bestKey[0], bestKey[1], bestKey[2], bestAlpha * wash * t);
          }
        }

        px[dstRow + x] = c;
      }
    }

    this.offCtx.putImageData(this.image!, 0, 0);

    const s = cam.scale;
    const origin = cam.screenOf(r.x0, r.y0, vw, vh);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0a0c0e';
    ctx.fillRect(0, 0, vw, vh);
    ctx.drawImage(this.off, Math.round(origin.x), Math.round(origin.y), r.w * s, r.h * s);

    if (s >= 8) this.drawGrid(ctx, cam, r, vw, vh, s);
    if (s >= 4) this.drawDevelopedOutline(ctx, cam, r, snap, vw, vh, s);
    if (preview.length) this.drawPreview(ctx, cam, preview, vw, vh, s);
    else if (hover) this.drawBrush(ctx, cam, hover, brush, vw, vh, s);
  }

  /**
   * Outline contiguous developed land.
   *
   * Colour alone was not enough to tell "zoned and built" from "zoned and waiting" at a
   * glance. Every boundary segment is collected into ONE Path2D and stroked once, so the
   * cost is proportional to the PERIMETER of built-up areas rather than their area —
   * per-cell strokeRect calls would be thousands of draws a frame.
   */
  private drawDevelopedOutline(
    ctx: CanvasRenderingContext2D, cam: Camera,
    r: { x0: number; y0: number; w: number; h: number }, snap: Snapshot,
    vw: number, vh: number, s: number,
  ): void {
    const { level } = snap;
    const gw = this.gridWidth;
    const path = new Path2D();
    const origin = cam.screenOf(r.x0, r.y0, vw, vh);
    const ox = Math.round(origin.x);
    const oy = Math.round(origin.y);
    let segments = 0;

    for (let y = 0; y < r.h; y++) {
      const gy = r.y0 + y;
      for (let x = 0; x < r.w; x++) {
        const gx = r.x0 + x;
        const i = gy * gw + gx;
        if (level[i] === 0) continue;
        const px = ox + x * s;
        const py = oy + y * s;
        // Add each edge only from the developed side, so shared borders aren't drawn twice.
        if (gx === 0 || level[i - 1] === 0) { path.moveTo(px, py); path.lineTo(px, py + s); segments++; }
        if (gx === gw - 1 || level[i + 1] === 0) { path.moveTo(px + s, py); path.lineTo(px + s, py + s); segments++; }
        if (gy === 0 || level[i - gw] === 0) { path.moveTo(px, py); path.lineTo(px + s, py); segments++; }
        if (level[i + gw] === undefined || level[i + gw] === 0) { path.moveTo(px, py + s); path.lineTo(px + s, py + s); segments++; }
      }
    }
    if (!segments) return;
    ctx.strokeStyle = DEVELOPED_OUTLINE;
    ctx.lineWidth = s >= 12 ? 1.5 : 1;
    ctx.stroke(path);
  }

  private drawGrid(
    ctx: CanvasRenderingContext2D, cam: Camera,
    r: { x0: number; y0: number; x1: number; y1: number }, vw: number, vh: number, s: number,
  ): void {
    ctx.strokeStyle = GRID_LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = r.x0; x <= r.x1; x++) {
      const p = Math.round(cam.screenOf(x, 0, vw, vh).x) + 0.5;
      ctx.moveTo(p, 0); ctx.lineTo(p, vh);
    }
    for (let y = r.y0; y <= r.y1; y++) {
      const p = Math.round(cam.screenOf(0, y, vw, vh).y) + 0.5;
      ctx.moveTo(0, p); ctx.lineTo(vw, p);
    }
    ctx.stroke();
  }

  /**
   * The cells a line or rectangle drag is about to affect.
   *
   * Drawn as one filled path and one stroked path rather than per-cell calls, so a
   * hundred-tile rectangle costs two draws instead of two hundred.
   */
  private drawPreview(
    ctx: CanvasRenderingContext2D, cam: Camera, cells: number[],
    vw: number, vh: number, s: number,
  ): void {
    const gw = this.gridWidth;
    const path = new Path2D();
    for (const i of cells) {
      const p = cam.screenOf(i % gw, (i / gw) | 0, vw, vh);
      path.rect(Math.round(p.x), Math.round(p.y), s, s);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fill(path);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    ctx.stroke(path);
  }

  private drawBrush(
    ctx: CanvasRenderingContext2D, cam: Camera, hover: { x: number; y: number },
    brush: number, vw: number, vh: number, s: number,
  ): void {
    const half = (brush - 1) >> 1;
    const p = cam.screenOf(hover.x - half, hover.y - half, vw, vh);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.strokeRect(Math.round(p.x) + 0.5, Math.round(p.y) + 0.5, brush * s, brush * s);
  }
}

function lighten(c: number, amount: number): number {
  const r = Math.min(255, (c & 255) + amount);
  const g = Math.min(255, ((c >>> 8) & 255) + amount);
  const b = Math.min(255, ((c >>> 16) & 255) + amount);
  return (255 << 24) | (b << 16) | (g << 8) | r;
}

function blend(c: number, r2: number, g2: number, b2: number, a: number): number {
  const r = (c & 255) * (1 - a) + r2 * a;
  const g = ((c >>> 8) & 255) * (1 - a) + g2 * a;
  const b = ((c >>> 16) & 255) * (1 - a) + b2 * a;
  return (255 << 24) | ((b | 0) << 16) | ((g | 0) << 8) | (r | 0);
}

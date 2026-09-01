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
  GROUND, GROUND_ALT, ROAD, UNPOWERED, ZONE_TINT, GRID_LINE, DEVELOPED_OUTLINE,
  buildingColour, CIVIC_COLOUR,
} from './citypalette.ts';

export interface Overlay {
  lut: Uint8ClampedArray;
  max: number;
  alpha: number;
}

export class CityRenderer {
  private readonly off = document.createElement('canvas');
  private readonly offCtx: CanvasRenderingContext2D;
  private image: ImageData | null = null;
  private pixels: Uint32Array | null = null;
  private imgW = 0;
  private imgH = 0;

  private readonly gridWidth: number;

  constructor(gridWidth: number) {
    this.gridWidth = gridWidth;
    const ctx = this.off.getContext('2d', { willReadFrequently: false });
    if (!ctx) throw new Error('2d context unavailable');
    this.offCtx = ctx;
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
    overlay: Overlay | null,
    hover: { x: number; y: number } | null,
    brush: number,
  ): void {
    const r = cam.viewRect(vw, vh);
    this.ensure(r.w, r.h);
    const px = this.pixels!;
    const gw = this.gridWidth;
    const { zone, density, road, level, civic, powered, layer } = snap;

    for (let y = 0; y < r.h; y++) {
      const srcRow = (r.y0 + y) * gw;
      const dstRow = y * r.w;
      for (let x = 0; x < r.w; x++) {
        const i = srcRow + r.x0 + x;
        let c: number;

        if (road[i]) {
          c = ROAD;
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
        } else {
          c = ((r.x0 + x) ^ (r.y0 + y)) & 4 ? GROUND : GROUND_ALT;
        }

        if (overlay && layer) {
          const v = Math.max(0, Math.min(255, (layer[i] / overlay.max) * 255)) | 0;
          const o = v * 4;
          // Infrastructure takes a lighter wash than open land, so the street grid and
          // civic buildings stay readable underneath a data view. Without this the
          // overlay drowns the city and you can't tell where you are on the map.
          const a = (road[i] || civic[i]) ? overlay.alpha * 0.45 : overlay.alpha;
          c = blend(c, overlay.lut[o], overlay.lut[o + 1], overlay.lut[o + 2], a);
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
    if (hover) this.drawBrush(ctx, cam, hover, brush, vw, vh, s);
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

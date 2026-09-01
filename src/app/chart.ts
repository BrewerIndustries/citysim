/**
 * The History graph.
 *
 * Each series is normalised to its own range so they can share one frame — population
 * in the thousands and average pollution in the tens are not comparable on a shared
 * axis, and forcing them onto one flattens everything interesting.
 */
import { SERIES, type SeriesData, type SeriesKey } from '../sim/history-series.ts';

export class Chart {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  visible: Set<SeriesKey> = new Set(['population', 'jobs', 'funds']);

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  }

  toggle(key: SeriesKey): void {
    if (this.visible.has(key)) this.visible.delete(key);
    else this.visible.add(key);
  }

  draw(data: SeriesData | null): void {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    if (r.width < 4) return;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    const { ctx } = this;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.fillStyle = '#0e1116';
    ctx.fillRect(0, 0, w, h);

    const pad = 4 * dpr;
    const points = data ? Math.max(...SERIES.map((s) => data[s.key].length)) : 0;
    if (!data || points < 2) {
      ctx.fillStyle = '#5d6474';
      ctx.font = `${11 * dpr}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('A few months of history needed', w / 2, h / 2 + 4 * dpr);
      return;
    }

    // Horizontal guides.
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let n = 1; n < 4; n++) {
      const y = pad + ((h - pad * 2) * n) / 4;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    for (const s of SERIES) {
      if (!this.visible.has(s.key)) continue;
      const values = data[s.key];
      if (values.length < 2) continue;

      // Each series gets its own scale; a shared axis would flatten everything but the
      // largest number on screen.
      let min = Infinity;
      let max = -Infinity;
      for (const v of values) { if (v < min) min = v; if (v > max) max = v; }
      if (min === max) { min -= 1; max += 1; }
      // Always include zero for signed series so a deficit reads as below the line.
      if (min > 0 && s.key === 'net') min = 0;
      if (max < 0 && s.key === 'net') max = 0;

      ctx.strokeStyle = s.colour;
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      for (let i = 0; i < values.length; i++) {
        const x = (i / (values.length - 1)) * w;
        const y = pad + (h - pad * 2) * (1 - (values[i] - min) / (max - min));
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
}

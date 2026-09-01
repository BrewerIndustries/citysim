/**
 * Pan/zoom camera over the cell grid.
 *
 * Zoom is integer pixels-per-cell so the nearest-neighbour blit stays crisp — at
 * fractional scales the grid shimmers as you pan, which reads as a rendering bug even
 * though the simulation is fine.
 */
export const ZOOM_STEPS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32];

export class Camera {
  /** Cell coordinates at the centre of the viewport. */
  cx: number;
  cy: number;
  // 16 device px/cell. On a 2x display that's 8 CSS px, which is the smallest zoom where
  // individual lots are still clickable — starting further out made the opening city a
  // few dozen pixels wide.
  zoomIndex = 7;
  // Declared explicitly rather than as constructor parameter properties: the sim and app
  // must stay erasable TypeScript so `node --experimental-strip-types` can run them.
  private readonly width: number;
  private readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.cx = width / 2;
    this.cy = height / 2;
  }

  get scale(): number { return ZOOM_STEPS[this.zoomIndex]; }

  zoomAt(delta: number, screenX: number, screenY: number, vw: number, vh: number): void {
    const before = this.cellAt(screenX, screenY, vw, vh);
    const next = Math.max(0, Math.min(ZOOM_STEPS.length - 1, this.zoomIndex + delta));
    if (next === this.zoomIndex) return;
    this.zoomIndex = next;
    const after = this.cellAt(screenX, screenY, vw, vh);
    // Keep the cell under the cursor pinned in place while zooming.
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
    this.clamp(vw, vh);
  }

  panByPixels(dx: number, dy: number, vw: number, vh: number): void {
    this.cx -= dx / this.scale;
    this.cy -= dy / this.scale;
    this.clamp(vw, vh);
  }

  clamp(vw: number, vh: number): void {
    const halfW = vw / this.scale / 2;
    const halfH = vh / this.scale / 2;
    this.cx = Math.max(Math.min(halfW, this.width / 2), Math.min(this.cx, Math.max(this.width - halfW, this.width / 2)));
    this.cy = Math.max(Math.min(halfH, this.height / 2), Math.min(this.cy, Math.max(this.height - halfH, this.height / 2)));
  }

  /** Fractional cell coordinate under a screen pixel. */
  cellAt(sx: number, sy: number, vw: number, vh: number): { x: number; y: number } {
    return {
      x: this.cx + (sx - vw / 2) / this.scale,
      y: this.cy + (sy - vh / 2) / this.scale,
    };
  }

  /** Integer cell under a screen pixel, or null if outside the map. */
  cellIndexAt(sx: number, sy: number, vw: number, vh: number): { x: number; y: number } | null {
    const c = this.cellAt(sx, sy, vw, vh);
    const x = Math.floor(c.x);
    const y = Math.floor(c.y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
    return { x, y };
  }

  /** Visible cell rect, clipped to the map. */
  viewRect(vw: number, vh: number) {
    const x0 = Math.max(0, Math.floor(this.cx - vw / this.scale / 2));
    const y0 = Math.max(0, Math.floor(this.cy - vh / this.scale / 2));
    const x1 = Math.min(this.width, Math.ceil(this.cx + vw / this.scale / 2) + 1);
    const y1 = Math.min(this.height, Math.ceil(this.cy + vh / this.scale / 2) + 1);
    return { x0, y0, x1, y1, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  }

  /** Screen position of a cell's top-left corner. */
  screenOf(cellX: number, cellY: number, vw: number, vh: number): { x: number; y: number } {
    return {
      x: (cellX - this.cx) * this.scale + vw / 2,
      y: (cellY - this.cy) * this.scale + vh / 2,
    };
  }
}

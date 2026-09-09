/**
 * The ¾ camera.
 *
 * Orthographic, per docs/CAMERA-AND-ART.md: it buys the isometric readability of the
 * classic games — no perspective lean at the screen edges, the grid stays legible right
 * across the viewport — while keeping real terrain, real rotation and a real skyline.
 *
 * Tilt is clamped to a band and yaw snaps to eighths. That is not a limitation, it is
 * the budget: a fixed tilt band and zoom range means we know exactly which silhouettes
 * have to read, and we never have to make a building look right from street level, which
 * is where photoreal costs explode.
 */
import * as THREE from 'three';

/** World units per cell. One cell is 8m, so the scene is roughly 1 unit = 8m. */
export const CELL = 1;
/** Vertical exaggeration applied to terrain height. Modest: this is a city, not the Alps. */
export const HEIGHT_SCALE = 0.028;

const MIN_TILT = 25 * (Math.PI / 180);
const MAX_TILT = 70 * (Math.PI / 180);
const YAW_SNAP = Math.PI / 4;

/** Half-height of the ortho frustum, in world units. Smaller = closer. */
const MIN_ZOOM = 12;
const MAX_ZOOM = 320;

export class Camera3D {
  readonly camera: THREE.OrthographicCamera;
  /** Point on the ground the camera orbits, in world units. */
  target = new THREE.Vector3();
  yaw = Math.PI / 4;
  tilt = 48 * (Math.PI / 180);
  zoom = 34;

  private readonly worldW: number;
  private readonly worldH: number;

  constructor(gridWidth: number, gridHeight: number) {
    this.worldW = gridWidth * CELL;
    this.worldH = gridHeight * CELL;
    this.target.set(this.worldW / 2, 0, this.worldH / 2);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 4000);
    this.apply(1);
  }

  /** Rebuild the frustum for the viewport aspect and place the camera on its orbit. */
  apply(aspect: number): void {
    const c = this.camera;
    c.top = this.zoom;
    c.bottom = -this.zoom;
    c.left = -this.zoom * aspect;
    c.right = this.zoom * aspect;
    c.updateProjectionMatrix();

    // Far enough back that nothing clips through the near plane on tall terrain.
    const dist = 1200;
    const cosT = Math.cos(this.tilt);
    c.position.set(
      this.target.x + dist * cosT * Math.sin(this.yaw),
      this.target.y + dist * Math.sin(this.tilt),
      this.target.z + dist * cosT * Math.cos(this.yaw),
    );
    c.lookAt(this.target);
  }

  rotate(steps: number): void {
    this.yaw = Math.round(this.yaw / YAW_SNAP + steps) * YAW_SNAP;
  }

  tiltBy(delta: number): void {
    this.tilt = Math.max(MIN_TILT, Math.min(MAX_TILT, this.tilt + delta));
  }

  zoomBy(steps: number): void {
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * Math.pow(1.22, -steps)));
  }

  /**
   * Zoom towards a point on screen rather than towards the middle.
   *
   * The difference between the two is most of why an orthographic camera feels awkward:
   * zooming to the centre means every zoom is followed by a pan to put back what you were
   * looking at. Keeping the cursor over the same ground makes the view feel dragged rather
   * than driven.
   *
   * `px`/`py` are pixels from the top-left of the viewport.
   */
  zoomAtPixel(steps: number, px: number, py: number, width: number, height: number): void {
    const before = this.zoom;
    this.zoomBy(steps);
    const after = this.zoom;
    if (after === before) return;
    // How far the cursor sits from the centre, in world units, before and after. The
    // target moves by the difference so the ground under the cursor stays put.
    const perPixel = (h: number) => (h * 2) / height;
    const offX = px - width / 2;
    const offY = py - height / 2;
    const shift = perPixel(before) - perPixel(after);
    const cosY = Math.cos(this.yaw);
    const sinY = Math.sin(this.yaw);
    // Screen right and screen "up the slope" in world space, same basis panByPixels uses.
    const wx = offX * shift;
    const wz = (offY * shift) / Math.max(0.2, Math.sin(this.tilt));
    this.target.x += wx * cosY - wz * sinY;
    this.target.z += -wx * sinY - wz * cosY;
    this.clamp();
  }

  /** Pan across the ground plane, in screen-relative pixels. */
  panByPixels(dx: number, dy: number, viewportHeight: number): void {
    const perPixel = (this.zoom * 2) / viewportHeight;
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.target.addScaledVector(right, -dx * perPixel);
    // Dragging "up" should move the map away, which on the ground is along +forward
    // divided by the tilt — a shallow camera covers more ground per pixel.
    this.target.addScaledVector(fwd, (dy * perPixel) / Math.max(0.35, Math.sin(this.tilt)));
    this.clamp();
  }

  private clamp(): void {
    this.target.x = Math.max(0, Math.min(this.worldW, this.target.x));
    this.target.z = Math.max(0, Math.min(this.worldH, this.target.z));
  }

  /** Centre on a cell, keeping the current orbit. */
  lookAtCell(cx: number, cy: number): void {
    this.target.x = cx * CELL;
    this.target.z = cy * CELL;
    this.clamp();
  }

  /**
   * Cells that could be on screen, as a rect with a margin.
   *
   * Instances are only built for these, so the cost of a frame tracks the VIEWPORT
   * rather than the map — the same rule the 2D renderer follows, and the one Cities:
   * Skylines II broke.
   */
  visibleCells(aspect: number, gridWidth: number, gridHeight: number) {
    // The ground footprint of an orthographic frustum tilted by `tilt` is the frustum
    // height divided by sin(tilt) along the view direction, and its width across.
    const halfDepth = this.zoom / Math.max(0.3, Math.sin(this.tilt));
    const halfWidth = this.zoom * aspect;
    const reach = Math.ceil((Math.max(halfDepth, halfWidth) + 24) / CELL);
    const cx = Math.round(this.target.x / CELL);
    const cy = Math.round(this.target.z / CELL);
    return {
      x0: Math.max(0, cx - reach),
      y0: Math.max(0, cy - reach),
      x1: Math.min(gridWidth - 1, cx + reach),
      y1: Math.min(gridHeight - 1, cy + reach),
    };
  }
}

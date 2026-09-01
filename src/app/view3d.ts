/**
 * The ¾ view.
 *
 * Untextured massing blocks: the point of this pass is to judge whether the camera,
 * the proportions and the silhouette read correctly, BEFORE any building is modelled.
 * The art pipeline is what eats projects of this kind, so it goes last.
 *
 * Everything here is a consumer of the same snapshot the 2D renderer reads. The
 * simulation does not know this file exists.
 */
import * as THREE from 'three';
import { Camera3D, CELL, HEIGHT_SCALE } from './camera3d.ts';
import type { Snapshot } from './protocol.ts';
import { SEA_LEVEL } from '../sim/terrain.ts';
import { CIVIC_BY_ID } from '../sim/tiles.ts';

/** Storeys are exaggerated slightly, like an architect's model. */
const STOREY = 0.55;

const ZONE_COLOUR = [
  new THREE.Color('#3a4a3c'),
  new THREE.Color('#7fc389'),
  new THREE.Color('#6fb0e0'),
  new THREE.Color('#d9ae62'),
];
const UNPOWERED = new THREE.Color('#8a4038');
const ROAD_COLOUR = new THREE.Color('#4a4f58');
const GROUND_LOW = new THREE.Color('#1f2a1e');
const GROUND_HIGH = new THREE.Color('#3b4733');
const SHORE_COLOUR = new THREE.Color('#4a4735');

export interface Terrain3D {
  water: Uint8Array;
  shore: Uint8Array;
  height: Uint8Array;
  floodRisk: Uint8Array;
}

/** Max blocks drawn in one frame. Beyond this the far ones are dropped, not queued. */
const MAX_BUILDINGS = 120_000;
const MAX_ROADS = 120_000;

export class View3D {
  readonly canvas: HTMLCanvasElement;
  readonly cam: Camera3D;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly gridW: number;
  private readonly gridH: number;
  private terrain: Terrain3D | null = null;

  private ground: THREE.Mesh | null = null;
  private groundColours: Float32Array | null = null;
  private water: THREE.Mesh | null = null;
  private buildings: THREE.InstancedMesh;
  private roads: THREE.InstancedMesh;
  private readonly dummy = new THREE.Object3D();
  private readonly colour = new THREE.Color();
  private hover: THREE.Mesh;

  constructor(canvas: HTMLCanvasElement, gridWidth: number, gridHeight: number) {
    this.canvas = canvas;
    this.gridW = gridWidth;
    this.gridH = gridHeight;
    this.cam = new Camera3D(gridWidth, gridHeight);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setClearColor(0x0a0c0e);
    this.scene.background = new THREE.Color(0x0a0c0e);

    // A hemisphere light does most of the work: it darkens undersides and north faces
    // the way ambient occlusion would, which is what gives simple geometry the sculpted
    // look of a physical model without paying for a post-processing pass.
    //
    // Kept deliberately dim, with the sun carrying the contrast. The first pass had both
    // turned up and everything washed out to a pale olive — a lit model, not a lit scene.
    const sky = new THREE.HemisphereLight(0x9fbde8, 0x201f18, 0.55);
    this.scene.add(sky);
    const sun = new THREE.DirectionalLight(0xfff0d4, 1.15);
    sun.position.set(-0.55, 0.9, 0.35).multiplyScalar(200);
    this.scene.add(sun);

    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0); // origin at the base, so scaling grows upward
    // NOT vertexColors: that reads a per-vertex `color` attribute the box geometry does
    // not have, and every instance renders black. Per-instance colour comes from
    // setColorAt, which three feeds in through instanceColor on its own.
    this.buildings = new THREE.InstancedMesh(
      box, new THREE.MeshLambertMaterial(), MAX_BUILDINGS,
    );
    this.buildings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.buildings.count = 0;
    this.buildings.frustumCulled = false;
    this.scene.add(this.buildings);

    const slab = new THREE.BoxGeometry(1, 1, 1);
    slab.translate(0, 0.5, 0);
    this.roads = new THREE.InstancedMesh(
      slab, new THREE.MeshLambertMaterial(), MAX_ROADS,
    );
    this.roads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.roads.count = 0;
    this.roads.frustumCulled = false;
    this.scene.add(this.roads);

    this.hover = new THREE.Mesh(
      new THREE.BoxGeometry(CELL, 0.05, CELL),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }),
    );
    this.hover.visible = false;
    this.scene.add(this.hover);
  }

  dispose(): void { this.renderer.dispose(); }

  setTerrain(t: Terrain3D): void {
    this.terrain = t;
    this.buildGround();
  }

  private heightAt(i: number): number {
    const t = this.terrain;
    if (!t) return 0;
    return (t.height[i] - SEA_LEVEL) * HEIGHT_SCALE;
  }

  /** One mesh for the whole map, coloured per vertex. Rebuilt only when terrain changes. */
  private buildGround(): void {
    const t = this.terrain;
    if (!t) return;
    if (this.ground) { this.scene.remove(this.ground); this.ground.geometry.dispose(); }
    if (this.water) { this.scene.remove(this.water); }

    const w = this.gridW;
    const h = this.gridH;
    const geo = new THREE.PlaneGeometry((w - 1) * CELL, (h - 1) * CELL, w - 1, h - 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate(((w - 1) * CELL) / 2, 0, ((h - 1) * CELL) / 2);

    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colours = new Float32Array(pos.count * 3);
    for (let n = 0; n < pos.count; n++) {
      const x = n % w;
      const y = (n / w) | 0;
      const i = y * w + x;
      pos.setY(n, this.heightAt(i));
      const lift = Math.max(0, Math.min(1, (t.height[i] - SEA_LEVEL) / 110));
      const c = t.shore[i] ? SHORE_COLOUR : GROUND_LOW.clone().lerp(GROUND_HIGH, lift);
      colours[n * 3] = c.r;
      colours[n * 3 + 1] = c.g;
      colours[n * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    geo.computeVertexNormals();
    this.groundColours = colours;

    this.ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.scene.add(this.ground);

    let anyWater = false;
    for (let i = 0; i < t.water.length; i++) if (t.water[i]) { anyWater = true; break; }
    if (anyWater) {
      const wgeo = new THREE.PlaneGeometry(w * CELL * 1.4, h * CELL * 1.4);
      wgeo.rotateX(-Math.PI / 2);
      wgeo.translate((w * CELL) / 2, 0, (h * CELL) / 2);
      this.water = new THREE.Mesh(wgeo, new THREE.MeshLambertMaterial({
        color: 0x14293e, transparent: true, opacity: 0.9,
      }));
      this.scene.add(this.water);
    }
  }

  /**
   * Tint the ground by a data layer, or clear the tint.
   * Overlays belong in this view too — the ¾ camera is for reading the city, not only
   * admiring it.
   */
  setGroundOverlay(data: ArrayLike<number> | null, lut: Uint8ClampedArray | null, max: number): void {
    const t = this.terrain;
    const geo = this.ground?.geometry;
    const colours = this.groundColours;
    if (!t || !geo || !colours) return;
    const attr = geo.attributes.color as THREE.BufferAttribute;
    const w = this.gridW;

    for (let n = 0; n < attr.count; n++) {
      const x = n % w;
      const y = (n / w) | 0;
      const i = y * w + x;
      if (!data || !lut) {
        attr.setXYZ(n, colours[n * 3], colours[n * 3 + 1], colours[n * 3 + 2]);
        continue;
      }
      const v = Math.max(0, Math.min(255, (data[i] / max) * 255)) | 0;
      const o = v * 4;
      attr.setXYZ(n, (lut[o] / 255) ** 2.2, (lut[o + 1] / 255) ** 2.2, (lut[o + 2] / 255) ** 2.2);
    }
    attr.needsUpdate = true;
  }

  setHover(cell: { x: number; y: number } | null): void {
    if (!cell) { this.hover.visible = false; return; }
    const i = cell.y * this.gridW + cell.x;
    this.hover.position.set(cell.x * CELL, this.heightAt(i) + 0.06, cell.y * CELL);
    this.hover.visible = true;
  }

  /** Rebuild the instance buffers for whatever is on screen. */
  update(snap: Snapshot, aspect: number): void {
    const { zone, density, level, road, civic, powered } = snap;
    const r = this.cam.visibleCells(aspect, this.gridW, this.gridH);
    const w = this.gridW;

    let b = 0;
    let rd = 0;
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        const i = y * w + x;
        const base = this.heightAt(i);

        if (road[i]) {
          if (rd >= MAX_ROADS) continue;
          this.dummy.position.set(x * CELL, base, y * CELL);
          this.dummy.scale.set(CELL, 0.08, CELL);
          this.dummy.updateMatrix();
          this.roads.setMatrixAt(rd, this.dummy.matrix);
          this.roads.setColorAt(rd, ROAD_COLOUR);
          rd++;
          continue;
        }

        const civicId = civic[i];
        const lvl = level[i];
        if (!civicId && lvl === 0) continue;
        if (b >= MAX_BUILDINGS) continue;

        let height: number;
        if (civicId) {
          const def = CIVIC_BY_ID.get(civicId);
          height = def?.supply ? 2.4 : 1.5;
          this.colour.set(def?.colour ?? '#8a8f9c');
        } else {
          // Height carries both level and density, so a high-density tower reads as a
          // tower and a low-density street reads as houses.
          height = lvl * STOREY * (1 + density[i] * 0.45);
          this.colour.copy(powered[i] ? ZONE_COLOUR[zone[i]] : UNPOWERED);
          // A touch of per-cell variation so a block isn't a single flat slab.
          const jitter = 0.88 + ((i * 2654435761) % 1000) / 4200;
          this.colour.multiplyScalar(jitter);
          height *= jitter;
        }

        this.dummy.position.set(x * CELL, base, y * CELL);
        this.dummy.scale.set(CELL * 0.86, Math.max(0.12, height), CELL * 0.86);
        this.dummy.updateMatrix();
        this.buildings.setMatrixAt(b, this.dummy.matrix);
        this.buildings.setColorAt(b, this.colour);
        b++;
      }
    }

    this.buildings.count = b;
    this.roads.count = rd;
    this.buildings.instanceMatrix.needsUpdate = true;
    this.roads.instanceMatrix.needsUpdate = true;
    if (this.buildings.instanceColor) this.buildings.instanceColor.needsUpdate = true;
    if (this.roads.instanceColor) this.roads.instanceColor.needsUpdate = true;
  }

  render(width: number, height: number): void {
    if (width < 4 || height < 4) return;
    const aspect = width / height;
    this.renderer.setSize(width, height, false);
    this.cam.apply(aspect);
    this.renderer.render(this.scene, this.cam.camera);
  }

  /** Screen pixel to grid cell, by raycasting the terrain. */
  cellAtScreen(px: number, py: number, width: number, height: number): { x: number; y: number } | null {
    if (!this.ground) return null;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(
      new THREE.Vector2((px / width) * 2 - 1, -(py / height) * 2 + 1),
      this.cam.camera,
    );
    const hit = ray.intersectObject(this.ground, false)[0];
    if (!hit) return null;
    const x = Math.round(hit.point.x / CELL);
    const y = Math.round(hit.point.z / CELL);
    if (x < 0 || y < 0 || x >= this.gridW || y >= this.gridH) return null;
    return { x, y };
  }
}

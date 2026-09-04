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
import {
  roadTextures, junctionTexture, facadeTexture, roofTexture, groundTexture,
} from './textures.ts';

/** Storeys are exaggerated slightly, like an architect's model. */
const STOREY = 0.55;

/** Horizon and haze. Warm and pale rather than black: a night sky makes everything grim. */
const SKY = 0x8fa6bd;
/** Where the sun sits relative to whatever the camera is looking at. */
const SUN_OFFSET = new THREE.Vector3(-0.55, 0.9, 0.35).multiplyScalar(260);

/** How far one road level lifts the deck. Enough to read as "over", not a tower. */
const DECK_HEIGHT = 0.5;
const DECK_TINT = new THREE.Color('#e6ebf5');
const JUNCTION_TINT = new THREE.Color('#a8b0c4');

// Class colour is baked into each class's texture (see textures.ts), so there is no
// second table here to fall out of step with the first.

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
/** A drag preview past this many tiles is a mistake, not a plan. */
const MAX_PREVIEW = 40_000;

export class View3D {
  readonly canvas: HTMLCanvasElement;
  readonly cam: Camera3D;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly gridW: number;
  private readonly gridH: number;
  private terrain: Terrain3D | null = null;

  private readonly sun: THREE.DirectionalLight;
  private ground: THREE.Mesh | null = null;
  private groundColours: Float32Array | null = null;
  /** Baked once and reused: rebuilding the ground must not re-bake its texture. */
  private groundMap: THREE.CanvasTexture | null = null;
  private water: THREE.Mesh | null = null;
  private buildings: THREE.InstancedMesh;
  /**
   * One mesh per road class, plus one for unmarked tiles.
   *
   * Instancing draws one mesh with one material, and lane markings differ per class — so
   * a single road mesh could only ever show one lane count. Five draw calls buys a road
   * network you can read the width of.
   */
  private readonly roadMeshes = new Map<number, THREE.InstancedMesh>();
  private junctions!: THREE.InstancedMesh;
  private readonly dummy = new THREE.Object3D();
  private readonly colour = new THREE.Color();
  private hover: THREE.Mesh;
  private preview: THREE.InstancedMesh;

  constructor(canvas: HTMLCanvasElement, gridWidth: number, gridHeight: number) {
    this.canvas = canvas;
    this.gridW = gridWidth;
    this.gridH = gridHeight;
    this.cam = new Camera3D(gridWidth, gridHeight);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    // Filmic tone mapping rather than raw linear output. Lit surfaces clip to flat white
    // without it, which is what makes untonemapped realtime rendering look like a render
    // rather than a photograph of a model.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    // Soft shadows are the AO half of "architectural scale model". A model looks physical
    // because things sit ON something and cast onto it; without contact shadows every
    // building floats.
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(SKY);
    this.scene.background = new THREE.Color(SKY);
    // No fog. Depth fog is measured from the camera, and this one is orthographic sitting
    // 1200 units back, so every visible surface is at nearly the same depth: the choice is
    // between no effect and the entire scene uniformly fogged. Distance haze here would
    // have to be measured from the view centre, which needs a shader, not a fog colour.

    // A hemisphere light does most of the work: it darkens undersides and north faces
    // the way ambient occlusion would, which is what gives simple geometry the sculpted
    // look of a physical model without paying for a post-processing pass.
    //
    // Kept deliberately dim, with the sun carrying the contrast. The first pass had both
    // turned up and everything washed out to a pale olive — a lit model, not a lit scene.
    // Turned up from the untextured pass. A map multiplies the lit surface, so the same
    // light that read as "sculpted" on bare Lambert reads as "dusk" once every surface
    // has a texture on it.
    const sky = new THREE.HemisphereLight(0x9fbde8, 0x2a281f, 0.78);
    this.scene.add(sky);
    const sun = new THREE.DirectionalLight(0xfff0d4, 2.1);
    sun.position.set(-0.55, 0.9, 0.35).multiplyScalar(200);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    // A directional light's shadow camera is orthographic and fixed, so it has to be
    // moved and resized to follow the view — a map-sized frustum would spread 2048 texels
    // over kilometres and shadow nothing legibly.
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 900;
    sun.shadow.bias = -0.0012;
    sun.shadow.normalBias = 0.4;
    this.sun = sun;
    this.scene.add(sun);
    this.scene.add(sun.target);

    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0); // origin at the base, so scaling grows upward
    // NOT vertexColors: that reads a per-vertex `color` attribute the box geometry does
    // not have, and every instance renders black. Per-instance colour comes from
    // setColorAt, which three feeds in through instanceColor on its own.
    // BoxGeometry groups are +X, -X, +Y, -Y, +Z, -Z, so a material array puts windows on
    // the walls and a roof on the roof. Without this a building wears its facade on top,
    // and the roof is the face a ¾ camera sees most.
    const facade = new THREE.MeshLambertMaterial({ map: facadeTexture() });
    const roof = new THREE.MeshLambertMaterial({ map: roofTexture() });
    this.buildings = new THREE.InstancedMesh(
      box, [facade, facade, roof, roof, facade, facade], MAX_BUILDINGS,
    );
    this.buildings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.buildings.count = 0;
    this.buildings.frustumCulled = false;
    // Buildings cast onto the ground and onto each other, and take shadow from their
    // neighbours — a street of towers with no shadows between them reads as a diagram.
    this.buildings.castShadow = true;
    this.buildings.receiveShadow = true;
    this.scene.add(this.buildings);

    const slab = new THREE.BoxGeometry(1, 1, 1);
    slab.translate(0, 0.5, 0);
    // Same reason: the carriageway markings belong on the surface, not wrapped down the
    // sides of an elevated deck. The sides are the concrete the deck is made of.
    const deckSide = new THREE.MeshLambertMaterial({ color: 0x6a6e78 });
    const roadMesh = (map: THREE.Texture): THREE.InstancedMesh => {
      const top = new THREE.MeshLambertMaterial({ map });
      const m = new THREE.InstancedMesh(
        slab, [deckSide, deckSide, top, deckSide, deckSide, deckSide], MAX_ROADS,
      );
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      // Roads take shadow but only an elevated deck casts one: a road lying on the ground
      // casting onto the ground it lies on is just shadow acne with extra steps.
      m.receiveShadow = true;
      m.castShadow = true;
      this.scene.add(m);
      return m;
    };
    for (const [id, tex] of roadTextures()) this.roadMeshes.set(id, roadMesh(tex));
    this.junctions = roadMesh(junctionTexture());

    this.hover = new THREE.Mesh(
      new THREE.BoxGeometry(CELL, 0.05, CELL),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }),
    );
    this.hover.visible = false;
    this.scene.add(this.hover);

    const pad = new THREE.BoxGeometry(CELL, 0.06, CELL);
    this.preview = new THREE.InstancedMesh(
      pad,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 }),
      MAX_PREVIEW,
    );
    this.preview.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.preview.count = 0;
    this.preview.frustumCulled = false;
    this.scene.add(this.preview);
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

    // Vertex colours carry the terrain and the data overlays; the map adds grain on top
    // so open land is a surface rather than a flat fill. Repeated per tile rather than
    // stretched over the map, or the grain would be kilometres across.
    const detail = this.groundMap ??= groundTexture();
    detail.repeat.set(w / 4, h / 4);
    this.ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
      vertexColors: true, map: detail,
    }));
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    let anyWater = false;
    for (let i = 0; i < t.water.length; i++) if (t.water[i]) { anyWater = true; break; }
    if (anyWater) {
      const wgeo = new THREE.PlaneGeometry(w * CELL * 1.4, h * CELL * 1.4);
      wgeo.rotateX(-Math.PI / 2);
      wgeo.translate((w * CELL) / 2, 0, (h * CELL) / 2);
      // Slightly glossy and not quite opaque, so shallow water over a shelving bed reads
      // as shallower than deep water — which matters now the player can dig their own.
      this.water = new THREE.Mesh(wgeo, new THREE.MeshPhongMaterial({
        color: 0x14293e, transparent: true, opacity: 0.88,
        shininess: 70, specular: 0x2b4a68,
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

  /** Highlight the cells a line or rectangle drag would affect. */
  setPreview(cells: number[]): void {
    const n = Math.min(cells.length, MAX_PREVIEW);
    for (let k = 0; k < n; k++) {
      const i = cells[k];
      const x = i % this.gridW;
      const y = (i / this.gridW) | 0;
      this.dummy.position.set(x * CELL, this.heightAt(i) + 0.08, y * CELL);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.preview.setMatrixAt(k, this.dummy.matrix);
    }
    this.preview.count = n;
    this.preview.instanceMatrix.needsUpdate = true;
  }

  setHover(cell: { x: number; y: number } | null): void {
    if (!cell || this.preview.count > 0) { this.hover.visible = false; return; }
    const i = cell.y * this.gridW + cell.x;
    this.hover.position.set(cell.x * CELL, this.heightAt(i) + 0.06, cell.y * CELL);
    this.hover.visible = true;
  }

  /** Rebuild the instance buffers for whatever is on screen. */
  update(snap: Snapshot, aspect: number): void {
    const {
      zone, density, level, road, roadClass, roadLevel, junction, civic, civicAnchor, powered,
    } = snap;
    const r = this.cam.visibleCells(aspect, this.gridW, this.gridH);
    const w = this.gridW;

    let b = 0;
    // One running count per road mesh, keyed the same way the meshes are.
    const counts = new Map<number, number>();
    for (const id of this.roadMeshes.keys()) counts.set(id, 0);
    let jn = 0;
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        const i = y * w + x;
        const base = this.heightAt(i);

        if (road[i]) {
          // Which way the carriageway runs, so its markings run along it rather than
          // across it. A tile with road on both axes is a crossing, and lane markings
          // through a crossing would be a lie — those get the unmarked surface, as does
          // anything inside a junction.
          const lvlHere = roadLevel[i];
          const joins = (n: number): boolean =>
            road[n] === 1 && Math.abs(roadLevel[n] - lvlHere) <= 1;
          const ew = (x > r.x0 && joins(i - 1)) || (x < this.gridW - 1 && joins(i + 1));
          const ns = (y > r.y0 && joins(i - w)) || (y < this.gridH - 1 && joins(i + w));
          const marked = junction[i] === 0 && (ew !== ns);

          const mesh = marked ? this.roadMeshes.get(roadClass[i]) : this.junctions;
          if (!mesh) continue;
          const slot = marked ? (counts.get(roadClass[i]) ?? 0) : jn;
          if (slot >= MAX_ROADS) continue;

          // A raised carriageway has to be raised HERE too, or a flyover renders lying on
          // the ground passing through the road it is supposed to bridge.
          const lift = lvlHere * DECK_HEIGHT;
          this.dummy.position.set(x * CELL, base + lift, y * CELL);
          this.dummy.rotation.y = marked && ns ? Math.PI / 2 : 0;
          this.dummy.scale.set(CELL, lvlHere > 0 ? 0.14 : 0.08, CELL);
          this.dummy.updateMatrix();
          this.dummy.rotation.y = 0;
          mesh.setMatrixAt(slot, this.dummy.matrix);
          // The texture already carries the class; tinting is only for what it cannot
          // say — that this tile is a junction, or how high it is.
          this.colour.set(0xffffff);
          if (junction[i]) this.colour.lerp(JUNCTION_TINT, 0.35);
          if (lvlHere > 0) this.colour.lerp(DECK_TINT, 0.16 * lvlHere);
          mesh.setColorAt(slot, this.colour);
          if (marked) counts.set(roadClass[i], slot + 1);
          else jn = slot + 1;
          continue;
        }

        const civicId = civic[i];
        const lvl = level[i];
        if (!civicId && lvl === 0) continue;
        // A civic building is ONE building, not one per tile it covers. Drawing a box per
        // cell turned a 3x3 school into nine little blocks in a grid — which read as a
        // texture swatch rather than a building, and is the fastest way to lose the sense
        // of scale the whole massing pass exists to establish.
        if (civicId && !civicAnchor[i]) continue;
        if (b >= MAX_BUILDINGS) continue;

        let height: number;
        let footprint = 1;
        if (civicId) {
          const def = CIVIC_BY_ID.get(civicId);
          footprint = def?.size ?? 1;
          // Bigger buildings stand taller, or a 6x6 world work reads as a car park.
          height = (def?.supply ? 2.4 : 1.5) * (1 + (footprint - 1) * 0.22);
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

        // A multi-tile building is centred on its whole footprint, not on its anchor
        // cell, or it sits a tile up and left of the ground it actually occupies.
        const span = CELL * footprint;
        const off = ((footprint - 1) * CELL) / 2;
        this.dummy.position.set(x * CELL + off, base, y * CELL + off);
        this.dummy.scale.set(span * 0.9, Math.max(0.12, height), span * 0.9);
        this.dummy.updateMatrix();
        this.buildings.setMatrixAt(b, this.dummy.matrix);
        this.buildings.setColorAt(b, this.colour);
        b++;
      }
    }

    this.buildings.count = b;
    this.buildings.instanceMatrix.needsUpdate = true;
    if (this.buildings.instanceColor) this.buildings.instanceColor.needsUpdate = true;
    for (const [id, mesh] of this.roadMeshes) {
      mesh.count = counts.get(id) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.junctions.count = jn;
    this.junctions.instanceMatrix.needsUpdate = true;
    if (this.junctions.instanceColor) this.junctions.instanceColor.needsUpdate = true;
  }

  render(width: number, height: number): void {
    if (width < 4 || height < 4) return;
    const aspect = width / height;
    this.renderer.setSize(width, height, false);
    this.cam.apply(aspect);
    this.followShadow(aspect);
    this.renderer.render(this.scene, this.cam.camera);
  }

  /**
   * Keep the shadow frustum over what the camera is actually looking at.
   *
   * Sized to the view rather than the map, and padded so buildings just off screen still
   * cast into it — a shadow that pops in at the edge of the viewport is worse than none.
   */
  private followShadow(aspect: number): void {
    const t = this.cam.target;
    const sun = this.sun;
    sun.target.position.copy(t);
    sun.position.copy(t).add(SUN_OFFSET);
    const span = this.cam.zoom * Math.max(1.6, aspect * 1.35);
    const c = sun.shadow.camera;
    c.left = -span;
    c.right = span;
    c.top = span;
    c.bottom = -span;
    c.updateProjectionMatrix();
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

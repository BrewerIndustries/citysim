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
  roadTextures, roadCornerTextures, junctionTexture, facadeTextures, roofTexture,
  groundTexture, type FacadeKind,
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
/**
 * Which piece of road kit a tile is, decided by which neighbours it joins.
 *
 * A plain object rather than an enum: this project type-strips rather than compiles, so
 * an enum is syntax that has no runtime to erase to.
 */
const Piece = { Straight: 0, Corner: 1, Junction: 2 } as const;

/** The kinds of building that get their own facade. */
const BUILDING_KINDS: readonly FacadeKind[] = ['residential', 'commercial', 'industrial', 'civic'];

/**
 * How many trips one drawn car stands for.
 *
 * Drawing a vehicle per trip would be tens of thousands of boxes for something nobody
 * counts. This is a sampling ratio, and the honest way to say so is in the number's name:
 * one car on screen is TRIPS_PER_CAR trips in the simulation.
 */
const TRIPS_PER_CAR = 10;
/**
 * Cars per tile is capped low.
 *
 * A tile is one world unit across. Four cars on it overlap into a continuous painted
 * stripe, which reads as a car park rather than a road — the first version did exactly
 * that. Two spaced along the tile is legible, and a road that needs more than two is
 * congested, which the Traffic layer says far better than a queue of boxes could.
 */
const MAX_CARS_PER_TILE = 2;
const MAX_CARS = 40_000;
/** Tiles a car covers per second. Slow enough to read as traffic, not a screensaver. */
const CAR_SPEED = 1.6;
const CAR_COLOURS = [
  new THREE.Color('#d8dae0'), new THREE.Color('#3f4652'), new THREE.Color('#8a3f38'),
  new THREE.Color('#3f6f8a'), new THREE.Color('#6f7a4a'),
];

/** Planted tiles drawn at once. Trees are cheap but there is no point drawing a forest. */
const MAX_TREES = 90_000;
/** Canopy colours, darkest at the densest planting. */
const TREE_LIGHT = new THREE.Color('#6aa85a');
const TREE_DARK = new THREE.Color('#2f6b3a');

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
  private readonly buildingMeshes = new Map<FacadeKind, THREE.InstancedMesh>();
  /**
   * One mesh per road class, plus one for unmarked tiles.
   *
   * Instancing draws one mesh with one material, and lane markings differ per class — so
   * a single road mesh could only ever show one lane count. Five draw calls buys a road
   * network you can read the width of.
   */
  private readonly roadMeshes = new Map<number, THREE.InstancedMesh>();
  /** The quarter-turn piece per class. What makes a curve read as a curve. */
  private readonly cornerMeshes = new Map<number, THREE.InstancedMesh>();
  private junctions!: THREE.InstancedMesh;
  /** Planting. Cones, because a cone at this scale is unmistakably a tree. */
  private trees!: THREE.InstancedMesh;
  /** Traffic. Sampled from the load the simulation computed, not sprinkled on. */
  private cars!: THREE.InstancedMesh;
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
    // One mesh per KIND of building, not one for all of them. A single facade made a
    // city read as one material at three heights; housing, offices and sheds are
    // different buildings and should look it.
    const roof = new THREE.MeshLambertMaterial({ map: roofTexture() });
    const faces = facadeTextures();
    for (const kind of BUILDING_KINDS) {
      const facade = new THREE.MeshLambertMaterial({ map: faces[kind] });
      const mesh = new THREE.InstancedMesh(
        box, [facade, facade, roof, roof, facade, facade], MAX_BUILDINGS,
      );
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      // Buildings cast onto the ground and onto each other, and take shadow from their
      // neighbours — a street of towers with no shadows between them reads as a diagram.
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.buildingMeshes.set(kind, mesh);
    }

    const slab = new THREE.BoxGeometry(1, 1, 1);
    slab.translate(0, 0.5, 0);
    // Same reason: the carriageway markings belong on the surface, not wrapped down the
    // sides of an elevated deck. The sides are the concrete the deck is made of.
    const deckSide = new THREE.MeshLambertMaterial({ color: 0x6a6e78 });
    const roadMesh = (map: THREE.Texture): THREE.InstancedMesh => {
      // alphaTest, not transparency: the verges are cut out rather than blended, so there
      // is no sort order to get wrong and the shadow pass respects the cutout for free.
      const top = new THREE.MeshLambertMaterial({ map, alphaTest: 0.5 });
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
    for (const [id, tex] of roadCornerTextures()) this.cornerMeshes.set(id, roadMesh(tex));
    this.junctions = roadMesh(junctionTexture());

    // A cone on a short trunk. Cheap, and the silhouette does all the work at ¾ — the
    // giveaway that a scale model is a model is that its trees are cones.
    const canopy = new THREE.ConeGeometry(0.42, 1.1, 6);
    canopy.translate(0, 0.72, 0);
    this.trees = new THREE.InstancedMesh(
      canopy, new THREE.MeshLambertMaterial({ color: 0xffffff }), MAX_TREES,
    );
    this.trees.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.trees.count = 0;
    this.trees.frustumCulled = false;
    this.trees.castShadow = true;
    this.trees.receiveShadow = true;
    this.scene.add(this.trees);

    // Cars. Small boxes: at this camera a car is four pixels, and four pixels of the
    // right colour moving in the right direction is completely convincing.
    // A tile is one world unit, so a car has to be a fraction of one or a queue of them
    // is a solid painted line rather than traffic. Long enough to have a direction, short
    // enough that two on a tile still read as two.
    const carBox = new THREE.BoxGeometry(0.2, 0.12, 0.34);
    carBox.translate(0, 0.06, 0);
    this.cars = new THREE.InstancedMesh(
      carBox, new THREE.MeshLambertMaterial(), MAX_CARS,
    );
    this.cars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cars.count = 0;
    this.cars.frustumCulled = false;
    this.cars.castShadow = true;
    this.scene.add(this.cars);

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
      zone, density, level, road, roadClass, roadLevel, junction, trees, roadLoad,
      civic, civicAnchor, powered,
    } = snap;
    // Traffic animates against the wall clock rather than the sim tick: the simulation
    // runs at whatever speed the player chose, and cars that stop dead when the game is
    // paused look broken rather than paused.
    const now = performance.now() / 1000;
    const r = this.cam.visibleCells(aspect, this.gridW, this.gridH);
    const w = this.gridW;

    const bCounts = new Map<FacadeKind, number>();
    for (const kind of BUILDING_KINDS) bCounts.set(kind, 0);
    // One running count per road mesh, keyed the same way the meshes are.
    const counts = new Map<number, number>();
    for (const id of this.roadMeshes.keys()) counts.set(id, 0);
    const cornerCounts = new Map<number, number>();
    for (const id of this.cornerMeshes.keys()) cornerCounts.set(id, 0);
    let jn = 0;
    let tr = 0;
    let cr = 0;
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        const i = y * w + x;
        const base = this.heightAt(i);

        if (road[i]) {
          // Which PIECE this tile is, from which of its four neighbours it joins.
          //
          // The previous version asked only "does it run east-west or north-south" and
          // sent anything that was both to the unmarked junction surface. Every tile on a
          // bend has both, so every bend was drawn as an intersection — which is exactly
          // why a curve looked like a chain of crossings rather than a road. A bend with
          // exactly two perpendicular neighbours is a CORNER, and gets a piece with the
          // carriageway arcing across it.
          const lvlHere = roadLevel[i];
          const joins = (nx: number, ny: number): boolean => {
            if (nx < 0 || ny < 0 || nx >= this.gridW || ny >= this.gridH) return false;
            const n = ny * w + nx;
            return road[n] === 1 && Math.abs(roadLevel[n] - lvlHere) <= 1;
          };
          const north = joins(x, y - 1);
          const south = joins(x, y + 1);
          const west = joins(x - 1, y);
          const east = joins(x + 1, y);
          const links = (north ? 1 : 0) + (south ? 1 : 0) + (west ? 1 : 0) + (east ? 1 : 0);

          const piece = junction[i] ? Piece.Junction
            : links >= 3 ? Piece.Junction
            : (west && south) || (south && east) || (east && north) || (north && west)
              ? Piece.Corner
              : Piece.Straight;

          const mesh = piece === Piece.Junction ? this.junctions
            : piece === Piece.Corner ? this.cornerMeshes.get(roadClass[i])
            : this.roadMeshes.get(roadClass[i]);
          if (!mesh) continue;
          const slot = piece === Piece.Junction ? jn
            : piece === Piece.Corner ? (cornerCounts.get(roadClass[i]) ?? 0)
            : (counts.get(roadClass[i]) ?? 0);
          if (slot >= MAX_ROADS) continue;

          // Rotation. Rotating +90° about Y maps local -X to world +Z, so the base corner
          // (west→south) sweeps round the quadrants in that order.
          let turn = 0;
          if (piece === Piece.Corner) {
            turn = (west && south) ? 0
              : (south && east) ? Math.PI / 2
              : (east && north) ? Math.PI
              : -Math.PI / 2;
          } else if (piece === Piece.Straight) {
            turn = (north || south) && !(east || west) ? Math.PI / 2 : 0;
          }

          // A raised carriageway has to be raised HERE too, or a flyover renders lying on
          // the ground passing through the road it is supposed to bridge.
          const lift = lvlHere * DECK_HEIGHT;
          this.dummy.position.set(x * CELL, base + lift, y * CELL);
          this.dummy.rotation.y = turn;
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
          // Cars, in proportion to what this tile is actually carrying.
          const carriage = roadLoad[i];
          if (carriage > 0 && cr < MAX_CARS) {
            const n = Math.min(MAX_CARS_PER_TILE, Math.ceil(carriage / TRIPS_PER_CAR));
            // Which way traffic runs here. On a corner or a junction there is no single
            // answer, so those get the axis they lean towards rather than a wrong one.
            const alongZ = (north || south) && !(east || west) ? true
              : (east || west) && !(north || south) ? false
              : ((i >>> 3) & 1) === 1;
            for (let k = 0; k < n && cr < MAX_CARS; k++) {
              const j = ((i * 2246822519) ^ (k * 3266489917)) >>> 0;
              // Deterministic phase per car, so they do not all move in lockstep.
              const dir = (j & 1) === 0 ? 1 : -1;
              // Spaced by k as well as hashed, so two cars on one tile are never on top
              // of each other however the hash falls.
              const spacing = k / n;
              const phase = ((now * CAR_SPEED * dir + spacing + (j % 1000) / 1000) % 1 + 1) % 1;
              const along = (phase - 0.5) * CELL;
              // Half a lane off centre, on the correct side for the way they are going.
              const lane = dir * CELL * 0.16;
              this.dummy.position.set(
                x * CELL + (alongZ ? lane : along),
                base + lift + (lvlHere > 0 ? 0.14 : 0.08),
                y * CELL + (alongZ ? along : lane),
              );
              this.dummy.rotation.y = alongZ ? 0 : Math.PI / 2;
              this.dummy.scale.set(1, 1, 1);
              this.dummy.updateMatrix();
              this.dummy.rotation.y = 0;
              this.cars.setMatrixAt(cr, this.dummy.matrix);
              this.cars.setColorAt(cr, CAR_COLOURS[(j >>> 8) % CAR_COLOURS.length]);
              cr++;
            }
          }

          if (piece === Piece.Junction) jn = slot + 1;
          else if (piece === Piece.Corner) cornerCounts.set(roadClass[i], slot + 1);
          else counts.set(roadClass[i], slot + 1);
          continue;
        }

        // Planting, under everything: a tile that has grown a building has had its trees
        // cleared by the simulation already, so this never has to fight with massing.
        if (trees[i] && tr < MAX_TREES) {
          const density = trees[i] / 3;
          // Two or three per tile at full planting, offset deterministically so a planted
          // block is a wood rather than a grid of identical cones.
          const n = Math.max(1, Math.round(density * 3));
          for (let k = 0; k < n && tr < MAX_TREES; k++) {
            const j = ((i * 2654435761) ^ (k * 40503)) >>> 0;
            const ox = ((j % 1000) / 1000 - 0.5) * CELL * 0.62;
            const oz = (((j >>> 10) % 1000) / 1000 - 0.5) * CELL * 0.62;
            const scale = 0.72 + ((j >>> 20) % 1000) / 2600;
            this.dummy.position.set(x * CELL + ox, base, y * CELL + oz);
            this.dummy.rotation.y = 0;
            this.dummy.scale.set(scale, scale, scale);
            this.dummy.updateMatrix();
            this.trees.setMatrixAt(tr, this.dummy.matrix);
            this.colour.copy(TREE_LIGHT).lerp(TREE_DARK, density);
            this.trees.setColorAt(tr, this.colour);
            tr++;
          }
        }

        const civicId = civic[i];
        const lvl = level[i];
        if (!civicId && lvl === 0) continue;
        // A civic building is ONE building, not one per tile it covers. Drawing a box per
        // cell turned a 3x3 school into nine little blocks in a grid — which read as a
        // texture swatch rather than a building, and is the fastest way to lose the sense
        // of scale the whole massing pass exists to establish.
        if (civicId && !civicAnchor[i]) continue;
        const kind: FacadeKind = civicId ? 'civic'
          : zone[i] === 2 ? 'commercial'
          : zone[i] === 3 ? 'industrial'
          : 'residential';
        const mesh = this.buildingMeshes.get(kind)!;
        const b = bCounts.get(kind)!;
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
        mesh.setMatrixAt(b, this.dummy.matrix);
        mesh.setColorAt(b, this.colour);
        bCounts.set(kind, b + 1);
      }
    }

    for (const [kind, mesh] of this.buildingMeshes) {
      mesh.count = bCounts.get(kind) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    for (const [id, mesh] of this.roadMeshes) {
      mesh.count = counts.get(id) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.cars.count = cr;
    this.cars.instanceMatrix.needsUpdate = true;
    if (this.cars.instanceColor) this.cars.instanceColor.needsUpdate = true;
    this.trees.count = tr;
    this.trees.instanceMatrix.needsUpdate = true;
    if (this.trees.instanceColor) this.trees.instanceColor.needsUpdate = true;
    for (const [id, mesh] of this.cornerMeshes) {
      mesh.count = cornerCounts.get(id) ?? 0;
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

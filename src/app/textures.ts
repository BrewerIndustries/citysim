/**
 * Procedural textures for the ¾ view.
 *
 * Baked into canvases at runtime rather than shipped as image files. That is not a
 * compromise — it is the same choice the rest of the project makes. Terrain comes from a
 * seed, the manual comes from the simulation's own constants, and the colour of a
 * building comes from its definition; an art pipeline of loose PNGs would be the first
 * thing here that could silently disagree with the code it illustrates. A road's lane
 * markings are drawn FROM its lane count, so a road cannot be painted with four lanes and
 * simulated with six.
 *
 * The brief is "architectural scale model": matte, legible, realistic proportions, not
 * photoreal (docs/CAMERA-AND-ART.md). So these are surfaces with grain and marking, not
 * photographs of tarmac.
 */
import * as THREE from 'three';
import { ROAD_CLASSES, type RoadClass } from '../sim/roads.ts';

/** Texels per tile. Enough to read lane markings at full zoom, small enough to be free. */
const TILE_PX = 64;

/** Deterministic value noise, so a texture is the same every run. */
function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return ((h >>> 0) % 10000) / 10000;
}

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('2d context unavailable for texture baking');
  return { c, g };
}

/** Fine speckle over a flat fill, so a surface reads as material rather than paint. */
function grain(g: CanvasRenderingContext2D, w: number, h: number, seed: number, amount: number): void {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = (hash(x, y, seed) - 0.5) * amount;
      const i = (y * w + x) * 4;
      d[i] = Math.max(0, Math.min(255, d[i] + n));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
    }
  }
  g.putImageData(img, 0, 0);
}

function finish(c: HTMLCanvasElement, repeat = 1): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * One tile of carriageway, marked for its own lane count.
 *
 * Markings run along X; the renderer rotates the tile when the road runs the other way.
 * Lane lines are drawn from `def.lanes`, which is the number the simulation uses for
 * capacity — so what you count on the road is what the city is actually carrying.
 */
export function roadTexture(def: RoadClass): THREE.CanvasTexture {
  const { c, g } = canvas(TILE_PX, TILE_PX);
  // Asphalt, tinted a little towards the class colour so the hierarchy survives at the
  // zoom levels where individual markings stop being readable.
  g.fillStyle = def.colour;
  g.fillRect(0, 0, TILE_PX, TILE_PX);
  // Darkened towards tarmac, but only a little: a map MULTIPLIES the lit surface, so
  // anything heavy here comes back as a black road no amount of light will recover.
  g.fillStyle = 'rgba(18,19,22,0.34)';
  g.fillRect(0, 0, TILE_PX, TILE_PX);
  grain(g, TILE_PX, TILE_PX, def.id * 977, 22);

  const edge = TILE_PX * 0.085;
  // Kerb lines: what makes a tile read as a road rather than a grey square.
  g.fillStyle = 'rgba(232,236,244,0.55)';
  g.fillRect(0, edge - 1, TILE_PX, 1.5);
  g.fillRect(0, TILE_PX - edge, TILE_PX, 1.5);

  const usable = TILE_PX - edge * 2;
  const lanes = def.lanes;
  const laneW = usable / lanes;

  // Divider between the two directions of travel. A motorway gets a solid central
  // reservation rather than a painted line, because that is what eight lanes have.
  const mid = TILE_PX / 2;
  if (lanes >= 8) {
    g.fillStyle = 'rgba(210,216,226,0.85)';
    g.fillRect(0, mid - 2, TILE_PX, 4);
  } else if (lanes >= 4) {
    g.fillStyle = 'rgba(244,222,132,0.95)';
    g.fillRect(0, mid - 2.5, TILE_PX, 1.5);
    g.fillRect(0, mid + 1, TILE_PX, 1.5);
  } else {
    // Two lanes: a broken centre line.
    g.fillStyle = 'rgba(244,222,132,0.9)';
    for (let x = 0; x < TILE_PX; x += 16) g.fillRect(x, mid - 0.75, 9, 1.5);
  }

  // Lane separators within each direction, dashed as they are in life.
  g.fillStyle = 'rgba(232,236,244,0.62)';
  for (let n = 1; n < lanes; n++) {
    const y = edge + n * laneW;
    if (Math.abs(y - mid) < laneW * 0.4) continue; // that one is the centre, already drawn
    for (let x = 0; x < TILE_PX; x += 12) g.fillRect(x, y - 0.5, 6, 1);
  }

  return finish(c);
}

/**
 * Unmarked carriageway, for the tiles where markings would be nonsense: crossings,
 * roundabout rings, and the stub ends of a road that goes nowhere yet.
 */
export function junctionTexture(): THREE.CanvasTexture {
  const { c, g } = canvas(TILE_PX, TILE_PX);
  g.fillStyle = '#585d68';
  g.fillRect(0, 0, TILE_PX, TILE_PX);
  grain(g, TILE_PX, TILE_PX, 4241, 20);
  return finish(c);
}

/**
 * A facade: rows of windows.
 *
 * One texture serves every building, tinted per instance by its zone. The row pitch is
 * what sells the scale — a block with six rows of windows reads as six storeys tall
 * whatever colour it is, which is most of what makes massing legible as architecture.
 */
export function facadeTexture(): THREE.CanvasTexture {
  const size = 64;
  const { c, g } = canvas(size, size);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, size, size);

  // Few and large rather than many and small. A box is stretched to its building's
  // height, so whatever is drawn here is stretched with it — a dense grid becomes a
  // smeared mesh on anything tall, while a coarse one still reads as windows.
  const rows = 5;
  const cols = 4;
  const pitchY = size / rows;
  const pitchX = size / cols;
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      // Lit at random but deterministically, so a facade has some life without every
      // window being identical.
      const lit = hash(col, r, 7717);
      const shade = lit > 0.72 ? 'rgba(255,238,190,0.85)'
        : lit > 0.42 ? 'rgba(40,46,58,0.72)'
        : 'rgba(28,32,40,0.82)';
      g.fillStyle = shade;
      g.fillRect(col * pitchX + pitchX * 0.2, r * pitchY + pitchY * 0.18,
        pitchX * 0.6, pitchY * 0.5);
    }
  }
  // A darker band at each floor line reads as the slab between storeys.
  g.fillStyle = 'rgba(0,0,0,0.13)';
  for (let r = 0; r < rows; r++) g.fillRect(0, r * pitchY + pitchY * 0.8, size, pitchY * 0.16);
  grain(g, size, size, 3313, 12);
  return finish(c);
}

/**
 * A flat roof: gravel, with the plant and ducting a building of any size carries.
 *
 * Needed because a box textured on every face wears its windows on the roof, which is
 * the single fastest way to make massing look like a texture swatch rather than a
 * building. The ¾ camera looks DOWN, so the roof is the face you see most.
 */
export function roofTexture(): THREE.CanvasTexture {
  const size = 64;
  const { c, g } = canvas(size, size);
  g.fillStyle = '#d8d4cc';
  g.fillRect(0, 0, size, size);
  grain(g, size, size, 5501, 30);
  // A parapet round the edge, and a couple of roof boxes: enough to break the flatness.
  g.strokeStyle = 'rgba(90,92,96,0.55)';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, size - 3, size - 3);
  g.fillStyle = 'rgba(96,98,104,0.45)';
  g.fillRect(size * 0.18, size * 0.2, size * 0.22, size * 0.16);
  g.fillRect(size * 0.58, size * 0.56, size * 0.26, size * 0.2);
  return finish(c);
}

/** Ground grain, so open land is a surface rather than a flat fill. */
export function groundTexture(): THREE.CanvasTexture {
  const size = 128;
  const { c, g } = canvas(size, size);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, size, size);
  // Broad mottling first, then fine speckle: one gives the ground shape at a distance,
  // the other keeps it from looking like plastic close up.
  for (let n = 0; n < 900; n++) {
    const x = hash(n, 1, 61) * size;
    const y = hash(n, 2, 61) * size;
    const r = 2 + hash(n, 3, 61) * 7;
    // Very light touch. This map multiplies the terrain's own colour, so mottling that
    // looks pleasant on white turns open country to mud on green.
    const a = 0.015 + hash(n, 4, 61) * 0.025;
    g.fillStyle = hash(n, 5, 61) > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  grain(g, size, size, 991, 9);
  return finish(c);
}

/** Every road class's texture, built once and shared. */
export function roadTextures(): Map<number, THREE.CanvasTexture> {
  return new Map(ROAD_CLASSES.map((c) => [c.id, roadTexture(c)]));
}

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
/**
 * Verge either side of the carriageway, as a fraction of the tile, left transparent.
 *
 * Wide enough that a bend visibly curves, narrow enough that a straight road still looks
 * like a road rather than a footpath. This is the number that turns a grid of squares
 * into a network of ribbons.
 */
const VERGE = 0.11;

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
  // The verges are left TRANSPARENT so the carriageway is a ribbon rather than a square.
  // This is what lets a bend have a curved silhouette: with the tile filled edge to edge,
  // the markings can sweep round the corner all they like and the road's OUTLINE is still
  // a staircase. Cut out by alphaTest in the material, not blending, so it costs nothing
  // and shadows respect it.
  const edge = TILE_PX * VERGE;
  // Asphalt, tinted a little towards the class colour so the hierarchy survives at the
  // zoom levels where individual markings stop being readable.
  g.fillStyle = def.colour;
  g.fillRect(0, edge, TILE_PX, TILE_PX - edge * 2);
  // Darkened towards tarmac, but only a little: a map MULTIPLIES the lit surface, so
  // anything heavy here comes back as a black road no amount of light will recover.
  g.fillStyle = 'rgba(18,19,22,0.34)';
  g.fillRect(0, edge, TILE_PX, TILE_PX - edge * 2);
  grain(g, TILE_PX, TILE_PX, def.id * 977, 22);
  // Kerb lines: what makes a tile read as a road rather than a grey square.
  g.fillStyle = 'rgba(232,236,244,0.55)';
  g.fillRect(0, edge, TILE_PX, 1.5);
  g.fillRect(0, TILE_PX - edge - 1.5, TILE_PX, 1.5);

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
 * A quarter turn: the carriageway sweeping from one edge to the next.
 *
 * This is what makes a curve look curved. A tile grid can only put road cells on a
 * staircase, but a bend does not have to be DRAWN as a square — a corner piece with the
 * carriageway arcing across it turns the staircase into a road that flows, which is how
 * every tile-based city builder has done it since the nineties.
 *
 * The base piece connects the WEST edge to the SOUTH edge; the renderer rotates it to
 * the other three quadrants.
 */
export function roadCornerTexture(def: RoadClass): THREE.CanvasTexture {
  const { c, g } = canvas(TILE_PX, TILE_PX);
  // The turn is centred on the corner the two edges share, so the arc meets each edge at
  // its midpoint — exactly where a straight piece's carriageway meets it.
  const cx = 0;
  const cy = TILE_PX;
  const mid = TILE_PX / 2;
  const halfWidth = mid - TILE_PX * VERGE;
  const arc = (radius: number, style: string, width: number, dash: number[] = []) => {
    g.strokeStyle = style;
    g.lineWidth = width;
    g.setLineDash(dash);
    g.beginPath();
    g.arc(cx, cy, radius, -Math.PI / 2, 0);
    g.stroke();
    g.setLineDash([]);
  };

  // The carriageway itself, as one thick arc. Everything outside it stays transparent,
  // so the bend's silhouette is a curve rather than the corner of a square.
  arc(mid, def.colour, halfWidth * 2);
  arc(mid, 'rgba(18,19,22,0.34)', halfWidth * 2);
  grain(g, TILE_PX, TILE_PX, def.id * 977 + 13, 22);

  // Kerbs on the inside and outside of the bend.
  arc(mid - halfWidth + 0.75, 'rgba(232,236,244,0.55)', 1.5);
  arc(mid + halfWidth - 0.75, 'rgba(232,236,244,0.55)', 1.5);

  const lanes = def.lanes;
  if (lanes >= 8) {
    arc(mid, 'rgba(210,216,226,0.85)', 4);
  } else if (lanes >= 4) {
    arc(mid - 1.75, 'rgba(244,222,132,0.95)', 1.5);
    arc(mid + 1.75, 'rgba(244,222,132,0.95)', 1.5);
  } else {
    arc(mid, 'rgba(244,222,132,0.9)', 1.5, [9, 7]);
  }

  // Lane separators, dashed, following the bend rather than crossing it.
  const laneW = (halfWidth * 2) / lanes;
  for (let n = 1; n < lanes; n++) {
    const radius = mid - halfWidth + n * laneW;
    if (Math.abs(radius - mid) < laneW * 0.4) continue;
    arc(radius, 'rgba(232,236,244,0.62)', 1, [6, 6]);
  }

  return finish(c);
}

/**
 * Unmarked carriageway, for the tiles where markings would be nonsense: crossings,
 * roundabout rings, and the stub ends of a road that goes nowhere yet.
 */
export function junctionTexture(): THREE.CanvasTexture {
  const { c, g } = canvas(TILE_PX, TILE_PX);
  // Full square, unlike the pieces: a crossing really does pave its whole cell, and a
  // junction with verges cut out of it would leave holes where the roads meet.
  g.fillStyle = '#585d68';
  g.fillRect(0, 0, TILE_PX, TILE_PX);
  grain(g, TILE_PX, TILE_PX, 4241, 20);
  return finish(c);
}

/**
 * Facades, by what the building is for.
 *
 * One texture for everything made a city read as a single material at three heights.
 * These are the differences you actually notice from a ¾ camera: how big the windows are,
 * how many floors they imply, and how much solid wall sits between them.
 *
 *  - Housing has small windows, lots of wall, and few floors per storey of massing.
 *  - Commerce is glass: wide bands, thin spandrels, and the lit windows that make an
 *    office block read as an office block at dusk.
 *  - Industry is mostly wall — a few high strip windows, roller doors at the base, and
 *    the vertical ribs of clad sheet metal.
 *
 * Each is white-based so the zone's own colour still comes through instanceColor.
 */
export type FacadeKind = 'residential' | 'commercial' | 'industrial' | 'civic';

function facadeFor(kind: FacadeKind): THREE.CanvasTexture {
  const size = 64;
  const { c, g } = canvas(size, size);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, size, size);

  if (kind === 'industrial') {
    // Clad sheet: vertical ribs, a strip of high windows, and roller doors at the base.
    g.fillStyle = 'rgba(0,0,0,0.07)';
    for (let x = 0; x < size; x += 5) g.fillRect(x, 0, 2, size);
    g.fillStyle = 'rgba(150,178,196,0.7)';
    g.fillRect(0, size * 0.16, size, size * 0.1);
    g.fillStyle = 'rgba(0,0,0,0.13)';
    for (let x = 4; x < size; x += 12) g.fillRect(x, size * 0.16, 2, size * 0.1);
    g.fillStyle = 'rgba(40,44,52,0.5)';
    for (let x = 6; x < size; x += 22) g.fillRect(x, size * 0.62, size * 0.2, size * 0.38);
    grain(g, size, size, 8123, 14);
    return finish(c);
  }

  const rows = kind === 'commercial' ? 7 : 4;
  const cols = kind === 'commercial' ? 5 : 3;
  const pitchY = size / rows;
  const pitchX = size / cols;
  // Commerce is glass — the window nearly fills its bay. Housing keeps its brick.
  const wFrac = kind === 'commercial' ? 0.82 : 0.5;
  const hFrac = kind === 'commercial' ? 0.6 : 0.42;

  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const lit = hash(col, r, kind === 'commercial' ? 4409 : 7717);
      // Offices burn late; houses mostly do not.
      const litLimit = kind === 'commercial' ? 0.55 : 0.82;
      const shade = lit > litLimit ? 'rgba(255,238,190,0.85)'
        : lit > 0.4 ? 'rgba(42,52,66,0.72)'
        : 'rgba(26,32,42,0.84)';
      g.fillStyle = shade;
      g.fillRect(
        col * pitchX + pitchX * ((1 - wFrac) / 2),
        r * pitchY + pitchY * 0.18,
        pitchX * wFrac, pitchY * hFrac,
      );
    }
  }
  // The slab between storeys. Heavier on housing, where the wall does the work.
  g.fillStyle = kind === 'commercial' ? 'rgba(0,0,0,0.08)' : 'rgba(0,0,0,0.15)';
  for (let r = 0; r < rows; r++) g.fillRect(0, r * pitchY + pitchY * 0.78, size, pitchY * 0.18);
  grain(g, size, size, kind === 'commercial' ? 3313 : 5711, 12);
  return finish(c);
}

/** One facade per kind, built once and shared. */
export function facadeTextures(): Record<FacadeKind, THREE.CanvasTexture> {
  return {
    residential: facadeFor('residential'),
    commercial: facadeFor('commercial'),
    industrial: facadeFor('industrial'),
    civic: facadeFor('residential'),
  };
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

/** Every road class's straight piece, built once and shared. */
export function roadTextures(): Map<number, THREE.CanvasTexture> {
  return new Map(ROAD_CLASSES.map((c) => [c.id, roadTexture(c)]));
}

/** And every class's quarter turn. */
export function roadCornerTextures(): Map<number, THREE.CanvasTexture> {
  return new Map(ROAD_CLASSES.map((c) => [c.id, roadCornerTexture(c)]));
}

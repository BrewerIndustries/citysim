/**
 * Junctions: the places where roads meet, as things you place rather than things that
 * happen where two lines cross.
 *
 * A crossroads on a tile grid is just two roads sharing a cell, and that is fine for a
 * pair of streets. It stops being fine when the corridor matters: the whole reason
 * roundabouts and grade separation exist is that a signalled crossroads is where a road's
 * capacity goes to die. So a junction here is not decoration — it raises the throughput
 * of the tiles it occupies, which is exactly what it does in life, and it is the answer
 * when the Traffic layer shows a corridor jamming at its intersections rather than along
 * its length.
 *
 * Shapes are held as offsets from the anchor rather than drawn, so the same data lays the
 * junction, prices it, previews it under the cursor and draws the diagram in the manual.
 * A shape and a picture of that shape that are maintained separately will disagree.
 */

export interface Junction {
  id: number;
  key: string;
  label: string;
  /** Footprint edge, in cells. */
  size: number;
  /** Road cells, as [dx, dy] from the top-left of the footprint. */
  cells: ReadonlyArray<readonly [number, number]>;
  /**
   * How high each cell sits, if the junction is not all on the ground. A crossover is
   * grade-separated by definition: one carriageway goes over the other, which on a tile
   * grid is exactly what levels are for.
   */
  levelAt?: (dx: number, dy: number, size: number) => number;
  /**
   * Multiplier on the capacity of every tile it occupies. This is the whole point of
   * building one: the junction is worth more than the tiles it is made of.
   */
  throughput: number;
  /** Charged on top of the road tiles themselves — the engineering, not the tarmac. */
  premium: number;
  note: string;
}

/**
 * A hollow ring of road `size` across: the roundabout.
 *
 * Drawn as a circle rather than a square, then REPAIRED into a 4-connected loop. That
 * second step is not optional. A rasterised circle turns corners diagonally, and every
 * search in the game — road distance, the utility flood, the traffic relaxation — walks
 * orthogonally, so a diagonally-jointed ring is not one ring, it is four arcs nothing can
 * drive between. The first version of this cut the corners off a square to look rounder
 * and produced exactly that.
 *
 * The repair inserts the shared orthogonal neighbour of any diagonal pair, choosing
 * whichever of the two sits closest to the ring's radius so the loop stays round instead
 * of growing a bulge.
 */
function ring(size: number): Array<readonly [number, number]> {
  const c = (size - 1) / 2;
  const r = c;
  const dist = (x: number, y: number) => Math.hypot(x - c, y - c);
  const inRing = new Set<string>();
  const key = (x: number, y: number) => `${x},${y}`;

  // A band around the radius, wide enough to be a continuous circle at this scale.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = dist(x, y);
      if (d <= r + 0.45 && d >= r - 0.95) inRing.add(key(x, y));
    }
  }

  // Repair: every diagonal step needs an orthogonal cell to go through.
  for (const cell of [...inRing]) {
    const [x, y] = cell.split(',').map(Number);
    for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inRing.has(key(nx, ny))) continue;
      if (inRing.has(key(nx, y)) || inRing.has(key(x, ny))) continue;
      const a: readonly [number, number] = [nx, y];
      const b: readonly [number, number] = [x, ny];
      const pick = Math.abs(dist(a[0], a[1]) - r) <= Math.abs(dist(b[0], b[1]) - r) ? a : b;
      inRing.add(key(pick[0], pick[1]));
    }
  }

  return [...inRing].map((k) => k.split(',').map(Number) as [number, number]);
}

/**
 * A dual-carriageway crossing: two lanes each way, meeting in a square.
 *
 * The first attempt put both carriageways on the centre line, where they collapsed into
 * one, and hung the slip roads off the corners where nothing touched them. A junction
 * whose cells are not 4-connected is not a junction — the road network search would walk
 * straight past half of it.
 */
function crossover(size: number): Array<readonly [number, number]> {
  const mid = (size - 1) / 2;
  const lo = Math.floor(mid) - 1;
  const hi = Math.ceil(mid) + 1;
  const cells = new Set<string>();
  for (let n = 0; n < size; n++) {
    cells.add(`${n},${lo}`); cells.add(`${n},${hi}`);
    cells.add(`${lo},${n}`); cells.add(`${hi},${n}`);
  }
  return [...cells].map((c) => c.split(',').map(Number) as [number, number]);
}

export const JUNCTIONS: readonly Junction[] = [
  { id: 1, key: 'roundabout', label: 'Roundabout', size: 7, cells: ring(7),
    throughput: 1.4, premium: 340,
    note: 'Keeps traffic moving through a crossing instead of stopping it' },
  { id: 2, key: 'crossover', label: 'Crossover', size: 7, cells: crossover(7),
    throughput: 1.9, premium: 1400,
    // The north-south carriageways ride two levels up, so they cross the east-west ones
    // rather than joining them — a real interchange rather than a wide crossroads. Two
    // levels, not one, because that is the clearance a road needs to pass underneath.
    levelAt: (dx, dy, size) => {
      const mid = (size - 1) / 2;
      const onEastWest = dy === mid - 1 || dy === mid + 1;
      return onEastWest ? 0 : 2;
    },
    note: 'Grade-separated: north-south rides over east-west. The answer to a jammed arterial' },
];

export const JUNCTION_BY_ID = new Map(JUNCTIONS.map((j) => [j.id, j]));
export const JUNCTION_BY_KEY = new Map(JUNCTIONS.map((j) => [j.key, j]));

/**
 * Throughput by junction id, as a flat array.
 *
 * The traffic relaxation asks this four times per road tile per pass, three passes a
 * recompute. A Map lookup is fine anywhere else and is the wrong shape here; index 0 is
 * "no junction", so the common case is an array read of 1.
 */
const THROUGHPUT: number[] = (() => {
  const max = Math.max(0, ...JUNCTIONS.map((j) => j.id));
  const out = new Array<number>(max + 1).fill(1);
  for (const j of JUNCTIONS) out[j.id] = j.throughput;
  return out;
})();

/** How much the junction on this tile multiplies its capacity. 1 where there is none. */
export function throughputOf(junction: number): number {
  return THROUGHPUT[junction] ?? 1;
}

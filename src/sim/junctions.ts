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
   * Multiplier on the capacity of every tile it occupies. This is the whole point of
   * building one: the junction is worth more than the tiles it is made of.
   */
  throughput: number;
  /** Charged on top of the road tiles themselves — the engineering, not the tarmac. */
  premium: number;
  note: string;
}

/**
 * A hollow ring of road `size` across: the roundabout, at tile scale.
 *
 * The corners stay. Cutting them makes a rounder-looking ring and a broken one — the
 * cells either side of a cut corner meet only diagonally, so the "roundabout" is four
 * disconnected arcs that no network search will ever walk between. On a square grid a
 * ring you can drive round is a square ring; what makes it a roundabout is the
 * throughput, not the silhouette.
 */
function ring(size: number): Array<readonly [number, number]> {
  const cells: Array<readonly [number, number]> = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (x === 0 || y === 0 || x === size - 1 || y === size - 1) cells.push([x, y]);
    }
  }
  return cells;
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
  { id: 1, key: 'roundabout', label: 'Roundabout', size: 5, cells: ring(5),
    throughput: 1.4, premium: 260,
    note: 'Keeps traffic moving through a crossing instead of stopping it' },
  { id: 2, key: 'crossover', label: 'Crossover', size: 7, cells: crossover(7),
    throughput: 1.9, premium: 1400,
    note: 'Grade-separated. Expensive, and the only thing that saves a jammed arterial' },
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

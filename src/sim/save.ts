/**
 * Save format.
 *
 * Binary, explicit and versioned rather than "JSON of whatever objects exist today" —
 * docs/TECH-STACK.md calls a stable save format part of the portability insurance, and
 * a commercial release means someone's 40-hour city has to survive an update.
 *
 * Only AUTHORED state is stored. Every field (pollution, land value, coverage…) is
 * derived from tiles, so saving them would triple the file for data the simulation
 * regenerates in a dozen ticks. Tile planes are run-length encoded, which is enormously
 * effective here because most of a map is untouched.
 */
import { City } from './city.ts';
import { Tiles } from './tiles.ts';
import { DEFAULT_ROAD_CLASS } from './roads.ts';
import { DISASTERS } from './disasters.ts';
import { ACHIEVEMENTS } from './achievements.ts';

const MAGIC = 0x4354534d; // "CTSM"
const END_MAGIC = 0x454e4421; // "END!"
export const SAVE_VERSION = 10;

/** Planes written to disk, in order. Derived planes are deliberately absent. */
const PLANES: Array<keyof Tiles & string> = [
  'zone', 'density', 'road', 'level', 'civic', 'civicAnchor', 'distress',
];
/** Added in v6. Written after the original planes so v5 files still read cleanly. */
const PLANES_V6: Array<keyof Tiles & string> = ['powerLine', 'pipe'];
/** Added in v7. Appended for the same reason: older files still read cleanly. */
const PLANES_V7: Array<keyof Tiles & string> = ['sewer'];
/** Added in v9, when a road stopped being one thing. */
const PLANES_V9: Array<keyof Tiles & string> = ['roadClass'];
/** Added in v10, with junctions. Absent in older saves simply means none were built. */
const PLANES_V10: Array<keyof Tiles & string> = ['junction'];

/** Ticks of field simulation run after loading, to regenerate the derived state. */
export const SETTLE_TICKS = 14;

/**
 * Low 32 civic ids as a bitmask, for the word every version since v3 has written.
 *
 * The set outgrew one word when the world works were added, which the round-trip test
 * caught as "civic id 32 does not fit the save bitmask". Rather than add a second word
 * and buy another 32 ids, v8 writes the overflow as a counted list, which has no next
 * ceiling to hit. Ids that still fit stay in the mask so older saves keep loading
 * through the same path.
 */
function bitmaskOf(ids: Set<number>): number {
  let mask = 0;
  for (const id of ids) if (id >= 0 && id < 32) mask |= 1 << id;
  return mask >>> 0;
}

/** The ids a single word cannot hold. Written after the mask from v8 on. */
function overflowIds(ids: Set<number>): number[] {
  const out: number[] = [];
  for (const id of ids) if (id >= 32) out.push(id);
  return out.sort((a, b) => a - b);
}

function setFromBitmask(mask: number): Set<number> {
  const out = new Set<number>();
  for (let id = 0; id < 32; id++) if (mask & (1 << id)) out.add(id);
  return out;
}

class Writer {
  private buf = new Uint8Array(1024);
  private view = new DataView(this.buf.buffer);
  private pos = 0;

  private need(n: number): void {
    if (this.pos + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.pos + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf);
    this.buf = next;
    this.view = new DataView(this.buf.buffer);
  }

  u8(v: number) { this.need(1); this.view.setUint8(this.pos, v); this.pos += 1; }
  u16(v: number) { this.need(2); this.view.setUint16(this.pos, v); this.pos += 2; }
  u32(v: number) { this.need(4); this.view.setUint32(this.pos, v); this.pos += 4; }
  f64(v: number) { this.need(8); this.view.setFloat64(this.pos, v); this.pos += 8; }
  bytes(): Uint8Array { return this.buf.slice(0, this.pos); }
}

class Reader {
  private view: DataView;
  private pos = 0;
  constructor(bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  u8() { const v = this.view.getUint8(this.pos); this.pos += 1; return v; }
  u16() { const v = this.view.getUint16(this.pos); this.pos += 2; return v; }
  u32() { const v = this.view.getUint32(this.pos); this.pos += 4; return v; }
  f64() { const v = this.view.getFloat64(this.pos); this.pos += 8; return v; }
  get done() { return this.pos >= this.view.byteLength; }
}

/** Run-length encode a byte plane as (value, count) pairs with a 16-bit count. */
function writePlane(w: Writer, plane: Uint8Array): void {
  let runs = 0;
  const counts: Array<[number, number]> = [];
  let value = plane[0];
  let run = 1;
  for (let i = 1; i < plane.length; i++) {
    if (plane[i] === value && run < 0xffff) { run++; continue; }
    counts.push([value, run]);
    runs++;
    value = plane[i];
    run = 1;
  }
  counts.push([value, run]);
  runs++;
  w.u32(runs);
  for (const [v, n] of counts) { w.u8(v); w.u16(n); }
}

function readPlane(r: Reader, plane: Uint8Array): void {
  const runs = r.u32();
  let i = 0;
  for (let k = 0; k < runs; k++) {
    const v = r.u8();
    const n = r.u16();
    if (i + n > plane.length) throw new Error('corrupt save: run overflows the plane');
    plane.fill(v, i, i + n);
    i += n;
  }
  if (i !== plane.length) throw new Error('corrupt save: planes are the wrong size');
}

export function serialize(city: City): Uint8Array {
  const w = new Writer();
  w.u32(MAGIC);
  w.u16(SAVE_VERSION);
  w.u16(city.grid.width);
  // Terrain is generated, not authored, so only its seed is stored — that's the
  // difference between a ~1KB save and a 70KB one.
  w.u32(city.mapSeed);
  w.f64(city.funds);
  w.u8(city.tax.r); w.u8(city.tax.c); w.u8(city.tax.i);
  w.u8(city.month);
  w.u16(city.year);
  w.u32(city.tick);
  w.u8(DISASTERS.length);
  for (const d of DISASTERS) {
    w.u8(city.disasters[d.key] ? 1 : 0);
    w.u32(city.disasterCounts[d.key] ?? 0);
  }
  w.u32(city.tilesLostToDisaster);
  // Achievements are stored as INDICES INTO A STABLE ID LIST, resolved back by id on
  // load. Storing bit positions would silently re-award or revoke achievements the
  // first time the list is reordered.
  const earned = ACHIEVEMENTS.map((a, n) => (city.earned.has(a.id) ? n : -1)).filter((n) => n >= 0);
  w.u16(earned.length);
  for (const n of earned) w.u16(n);
  w.u8(city.wasBankrupt ? 1 : 0);
  w.u16(Math.min(0xffff, city.consecutiveSurplusMonths));
  // Demand must be stored, not re-derived. The constructor seeds optimistic starting
  // demand, and a loaded city that ran one tick on those defaults got a growth surge
  // it hadn't earned.
  w.f64(city.demand.r); w.f64(city.demand.c); w.f64(city.demand.i);
  // Progression. Peak population is stored because unlocks are earned, not held: a
  // city that shrinks keeps what it reached.
  w.u32(city.peakPopulation);
  w.u32(bitmaskOf(city.everBuilt));
  const overflow = overflowIds(city.everBuilt);
  w.u16(overflow.length);
  for (const id of overflow) w.u16(id);
  for (const name of PLANES) writePlane(w, city.tiles[name] as Uint8Array);
  for (const name of PLANES_V6) writePlane(w, city.tiles[name] as Uint8Array);
  for (const name of PLANES_V7) writePlane(w, city.tiles[name] as Uint8Array);
  for (const name of PLANES_V9) writePlane(w, city.tiles[name] as Uint8Array);
  for (const name of PLANES_V10) writePlane(w, city.tiles[name] as Uint8Array);
  // Sentinel. If the reader and writer ever fall out of step, this fails with "reader
  // and writer disagree" instead of a misleading complaint about corrupt tile planes —
  // which is exactly how the achievements block was first noticed to be misplaced.
  w.u32(END_MAGIC);
  return w.bytes();
}

/**
 * Before v6 the roads themselves carried power. Lay a line under every road so a city
 * built under the old rule keeps its lights on.
 *
 * Water is deliberately NOT back-filled. It is a new requirement, and the Why Panel will
 * say "no water" — something the player can see and fix in a minute — rather than
 * creating a silent second class of city that never needed it.
 */
export function backfillLegacyPower(tiles: Tiles): void {
  const { road, powerLine } = tiles;
  for (let i = 0; i < road.length; i++) if (road[i]) powerLine[i] = 1;
}

export interface LoadResult {
  city: City;
  version: number;
}

export function deserialize(bytes: Uint8Array): LoadResult {
  const r = new Reader(bytes);
  if (r.u32() !== MAGIC) throw new Error('not a citysim save');
  const version = r.u16();
  if (version > SAVE_VERSION) {
    throw new Error(`save is from a newer version (${version} > ${SAVE_VERSION})`);
  }
  const size = r.u16();
  // v1 saves predate terrain; they load onto the default map.
  const mapSeed = version >= 2 ? r.u32() : 1;
  const city = new City(size, 1, mapSeed);
  city.funds = r.f64();
  city.tax = { r: r.u8(), c: r.u8(), i: r.u8() };
  city.month = r.u8();
  city.year = r.u16();
  city.setTick(r.u32());
  if (version >= 4) {
    // Written with a count so adding a disaster later doesn't invalidate old saves.
    const n = r.u8();
    for (let k = 0; k < n; k++) {
      const def = DISASTERS[k];
      const on = r.u8() === 1;
      const count = r.u32();
      if (def) { city.disasters[def.key] = on; city.disasterCounts[def.key] = count; }
    }
    city.tilesLostToDisaster = r.u32();
  } else {
    // v1-v3 only knew about fire.
    city.disasters.fire = r.u8() === 1;
    city.disasterCounts.fire = r.u32();
    city.tilesLostToDisaster = r.u32();
  }
  if (version >= 5) {
    const n = r.u16();
    for (let k = 0; k < n; k++) {
      const a = ACHIEVEMENTS[r.u16()];
      if (a) city.earned.add(a.id);
    }
    city.wasBankrupt = r.u8() === 1;
    city.consecutiveSurplusMonths = r.u16();
  }

  city.demand = { r: r.f64(), c: r.f64(), i: r.f64() };
  if (version >= 3) {
    city.peakPopulation = r.u32();
    city.everBuilt = setFromBitmask(r.u32());
    if (version >= 8) {
      const n = r.u16();
      for (let k = 0; k < n; k++) city.everBuilt.add(r.u16());
    }
  }
  for (const name of PLANES) readPlane(r, city.tiles[name] as Uint8Array);
  if (version >= 6) {
    for (const name of PLANES_V6) readPlane(r, city.tiles[name] as Uint8Array);
  } else {
    backfillLegacyPower(city.tiles);
  }
  if (version >= 7) {
    for (const name of PLANES_V7) readPlane(r, city.tiles[name] as Uint8Array);
  }
  // Order here must match the writer exactly, appended block by appended block. Reading
  // v10 before v9 is the same mistake the END sentinel was added to catch, and it caught
  // it again.
  if (version >= 9) {
    for (const name of PLANES_V9) readPlane(r, city.tiles[name] as Uint8Array);
    if (version >= 10) {
      for (const name of PLANES_V10) readPlane(r, city.tiles[name] as Uint8Array);
    }
  } else {
    // Every road in an older save was a two-lane street, because that was the only kind
    // there was. Left at 0 they would have no class, and a road with no class has no
    // frontage — a loaded city would silently lose all its road access.
    const { road, roadClass } = city.tiles;
    for (let i = 0; i < road.length; i++) if (road[i]) roadClass[i] = DEFAULT_ROAD_CLASS;
  }
  // Sewers are NOT back-filled for older saves. Nothing is destroyed by their absence —
  // buildings simply stop at septic level and start to smell, which the Why Panel says
  // plainly and the player can fix by laying a network.
  if (version >= 5 && r.u32() !== END_MAGIC) {
    throw new Error('corrupt save: reader and writer disagree about the layout');
  }

  // Derived state is not stored; regenerate it before handing the city back, so the
  // player doesn't watch their city flicker through a few ticks of wrong values.
  city.markRoadsDirty();
  city.markCivicsDirty();
  city.markUtilitiesDirty();
  city.settleFields(SETTLE_TICKS);
  // v1/v2 saves predate progression: infer it from what's standing so an old city
  // doesn't lose access to buildings it already had.
  if (version < 3) {
    city.peakPopulation = city.stats.population;
    for (let i = 0; i < city.tiles.civic.length; i++) {
      if (city.tiles.civicAnchor[i]) city.everBuilt.add(city.tiles.civic[i]);
    }
  }
  city.refreshUnlocks();
  return { city, version };
}

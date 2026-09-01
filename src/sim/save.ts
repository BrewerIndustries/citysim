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

const MAGIC = 0x4354534d; // "CTSM"
export const SAVE_VERSION = 2;

/** Planes written to disk, in order. Derived planes are deliberately absent. */
const PLANES: Array<keyof Tiles & string> = [
  'zone', 'density', 'road', 'level', 'civic', 'civicAnchor', 'distress',
];

/** Ticks of field simulation run after loading, to regenerate the derived state. */
export const SETTLE_TICKS = 14;

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
  w.u8(city.firesEnabled ? 1 : 0);
  w.u32(city.firesTotal);
  w.u32(city.tilesLostToFire);
  // Demand must be stored, not re-derived. The constructor seeds optimistic starting
  // demand, and a loaded city that ran one tick on those defaults got a growth surge
  // it hadn't earned.
  w.f64(city.demand.r); w.f64(city.demand.c); w.f64(city.demand.i);
  for (const name of PLANES) writePlane(w, city.tiles[name] as Uint8Array);
  return w.bytes();
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
  city.firesEnabled = r.u8() === 1;
  city.firesTotal = r.u32();
  city.tilesLostToFire = r.u32();
  city.demand = { r: r.f64(), c: r.f64(), i: r.f64() };
  for (const name of PLANES) readPlane(r, city.tiles[name] as Uint8Array);

  // Derived state is not stored; regenerate it before handing the city back, so the
  // player doesn't watch their city flicker through a few ticks of wrong values.
  city.markRoadsDirty();
  city.markCivicsDirty();
  city.settleFields(SETTLE_TICKS);
  return { city, version };
}

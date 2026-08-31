/**
 * The city grid. Cells are 8m square (see docs/TECH-STACK.md scaling ladder).
 * Width/height are powers of two so index math is shift/mask, and so the grid
 * divides evenly into chunks.
 */
export const CELL_METRES = 8;

/** Chunk edge in cells. 32x32 = 1024 cells, a good dirty-tracking granularity. */
export const CHUNK_SIZE = 32;
export const CHUNK_SHIFT = 5;

export class Grid {
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly shift: number;
  readonly chunksX: number;
  readonly chunksY: number;
  readonly chunkCount: number;

  constructor(width: number, height: number) {
    if ((width & (width - 1)) !== 0) throw new Error(`width ${width} must be a power of two`);
    if (width % CHUNK_SIZE !== 0 || height % CHUNK_SIZE !== 0) {
      throw new Error(`grid ${width}x${height} must divide into ${CHUNK_SIZE}-cell chunks`);
    }
    this.width = width;
    this.height = height;
    this.size = width * height;
    this.shift = Math.log2(width);
    this.chunksX = width / CHUNK_SIZE;
    this.chunksY = height / CHUNK_SIZE;
    this.chunkCount = this.chunksX * this.chunksY;
  }

  index(x: number, y: number): number {
    return (y << this.shift) + x;
  }

  xOf(i: number): number {
    return i & (this.width - 1);
  }

  yOf(i: number): number {
    return i >>> this.shift;
  }

  chunkOf(x: number, y: number): number {
    return (y >>> CHUNK_SHIFT) * this.chunksX + (x >>> CHUNK_SHIFT);
  }

  /** Land area in square kilometres. */
  areaKm2(): number {
    return (this.size * CELL_METRES * CELL_METRES) / 1_000_000;
  }

  toString(): string {
    return `${this.width}x${this.height} (${this.size.toLocaleString()} cells, ${this.areaKm2().toFixed(1)} km2)`;
  }
}

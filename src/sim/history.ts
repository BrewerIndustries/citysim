/**
 * Undo/redo.
 *
 * Records the authored state of every tile an action touched, so undo is a restore
 * rather than an inverse-operation replay — inverses are easy to get subtly wrong
 * (bulldozing a civic clears a whole footprint; a road overwrites zoning) and a wrong
 * inverse silently corrupts a city.
 *
 * A whole drag stroke is one undo step. Dragging a road across fifty tiles and then
 * having to press undo fifty times would be worse than no undo at all.
 */
import type { Tiles } from './tiles.ts';

/** Authored planes only — derived state (powered, roadDist) is recomputed. */
/**
 * The planes undo captures. This must list every plane a TOOL can write; anything
 * missing is silently un-undoable — the money comes back and the tile does not. The
 * utility planes were missing from the day they were added, so laying a pipe and
 * pressing undo refunded you and left the pipe. Derived planes (powered, watered,
 * sewered, roadDist) are deliberately absent: they are recomputed after a restore.
 */
const PLANES = [
  'zone', 'density', 'road', 'powerLine', 'pipe', 'sewer',
  'level', 'civic', 'civicAnchor', 'distress',
] as const;
const PLANE_COUNT = PLANES.length;

export interface Command {
  label: string;
  cells: Int32Array;
  before: Uint8Array;
  after: Uint8Array;
  fundsBefore: number;
  fundsAfter: number;
}

export const MAX_UNDO = 120;

export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];

  private strokeId: string | null = null;
  private label = '';
  private touched = new Map<number, number>(); // cell -> index into `pending`
  private pending: number[] = [];
  private fundsAtStart = 0;

  get canUndo(): boolean { return this.undoStack.length > 0 || this.touched.size > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  get undoLabel(): string {
    if (this.touched.size > 0) return this.label;
    return this.undoStack[this.undoStack.length - 1]?.label ?? '';
  }
  get redoLabel(): string { return this.redoStack[this.redoStack.length - 1]?.label ?? ''; }
  get depth(): number { return this.undoStack.length + (this.touched.size > 0 ? 1 : 0); }

  /** Start (or continue) a stroke. Strokes with the same id merge into one step. */
  begin(tiles: Tiles, strokeId: string, label: string, funds: number): void {
    if (this.strokeId === strokeId) return;
    this.commit(tiles, funds);
    this.strokeId = strokeId;
    this.label = label;
    this.fundsAtStart = funds;
  }

  /** Record a tile's state before it is modified. Repeat touches are ignored. */
  touch(tiles: Tiles, i: number): void {
    if (this.strokeId === null || this.touched.has(i)) return;
    this.touched.set(i, this.pending.length);
    for (const p of PLANES) this.pending.push(tiles[p][i]);
  }

  /** Close the open stroke and push it onto the undo stack. */
  commit(tiles: Tiles, funds: number): void {
    if (this.touched.size === 0) { this.strokeId = null; return; }

    const cells = new Int32Array(this.touched.size);
    const before = new Uint8Array(this.touched.size * PLANE_COUNT);
    const after = new Uint8Array(this.touched.size * PLANE_COUNT);
    let n = 0;
    for (const [cell, offset] of this.touched) {
      cells[n] = cell;
      for (let p = 0; p < PLANE_COUNT; p++) {
        before[n * PLANE_COUNT + p] = this.pending[offset + p];
        after[n * PLANE_COUNT + p] = tiles[PLANES[p]][cell];
      }
      n++;
    }

    // A stroke that changed nothing (dragging over land you already zoned) must not
    // land on the stack, or undo appears to do nothing.
    let changed = false;
    for (let k = 0; k < before.length; k++) {
      if (before[k] !== after[k]) { changed = true; break; }
    }

    if (changed || funds !== this.fundsAtStart) {
      this.undoStack.push({
        label: this.label, cells, before, after,
        fundsBefore: this.fundsAtStart, fundsAfter: funds,
      });
      if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
      this.redoStack.length = 0;
    }

    this.touched.clear();
    this.pending.length = 0;
    this.strokeId = null;
  }

  undo(tiles: Tiles, funds: number): { funds: number; label: string } | null {
    this.commit(tiles, funds);
    const cmd = this.undoStack.pop();
    if (!cmd) return null;
    restore(tiles, cmd.cells, cmd.before);
    this.redoStack.push(cmd);
    return { funds: cmd.fundsBefore, label: cmd.label };
  }

  redo(tiles: Tiles, funds: number): { funds: number; label: string } | null {
    this.commit(tiles, funds);
    const cmd = this.redoStack.pop();
    if (!cmd) return null;
    restore(tiles, cmd.cells, cmd.after);
    this.undoStack.push(cmd);
    return { funds: cmd.fundsAfter, label: cmd.label };
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.touched.clear();
    this.pending.length = 0;
    this.strokeId = null;
  }
}

function restore(tiles: Tiles, cells: Int32Array, state: Uint8Array): void {
  for (let n = 0; n < cells.length; n++) {
    for (let p = 0; p < PLANE_COUNT; p++) {
      tiles[PLANES[p]][cells[n]] = state[n * PLANE_COUNT + p];
    }
  }
}

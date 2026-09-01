/**
 * Save slots in localStorage.
 *
 * The worker owns the City and produces the bytes, but Workers cannot touch
 * localStorage — so serialisation happens there and persistence happens here.
 *
 * Every access is wrapped: storage throws outright in a private window or when a
 * browser is set to block site data, and losing a save is not a reason to take the
 * game down with it.
 */
const PREFIX = 'citysim.save.';
const META = 'citysim.meta.';

export interface SlotMeta {
  population: number;
  month: number;
  year: number;
  savedAt: number;
  bytes: number;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000; // avoid blowing the argument limit on large saves
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function writeSlot(slot: string, bytes: Uint8Array, meta: Omit<SlotMeta, 'savedAt' | 'bytes'>): string | null {
  try {
    localStorage.setItem(PREFIX + slot, toBase64(bytes));
    localStorage.setItem(META + slot, JSON.stringify({ ...meta, savedAt: Date.now(), bytes: bytes.length }));
    return null;
  } catch (err) {
    const e = err as Error;
    return e.name === 'QuotaExceededError'
      ? 'Not enough browser storage for this save.'
      : `Could not save: ${e.message}`;
  }
}

export function readSlot(slot: string): Uint8Array | null {
  try {
    const s = localStorage.getItem(PREFIX + slot);
    return s ? fromBase64(s) : null;
  } catch {
    return null;
  }
}

export function readMeta(slot: string): SlotMeta | null {
  try {
    const s = localStorage.getItem(META + slot);
    return s ? (JSON.parse(s) as SlotMeta) : null;
  } catch {
    return null;
  }
}

export function clearSlot(slot: string): void {
  try {
    localStorage.removeItem(PREFIX + slot);
    localStorage.removeItem(META + slot);
  } catch { /* nothing to do */ }
}

export function describeSlot(slot: string): string {
  const m = readMeta(slot);
  if (!m) return 'empty';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${m.population.toLocaleString()} people · ${months[m.month]} ${m.year} · ${(m.bytes / 1024).toFixed(0)} KB`;
}

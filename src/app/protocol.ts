/** Messages between the UI and the simulation worker. */
import type { Demand } from '../sim/demand.ts';
import type { GrowthStats } from '../sim/growth.ts';
import type { UtilityReport } from '../sim/utility.ts';
import type { Ledger } from '../sim/city.ts';
import type { SeriesData } from '../sim/history-series.ts';

export interface Snapshot {
  type: 'frame';
  tick: number;
  month: number;
  year: number;
  funds: number;
  demand: Demand;
  stats: GrowthStats;
  power: UtilityReport;
  water: UtilityReport;
  sewage: UtilityReport;
  traffic: import('../sim/traffic.ts').TrafficReport;
  waste: import('../sim/waste.ts').WasteReport;
  ledger: Ledger;
  tax: { r: number; c: number; i: number };
  messages: string[];
  simMs: number;
  disasters: Record<string, boolean>;
  disasterCounts: Record<string, number>;
  tilesLostToDisaster: number;
  earned: string[];
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string;
  redoLabel: string;
  /** Present only on the frame a month rolls over — it's 600 points x 6 series. */
  series: SeriesData | null;
  unlocked: number[];
  lockReasons: Record<number, string>;
  peakPopulation: number;
  zone: Uint8Array;
  density: Uint8Array;
  road: Uint8Array;
  roadClass: Uint8Array;
  junction: Uint8Array;
  powerLine: Uint8Array;
  pipe: Uint8Array;
  sewer: Uint8Array;
  watered: Uint8Array;
  sewered: Uint8Array;
  level: Uint8Array;
  civic: Uint8Array;
  powered: Uint8Array;
  /**
  * The field planes for the currently selected data layers, in selection order, and
  * their names. Several may be shown at once (see palette.ts MAX_LAYERS); network and
  * terrain layers are drawn from data the client already holds and never appear here.
  */
  layers: Float32Array[];
  layerNames: string[];
}

export interface ReadyMsg {
  type: 'ready';
  width: number;
  height: number;
  /** Terrain never changes during play, so it's sent once rather than every frame. */
  water: Uint8Array;
  shore: Uint8Array;
  terrainHeight: Uint8Array;
  floodRisk: Uint8Array;
  waterTable: Uint8Array;
}

export interface InspectMsg {
  type: 'inspect';
  cell: ReturnType<import('../sim/city.ts').City['inspect']>;
}

export interface SavedMsg { type: 'saved'; slot: string; bytes: Uint8Array }
export interface NoticeMsg { type: 'notice'; text: string; error?: boolean }

export type FromWorker = Snapshot | ReadyMsg | InspectMsg | SavedMsg | NoticeMsg;

export type ToWorker =
  | { type: 'init'; size: number; seed: number }
  | { type: 'speed'; stepsPerSecond: number }
  | { type: 'layers'; layers: string[] }
  | { type: 'inspect'; index: number }
  | { type: 'tax'; tax: { r: number; c: number; i: number } }
  | { type: 'options'; disasters: Record<string, boolean> }
  | { type: 'save'; slot: string }
  | { type: 'load'; slot: string; bytes: Uint8Array }
  | { type: 'new'; size: number; seed: number; mapSeed: number }
  | { type: 'act'; action: Action; strokeId: string; label: string }
  | { type: 'endstroke' }
  | { type: 'undo' }
  | { type: 'redo' };

export type Action =
  | { kind: 'road'; cells: number[]; roadClass: number }
  | { kind: 'junction'; cell: number; junction: number; roadClass: number }
  | { kind: 'remove'; cells: number[]; target: import('../sim/city.ts').RemoveTarget }
  | { kind: 'utility'; cells: number[]; utility: 'powerLine' | 'pipe' | 'sewer' }
  | { kind: 'zone'; cells: number[]; zone: number; density: number }
  | { kind: 'civic'; cell: number; civicId: number }
  | { kind: 'bulldoze'; cells: number[] };

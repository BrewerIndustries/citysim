/** Messages between the UI and the simulation worker. */
import type { Demand } from '../sim/demand.ts';
import type { GrowthStats } from '../sim/growth.ts';
import type { PowerReport } from '../sim/power.ts';
import type { Ledger } from '../sim/city.ts';

export interface Snapshot {
  type: 'frame';
  tick: number;
  month: number;
  year: number;
  funds: number;
  demand: Demand;
  stats: GrowthStats;
  power: PowerReport;
  ledger: Ledger;
  tax: { r: number; c: number; i: number };
  messages: string[];
  simMs: number;
  zone: Uint8Array;
  density: Uint8Array;
  road: Uint8Array;
  level: Uint8Array;
  civic: Uint8Array;
  powered: Uint8Array;
  layer: Float32Array | null;
  layerName: string | null;
}

export interface ReadyMsg {
  type: 'ready';
  width: number;
  height: number;
}

export interface InspectMsg {
  type: 'inspect';
  cell: ReturnType<import('../sim/city.ts').City['inspect']>;
}

export type FromWorker = Snapshot | ReadyMsg | InspectMsg;

export type ToWorker =
  | { type: 'init'; size: number; seed: number }
  | { type: 'speed'; stepsPerSecond: number }
  | { type: 'layer'; layer: string | null }
  | { type: 'inspect'; index: number }
  | { type: 'tax'; tax: { r: number; c: number; i: number } }
  | { type: 'act'; action: Action };

export type Action =
  | { kind: 'road'; cells: number[] }
  | { kind: 'zone'; cells: number[]; zone: number; density: number }
  | { kind: 'civic'; cell: number; civicId: number }
  | { kind: 'bulldoze'; cells: number[] };

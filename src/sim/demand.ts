/**
 * RCI demand.
 *
 * A balance model, not a market simulation: residents want jobs, businesses want
 * customers, industry wants workers and sells outward. Each demand is the gap between
 * what the city has and what its current population/job mix implies it should have,
 * damped by tax rates.
 *
 * Kept deliberately simple and readable — every term is something the Why Panel and the
 * RCI meter can name. Supply chains are an S2 conversation (OPEN-QUESTIONS D2).
 */
export interface Census {
  population: number;
  jobsC: number;
  jobsI: number;
  residentialCapacity: number;
  commercialCapacity: number;
  industrialCapacity: number;
}

export interface Demand {
  r: number;
  c: number;
  i: number;
}

/** Jobs the city wants per resident, split between commerce and industry. */
const JOBS_PER_RESIDENT_C = 0.22;
const JOBS_PER_RESIDENT_I = 0.18;
/** Residents the city can support per available job. */
const RESIDENTS_PER_JOB = 2.4;

/** Tax rate at which demand is unaffected; above this it bites, below it stimulates. */
export const NEUTRAL_TAX = 9;

export function computeDemand(census: Census, tax: { r: number; c: number; i: number }): Demand {
  const { population, jobsC, jobsI } = census;

  // Seed demand so an empty city has somewhere to start.
  const seed = population < 60 ? 0.55 : 0;

  const wantedResidents = (jobsC + jobsI) * RESIDENTS_PER_JOB + 40;
  const wantedJobsC = population * JOBS_PER_RESIDENT_C;
  const wantedJobsI = population * JOBS_PER_RESIDENT_I + 25;

  const r = normalise(wantedResidents - population, Math.max(120, population * 0.5)) + seed;
  const c = normalise(wantedJobsC - jobsC, Math.max(40, jobsC * 0.6 + 30)) + seed * 0.6;
  const i = normalise(wantedJobsI - jobsI, Math.max(40, jobsI * 0.6 + 30)) + seed * 0.8;

  return {
    r: clamp(r - taxPenalty(tax.r)),
    c: clamp(c - taxPenalty(tax.c)),
    i: clamp(i - taxPenalty(tax.i)),
  };
}

function taxPenalty(rate: number): number {
  // Gentle below neutral, sharp above it: 20% tax should genuinely stall growth.
  const d = rate - NEUTRAL_TAX;
  return d <= 0 ? d * 0.02 : (d / 10) ** 1.6;
}

function normalise(gap: number, scale: number): number {
  return Math.max(-1, Math.min(1, gap / scale));
}

function clamp(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

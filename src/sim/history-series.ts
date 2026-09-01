/**
 * Monthly time series.
 *
 * SimCity's graphs were a big part of how players understood their city, and
 * docs/FEATURES.md lists them in the S0 slice. Samples are taken once a month rather
 * than per tick: a tick is a simulation detail, a month is the unit the player thinks in.
 */
export const SERIES = [
  { key: 'population', label: 'Population', colour: '#6cb46f' },
  { key: 'jobs', label: 'Jobs', colour: '#5a9ed0' },
  { key: 'funds', label: 'Funds', colour: '#c8a45a' },
  { key: 'net', label: 'Net / month', colour: '#b06fc8' },
  { key: 'landValue', label: 'Avg land value', colour: '#6ec8bd' },
  { key: 'pollution', label: 'Avg pollution', colour: '#d9705f' },
] as const;

export type SeriesKey = (typeof SERIES)[number]['key'];

/** Months retained. 600 is 50 years, longer than any realistic session. */
export const HISTORY_LIMIT = 600;

export type SeriesData = Record<SeriesKey, number[]>;

export function emptySeries(): SeriesData {
  return {
    population: [], jobs: [], funds: [], net: [], landValue: [], pollution: [],
  };
}

export function pushSample(data: SeriesData, sample: Record<SeriesKey, number>): void {
  for (const s of SERIES) {
    const arr = data[s.key];
    arr.push(sample[s.key]);
    if (arr.length > HISTORY_LIMIT) arr.shift();
  }
}

import type { City } from '../src/sim/city.ts';
import { CIVIC_BY_KEY } from '../src/sim/tiles.ts';

/**
 * Lay utilities the way a competent player would: a line and a pipe under every road,
 * and a pump beside the network.
 *
 * Before utilities existed, roads carried power and water was not modelled, so every
 * test city was implicitly serviced. Now it has to be done on purpose — which is the
 * point of the feature, but it means the fixtures have to do it too.
 *
 * This only BUILDS. It must never step the simulation: a fixture that quietly advances
 * time breaks any test that checks the state a city starts in.
 */
export function wireUtilities(c: City): void {
  const { road, powerLine, pipe } = c.tiles;
  const funds = c.funds;
  c.funds = Number.MAX_SAFE_INTEGER;

  for (let i = 0; i < road.length; i++) {
    if (!road[i]) continue;
    if (!powerLine[i]) c.buildUtility(i, 'powerLine');
    if (!pipe[i]) c.buildUtility(i, 'pipe');
  }

  // A pump immediately below a piped road, so the road's pipe touches its footprint.
  const pump = CIVIC_BY_KEY.get('pump')!;
  const w = c.grid.width;
  for (let i = 0; i < road.length; i++) {
    if (!pipe[i]) continue;
    const x = i & (w - 1);
    const y = i >>> c.grid.shift;
    if (y + 1 + pump.size >= c.grid.height || x + pump.size >= w) continue;
    if (c.placeCivic(c.grid.index(x, y + 1), pump.id).ok) break;
  }

  c.funds = funds;
}

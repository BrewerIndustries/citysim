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
export function wireUtilities(
  c: City, opts: { sewers?: boolean; refuse?: boolean } = {},
): void {
  const withSewers = opts.sewers ?? true;
  const withRefuse = opts.refuse ?? true;
  const { road, powerLine, pipe } = c.tiles;
  const funds = c.funds;
  c.funds = Number.MAX_SAFE_INTEGER;

  for (let i = 0; i < road.length; i++) {
    if (!road[i]) continue;
    if (!powerLine[i]) c.buildUtility(i, 'powerLine');
    if (!pipe[i]) c.buildUtility(i, 'pipe');
  }

  // Sewers cannot share a tile with the water main, so they run one row over — which is
  // exactly the routing problem the rule creates for a player.
  const w = c.grid.width;
  for (let i = 0; withSewers && i < road.length; i++) {
    if (!road[i]) continue;
    const x = i & (w - 1);
    const y = i >>> c.grid.shift;
    for (const j of [y + 1 < c.grid.height ? c.grid.index(x, y + 1) : -1,
                     y > 0 ? c.grid.index(x, y - 1) : -1]) {
      if (j >= 0 && c.buildUtility(j, 'sewer')) break;
    }
  }

  // A pump immediately below a piped road, so the road's pipe touches its footprint.
  const pump = CIVIC_BY_KEY.get('pump')!;
  for (let i = 0; i < road.length; i++) {
    if (!pipe[i]) continue;
    const x = i & (w - 1);
    const y = i >>> c.grid.shift;
    if (y + 1 + pump.size >= c.grid.height || x + pump.size >= w) continue;
    if (c.placeCivic(c.grid.index(x, y + 1), pump.id).ok) {
      // A pump needs power like anything else; the line under the road beside it
      // reaches its footprint.
      break;
    }
  }

  // Somewhere for the sewage to go — at the FAR END of the network, which is where a
  // player would put it. Dropping a raw outflow in the middle of the housing is a
  // choice the game punishes, and a fixture should not make it by accident.
  const outflow = CIVIC_BY_KEY.get('sewage')!;
  const { sewer } = c.tiles;
  for (let i = sewer.length - 1; withSewers && i >= 0; i--) {
    if (!sewer[i]) continue;
    const x = i & (w - 1);
    const y = i >>> c.grid.shift;
    if (y + 1 + outflow.size >= c.grid.height || x + outflow.size >= w) continue;
    if (c.placeCivic(c.grid.index(x, y + 1), outflow.id).ok) break;
  }

  // Somewhere for the refuse to go. Without one a fixture city stalls the moment it
  // outgrows the informal allowance, which silently turns every growth test into a
  // refuse test.
  if (withRefuse) {
    const landfill = CIVIC_BY_KEY.get('landfill')!;
    const { powerLine } = c.tiles;
    for (let i = powerLine.length - 1; i >= 0; i--) {
      if (!powerLine[i]) continue;
      const x = i & (w - 1);
      const y = i >>> c.grid.shift;
      if (y + 1 + landfill.size >= c.grid.height || x + landfill.size >= w) continue;
      // Below a powered line, so it is connected — a landfill with no power takes nothing.
      if (c.placeCivic(c.grid.index(x, y + 1), landfill.id).ok) break;
    }
  }

  c.funds = funds;
}

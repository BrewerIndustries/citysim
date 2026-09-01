/**
 * Road network: a multi-source BFS from every road cell producing a distance field.
 *
 * Road access is the single hardest requirement in the game — nothing develops without
 * it — so it needs to be a NUMBER the Why Panel can quote ("nearest road 6 cells away,
 * needs 3"), not a boolean buried in a loop.
 *
 * Only recomputed when roads change, not every tick.
 */
import type { Grid } from './grid.ts';
import type { Tiles } from './tiles.ts';

/** A cell must be within this many cells of a road to develop. */
export const ROAD_REACH = 3;

export function recomputeRoadDistance(grid: Grid, tiles: Tiles, queue: Int32Array): void {
  const { width, height } = grid;
  const dist = tiles.roadDist;
  const road = tiles.road;
  dist.fill(255);

  let head = 0;
  let tail = 0;
  for (let i = 0; i < road.length; i++) {
    if (road[i]) {
      dist[i] = 0;
      queue[tail++] = i;
    }
  }

  while (head < tail) {
    const i = queue[head++];
    const d = dist[i];
    if (d >= ROAD_REACH) continue;
    const x = i & (width - 1);
    const y = i >>> grid.shift;
    if (x > 0 && dist[i - 1] > d + 1) { dist[i - 1] = d + 1; queue[tail++] = i - 1; }
    if (x < width - 1 && dist[i + 1] > d + 1) { dist[i + 1] = d + 1; queue[tail++] = i + 1; }
    if (y > 0 && dist[i - width] > d + 1) { dist[i - width] = d + 1; queue[tail++] = i - width; }
    if (y < height - 1 && dist[i + width] > d + 1) { dist[i + width] = d + 1; queue[tail++] = i + width; }
  }
}

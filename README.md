# citysim *(working title)*

A SimCity-spirit city builder. **Playable** — see **How to play** below.

## The one-paragraph pitch

The depth of SimCity 4, with the thing SimCity 4 never had: a game that tells you **why**.
Field-based simulation (honest, O(tiles), scales), aggregate traffic that's actually
teachable, and a UI where data layers, a plain-language diagnosis panel, and a procedural
newspaper are core features rather than polish. Rendered as an architectural scale model
under an orthographic camera, with a real top-down Plan Mode for when you're building and
a ¾ view for when you're looking. Offline, single-player, no DRM, no timers.

## Docs

| Doc | What's in it |
|---|---|
| [RESEARCH.md](docs/RESEARCH.md) | Every SimCity version + the successors, what shipped, what people loved and hated, with sources |
| [FEATURES.md](docs/FEATURES.md) | Feature list in build order (S0 vertical slice → S1 shippable → S2+), plus the traffic and performance rules |
| [DO-NOT-DO.md](docs/DO-NOT-DO.md) | 18 anti-goals, each tied to a documented failure in a real game |
| [CAMERA-AND-ART.md](docs/CAMERA-AND-ART.md) | Perspective analysis (top-down vs iso vs 3D vs hybrid) and art direction |
| [SIMULATION-MODEL.md](docs/SIMULATION-MODEL.md) | Field-based vs agent-based explained, and the three-layer hybrid we're building |
| [TECH-STACK.md](docs/TECH-STACK.md) | Why Steam over web, Electron over Tauri, and the tiered scaling ladder |
| [OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md) | ~30 questions to answer before building, each with a recommended default |
| [TWO-INSTANCES.md](docs/TWO-INSTANCES.md) | Running a play instance and a dev instance side by side |

## Decided

- **Intent:** a commercial release. Steam is the product; a free, size-capped browser build
  is the demo and the funnel.
- **Stack:** TypeScript + three.js, simulation in a Web Worker over typed arrays. Shipped
  to Steam via **Electron** (bundled Chromium) — not Tauri, whose OS-webview approach only
  supports WebGPU behind an experimental flag and renders differently per platform.
- **Simulation:** field-based, three layers — fields as the truth, aggregate flow
  assignment for traffic, sampled agents as honestly-labelled visualization plus a few
  hundred genuinely persistent citizens.
- **Scale:** tiered. Tier 1 (512², 200k pop, 60fps) is the ship gate; Tier 2 (1024², ~1M)
  must stay reachable; Tier 3 "metropolis mode" (2048², ~268km², multi-million) may degrade
  to 30fps but must never stall. Ship Tier 1, never foreclose Tier 3.

## Recommended, not yet confirmed (see OPEN-QUESTIONS.md)

- **Perspective:** 3D geometry under an *orthographic* camera at a ¾ tilt with snapping
  rotation, plus a Tab-toggled top-down schematic Plan Mode. One renderer, two modes.
- **Art:** architectural scale model — matte materials, heavy ambient occlusion, semantic
  palette by land use, modular kit-of-parts buildings. Realistic proportions, not
  photoreal surfaces.
- **Next:** a kit-of-parts building pipeline to replace the ¾ view's massing blocks.

## How to play

```bash
npm install
npm run dev
```

Serves on every interface, so it's reachable from other machines too:

| | |
|---|---|
| This Mac | `http://localhost:5173` |
| LAN | `http://192.168.68.100:5173` |
| Tailscale | `http://100.73.182.27:5173` |

(The LAN address is DHCP-assigned and can change; `npm run dev` prints the current
Network URLs on startup.)

1. **Plop a coal power plant** ($2,200), then run **power lines** from it out along your
   streets. Roads carry traffic, not electricity — the wires are yours to lay.
2. **Draw roads** — drag to lay a line. Every plot must be within 3 tiles of one.
3. **Run water and sewer** — a pump beside open water (or over an aquifer) feeds **pipes**;
   a sewage outflow or treatment works drains **sewers**. Pipes and sewers may each share
   a street with a road, and may *cross* each other on a single tile, but neither can run
   alongside the other. Everything needs power, including the pump. Low-density housing gets by on septic; anything taller needs a sewer.
4. **Zone** residential, commercial and industrial beside the roads. Watch the RCI meter
   in the top bar for what the city actually wants.
5. **Add services** — police suppresses crime, fire stations cut fire risk, parks, schools
   and transit raise land value. They all cost upkeep every month, so watch the budget.
6. **Use Inspect** on any tile to find out exactly why it is or isn't growing.

Press **`?`** for the in-game manual — every tool, zone and building explained, including a
to-scale diagram of how far a road reaches and how far apart to space streets.

Keys: `1`–`9` tools · `[` `]` speed · `P` pause · scroll to zoom · right-drag or
space-drag to pan.

### What's in the S0 slice

- **Simulation core** — 26 field planes, struct-of-arrays over one `ArrayBuffer`, zero
  allocation per tick. Separable double box blur giving linear falloff to zero at 2r,
  amplitude-restored and normalised onto a shared 0–255 scale.
- **Gameplay** — zoning at three densities, road network with a distance field, power
  distribution, development and abandonment, RCI demand, taxes, and a monthly ledger.
- **The Why Panel** — click any tile: *"Desirability 12, needs 16 to reach level 2"*, plus
  an attributed land-value breakdown. The terms are exported from the simulation itself
  (`LAND_VALUE_TERMS`) and pinned by a test, so the explanation cannot drift from the
  behaviour.
- **21 data layers** over the city, with infrastructure kept legible underneath. **Combine**
  shows up to four at once: one layer is drawn in its own dark-to-bright ramp, several are
  drawn in identity colours with each cell taking whichever layer is strongest there. That
  turns "how much crime is here" into "is it crime or pollution holding this district
  back", and lets all three utility networks be checked in a single view.
- **In-game manual** (`?`) whose every figure is read from the simulation constants rather
  than written out in prose, and pinned by tests — a manual that quotes hardcoded numbers
  goes quietly wrong the first time a constant is tuned.
- **Transit** — bus stops and metro stations feeding transit access, the second-strongest
  positive term in land value.
- **Fire** — risk driven by building size and lack of fire cover, with ignition and spread.
  Visible as a data layer so exposure is legible *before* anything burns, and switchable off.
- **Undo/redo** (`Cmd/Ctrl+Z`), grouped so a whole drag is one step, restoring money as
  well as tiles.
- **Save/load** in a versioned binary format, with an autosave that resumes on reload.
  A played city serialises to about a kilobyte.
- **History graph** — monthly series for population, jobs, funds, net, land value and
  pollution, each scaled to its own range.
- **Terrain** — every new city gets a generated map with rivers and lakes. Water can't be
  built on, and the waterfront is an amenity, so the coastline shapes where the city wants
  to grow. Stored as a seed, not a height map, which keeps saves at ~1 KB.
- **Progression** — seven power plants and five service upgrades that unlock as the city
  earns them, measured against peak population and buildings ever built. The energy ladder
  is a real trade-off at every rung: coal is cheap and filthy, wind is spotless but tiny,
  and the clean and dirty branches both have to be walked to reach fusion.
- **Dirty-chunk simulation** — a field is only recomputed where its source changed, which
  is sound because every diffused field is a pure function of its source. A test runs the
  incremental path and a full recompute side by side and asserts they agree bit for bit.
- **Disasters** — fire, floods, earthquakes and tornadoes, each switchable on its own.
  Flood risk is fixed by the terrain and shown as a data layer, so it is genuinely
  avoidable: build uphill and you will never flood.
- **Utility networks** — power, water and sewage are three networks you build, not side
  effects of paving. Each has its own layer view showing the conductor, the land it
  reaches, and in red whatever it is failing to serve. Pipes and sewers can run under a
  road, and can cross each other at an intersection, but never run alongside each other —
  the two have to be routed as separate systems that meet only where they must.
  Pumps and sewage works need open water beside them or a workable water table beneath,
  which the terrain decides — and they need power of their own, so a brownout takes the
  water supply with it. A source that isn't wired to anything says so by name rather than
  quietly counting toward a supply total it can't deliver.
- **Sewage and its consequences** — low-density housing runs on septic and pollutes
  modestly; above that a sewer connection is mandatory. The cheap way out is an outflow
  pipe dumping raw sewage into open water, which is filthy and strips the waterfront
  amenity from every shore tile within 12 — the coastline you built the city for stops
  being worth anything. A treatment works at 9,000 people does the same job cleanly for
  six times the price.
- **Environmental cleanup** — pollution is repairable, not permanent. A cleanup station
  (6,000 people) and a reclamation works (18,000) project remediation over the land and
  pull the pollution field back down, so a district ruined by early industry can be
  reclaimed rather than written off.
- **Remove** — the careful counterpart to the bulldozer, taking up roads, power lines,
  pipes and sewers while leaving zoning and buildings alone. Clears everything on a tile
  by default; a target row narrows it to one network when you need to pull a sewer out
  from under a street you are keeping.
- **Draw modes** — free-hand, line, or rectangle. Roads default to lines, zoning to
  rectangles; nothing is built until the drag ends, so the shape can be adjusted first.
- **Two views over one simulation** (`Tab`) — the top-down Plan Mode you build in, and an
  orthographic ¾ view with real terrain and rotation. Buildings are untextured massing
  blocks: the camera and proportions get judged before any art is made.
- **Achievements** — 24 of them across growth, economy, infrastructure, environment and
  adversity. Press `A`. Locked ones show what they need, because one you can't see isn't
  something you can aim at.
- **Benchmark harness** — synthetic city generator for any tier, written before any
  content, wired into CI as a **gate** rather than a report.

```bash
npm test          # 166 tests
npm run bench     # Tier 1 + Tier 2 simulation benchmark
```

### Measured (M1 Pro, per 100 ms tick budget)

Now measuring the whole of `City.step()`, not diffusion alone. With dirty-region tracking
a single number would be dishonest — the cost depends entirely on how much is changing.

| | Grid | Filling in | Mature city | |
|---|---|---|---|---|
| Tier 1 | 512² | 7.2 ms | 2.0 ms | ✅ ship gate, 13.9× headroom |
| Tier 2 | 1024² | 72 ms | 10.6 ms | ✅ |
| Tier 3 | 2048² | 261 ms | 118 ms | ⚠️ graceful degradation, not a stall |

Tier 3 came down from 942 ms. A mature 19-million-person metropolis across 268 km² runs at
about 8 ticks/sec instead of 10 — the degradation the tier allows. A city still filling in
across the whole map costs more, because when half the map changes at once you have to
recompute half the map.

## Status

**Building.** The architectural blockers are settled (intent, stack, scale, simulation
model). No schedule and no effort estimates — slices are ordered by dependency and it's
done when it's done. Remaining questions in
[OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md) get answered when they block something.

Repo: private, `dev` is the default branch, `main` via PR only.
CI runs typecheck + tests + build + the Tier 1 benchmark gate on every push.
GitHub Pages is **disabled** — a private repo on the free plan can't use it — so the web
demo goes out through itch.io instead. Re-enable the push trigger in
`.github/workflows/pages.yml` if the repo goes public or the account upgrades.

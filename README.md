# citysim *(working title)*

A SimCity-spirit city builder. Planning phase — no code yet.

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
| [FEATURES.md](docs/FEATURES.md) | Tiered feature list (M0 vertical slice → M1 shippable → M2+), plus the traffic and performance rules |
| [DO-NOT-DO.md](docs/DO-NOT-DO.md) | 18 anti-goals, each tied to a documented failure in a real game |
| [CAMERA-AND-ART.md](docs/CAMERA-AND-ART.md) | Perspective analysis (top-down vs iso vs 3D vs hybrid) and art direction |
| [SIMULATION-MODEL.md](docs/SIMULATION-MODEL.md) | Field-based vs agent-based explained, and the three-layer hybrid we're building |
| [TECH-STACK.md](docs/TECH-STACK.md) | Why Steam over web, Electron over Tauri, and the tiered scaling ladder |
| [OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md) | ~30 questions to answer before building, each with a recommended default |

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
- **First milestone:** one city tile, one hour of play, the Why Panel working, three data
  layers, zoning that grows and abandons for reasons you can read on screen.

## Status

Planning. Four of the five blockers are answered (intent, stack, scale, simulation model).
The last one is **F1 — how much time per week**, which sets whether M0 is six weeks or six
months. Everything else in [OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md) can be decided later
without rework.

Local git on `dev`, no remote yet.

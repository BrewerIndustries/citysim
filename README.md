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
| [OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md) | ~30 questions to answer before building, each with a recommended default |

## Current recommendations (all still open — see OPEN-QUESTIONS.md)

- **Perspective:** 3D geometry under an *orthographic* camera at a ¾ tilt with snapping
  rotation, plus a Tab-toggled top-down schematic Plan Mode. One renderer, two modes.
- **Art:** architectural scale model — matte materials, heavy ambient occlusion, semantic
  palette by land use, modular kit-of-parts buildings. Realistic proportions, not
  photoreal surfaces.
- **Simulation:** field-based (SimCity 1/4 lineage), *not* agent-based. Traffic as
  aggregate flow assignment, with visible cars as an honestly-labelled visualization.
- **Stack:** TypeScript + three.js, sim in a Web Worker, deployed on the existing
  GitHub Pages + Cloudflare pattern. Godot 4 is the fallback if desktop/Steam matters.
- **First milestone:** one city tile, one hour of play, the Why Panel working, three data
  layers, zoning that grows and abandons for reasons you can read on screen.

## Status

Planning. Next step is answering the **[BLOCKER]** questions in
[OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md) — intent, engine/platform, target city size,
field-vs-agent, and available time. Everything else can be decided later without rework.

# Open Questions

Everything I need answered to turn the plan into a build. Each has **my default** — if you
just say "defaults are fine," I can start from this document without another pass.

The ones marked **[BLOCKER]** change the architecture. Answer those first; the rest can
be decided later without rework.

> **Answered 2026-08-31:** A1 (commercial release intended), B1 (TS + three.js),
> B2 (tiered targets, Tier 3 metropolis headroom), D1 (field-based confirmed).
> Consequences written up in [TECH-STACK.md](TECH-STACK.md) and
> [SIMULATION-MODEL.md](SIMULATION-MODEL.md). Still open: everything else.

---

## A. Intent & audience

**A1. [BLOCKER] What is this, honestly?** — ✅ **ANSWERED: commercial release intended.**
Built in vertical slices, each independently playable, but aimed at an actual paid release
on Steam rather than a toy. This raises the bar on save-format stability, performance
budgets, and mod support — all now reflected in TECH-STACK.md.
*Still to decide later: price point, Early Access or not, and demo strategy.*

**A2. Who's the player?**
(a) You. (b) Lapsed SimCity 4 players who want the depth without the opacity. (c) People
who bounced off Cities: Skylines' traffic. (d) A broad casual audience.
*Default: (b) primarily, with (a) as the honest driver. Depth-first, with the diagnosis
layer that makes depth learnable.*

**A3. Is this a *remake* or a *successor*?**
Remake = recognizable SimCity structure, modernized. Successor = take the lessons and go
somewhere new (see A4).
*Default: successor in mechanics, remake in feel.*

**A4. Any setting twist, or straight contemporary city?**
Every recent success in the genre has an angle (Frostpunk's cold, Timberborn's water,
Terra Nil's ecology). "Modern city, done right" is a valid angle *if* the angle is
"honest simulation + it explains itself."
*Default: straight contemporary city; the differentiator is legibility and the newspaper,
not the setting.*

**A5. What's the fantasy — mayor, planner, or god?**
Are you a politician managing constituents (Tropico), a planner solving a system
(OpenTTD), or an unopposed builder (Cities: Skylines)?
*Default: planner primarily, with a light political layer (advisors, petitions,
approval) that constrains rather than gates.*

---

## B. Technology

**B1. [BLOCKER] Engine and platform.**
Three realistic paths given your existing pipeline:

| Path | Pros | Cons |
|---|---|---|
| **TypeScript + WebGL (three.js), sim in a Web Worker** | Deploys straight onto your existing GitHub Pages + Cloudflare pipeline like sinkhole/jarvis-junction/droidex; zero install; instant sharing | Perf ceiling lower; large-city targets need WASM eventually; no Steam without a wrapper |
| **Godot 4** | Free, good 3D, real desktop builds, Steam-ready, GDScript is fast to iterate in | New pipeline for you; not web-native (Godot web export is workable but not great for this) |
| **Unity / Bevy / custom** | Ceiling | Cost or effort out of proportion to the project |

✅ **ANSWERED: TypeScript + three.js**, orthographic renderer, simulation in a Web Worker
over typed arrays. Web is the development and demo target (deployed to
`citysim.dabrewer.dev` on your existing Pages pattern); **Steam is the commercial target**,
reached by wrapping the same codebase in **Electron** — bundled Chromium, not Tauri's OS
webview, because Tauri only supports WebGPU behind an experimental flag and renders
differently per platform. Full reasoning in [TECH-STACK.md](TECH-STACK.md).

*Consequence: the simulation must stay a pure typed-array module with no browser
dependencies, so the host can be ported later if we ever hit a ceiling.*

**B2. [BLOCKER] What's the target city size and target hardware?** — ✅ **ANSWERED: tiered.**
- **Tier 1 (M1 ship gate):** 512² tiles (~16km²), 200k pop, 60fps + 10 ticks/s on a
  mid-range 2023 laptop.
- **Tier 2 (must remain reachable):** 1024² (~67km²), ~1M pop, same framerate.
- **Tier 3 ("metropolis mode"):** 2048² (~268km² — ~2.5× Paris), multi-million pop,
  30fps acceptable, graceful sim slowdown but never a stall.

Ship Tier 1; never make a decision that forecloses Tier 3. Synthetic benchmark for all
three tiers written *before* content and run in CI. See [TECH-STACK.md](TECH-STACK.md)
for where this actually breaks first (tick budget and the OD matrix, not memory).

**B3. Desktop, web, or mobile/tablet?**
Touch changes the entire UI design (no hover, no right-click, no keyboard modifiers), so
it isn't a port decision — it's a day-one decision.
*Default: desktop web first, mouse+keyboard. Tablet-friendly considered but not designed
for. No phone.*

**B4. Do you want this open source?**
Affects licensing (Micropolis is GPL — reading it is fine, copying it is contagious),
whether mods can be first-class, and whether it lives on your public GitHub.
*Default: private repo during M0, public at M1, MIT, no GPL code copied in.*

---

## C. Perspective & art

**C1. Confirm the camera plan.**
Recommendation is 3D geometry + orthographic camera at a ¾ tilt with snapping rotation,
plus a Tab-toggled top-down schematic **Plan Mode**. Full detail in `CAMERA-AND-ART.md`.
Does that match what you meant by "maybe both depending on what you're working on"?
*Default: yes, build D.*

**C2. Fixed rotation or free rotation?**
Fixed 4/8 positions is more readable and cheaper; free rotation feels modern.
*Default: free rotation that snaps to 45° increments unless a modifier is held.*

**C3. How much verticality?**
Skyscrapers change occlusion, LOD, and the whole silhouette language. Low-rise-only cities
are dramatically cheaper and read better top-down.
*Default: full range up to towers, with automatic fade/x-ray on anything occluding the
cursor tile.*

**C4. Where exactly on the realism dial?**
"Architectural scale model" (matte, AO-heavy, semantic palette, exaggerated proportions)
is what I've assumed. The alternative reads are "SimCity 4 fidelity with modern
rendering" or "clean flat-shaded stylized."
*Default: architectural scale model.*

**C5. Do people and cars appear on screen?**
They're the main source of life — and the main source of dishonesty if the sim doesn't
actually track them.
*Default: yes, as instanced visualization explicitly sampled from the flow model, with the
UI honest about that.*

---

## D. Simulation philosophy

**D1. [BLOCKER] Confirm: field-based sim, not agent-based.** — ✅ **ANSWERED: field-based.**
Three-layer hybrid: fields as the truth, aggregate flow assignment for traffic and
utilities, sampled agents as an honestly-labelled visualization plus a few hundred
genuinely persistent citizens for narrative and as a validation harness.
Full explanation in [SIMULATION-MODEL.md](SIMULATION-MODEL.md).

**D2. How deep does the economy go?**
Options: (a) SimCity's abstract RCI demand, (b) RCI + real supply chains for industry
(Anno/Highrise City), (c) full logistics where nothing teleports (Workers & Resources).
Each step multiplies both depth and complexity.
*Default: (a) for M0/M1, with the data model shaped so industry chains can be added
later without a rewrite.*

**D3. Is there a late-game pressure system, and what is it?**
The genre's biggest unsolved problem: by hour 20 money is infinite and nothing is at
stake. Candidates: aging infrastructure, economic cycles/recessions, demographic shift,
climate and sea level, regional competition.
*Default: aging infrastructure + economic cycles in M1; the rest M2+.*

**D4. Failure — can you actually lose?**
Bankruptcy game-over, soft decay, recall election, or nothing (pure sandbox)?
*Default: no hard loss in sandbox; scenarios can have real fail conditions; budget crises
are painful but survivable.*

**D5. Disasters: in, out, or optional?**
*Default: in, individually toggleable, off by default in sandbox.*

**D6. Region play — M1 or M2?**
It's SC4's best feature and still unmatched, but it constrains the save format and the
simulation boundary, so **the architecture has to assume it from day one either way.**
*Default: architect for it in M0, ship it in M1.*

---

## E. Content & tone

**E1. Real-world or fictional city naming, buildings, brands?**
*Default: fictional, generic-modern, no real brands or landmarks.*

**E2. How much humor?**
SimCity's newspaper and advisors were genuinely funny. That's a big part of what people
miss — and it's also a voice you'd have to write.
*Default: dry and wry. Funny headlines, sincere systems. Never Fallout-camp.*

**E3. Do you want the newspaper?**
It's the strongest differentiator on the list (nobody has done it since 1993), and it's
also a real content-writing commitment — a template library that has to stay funny across
hundreds of hours.
*Default: yes, and treat the template corpus as a first-class content deliverable.*

**E4. Music and audio direction?**
The SimCity soundtracks are a huge part of the memory.
*Default: deferred to M1; ambient city soundscape in M0 and nothing else.*

**E5. Real politics or abstracted?**
Zoning, gentrification, displacement, and policing are inherently political, and a sim
that's honest about them is more interesting — and more likely to get an argument.
*Default: model the dynamics honestly (land value → displacement is a real mechanic),
name them neutrally, take no partisan position.*

---

## F. Process & constraints

**F1. [BLOCKER] How much time per week, realistically?**
This decides whether M0 is 6 weeks or 6 months, and whether the art pipeline can be
in-house at all.
*Default: assume this is a side project competing with 20+ other repos, so every slice
must be independently playable and nothing depends on a long unbroken run.*

**F2. Art — you, me, asset packs, or commissioned?**
The kit-of-parts approach was chosen partly because it's the only path that works without
a dedicated artist.
*Default: procedural/parametric kit-of-parts generated from code, with CC0 asset packs for
props. No commissioned art before M1.*

**F3. What's the working title?**
`citysim` is a placeholder folder name. Needs something that isn't trademark-adjacent to
SimCity.
*Default: pick at M0 completion; don't bikeshed it now.*

**F4. What does "done" look like for the first milestone?**
My proposal: **one city tile, one hour of play, the Why Panel working, three data layers,
zoning that grows and abandons for reasons you can read on screen.** If that's fun, the
rest is execution. If it isn't, the design is wrong and we've spent weeks, not a year.
*Default: that.*

**F5. Does this go on the Jarvis dashboard now or after M0?**
*Default: create `.jarvis.json` at M0 kickoff so it shows up in IN PROGRESS.*

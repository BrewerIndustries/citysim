# Feature List

Tiered. **M0** is the vertical slice that proves the game is fun. **M1** is a shippable
game. **M2+** is what makes it *the* one. Anything not in M0/M1 is explicitly deferred —
this list is as much about sequencing as about scope.

---

## Design pillars (the four things every feature must serve)

1. **The city is legible.** You can always see what is happening and why.
2. **The simulation is honest.** What is displayed is what is computed. No theater.
3. **Money and space are real constraints.** Decisions cost something, forever.
4. **The city has a voice.** It talks back — headlines, advisors, complaints, character.

---

## M0 — Vertical slice ("is this fun?")

The goal: one city tile, one hour of play, proving the core loop.

### Core simulation
- [ ] Tile grid, ~8m cells, single city tile (start 256×256 ≈ 4km², expandable)
- [ ] **Field-based simulation** (the SimCity 1/4 model, not the SC2013 agent model):
      land value, pollution, crime, fire risk, traffic load, desirability, coverage
      computed as diffusion passes over the grid each tick
- [ ] RCI demand with at least two wealth tiers per type
- [ ] Zoning (paint R/C/I at low/med/high density) → growable buildings that develop,
      upgrade, and abandon based on local field values
- [ ] Roads as a graph; road access requirement for development
- [ ] Power as a network flow (plants → grid → coverage); water as a second network
- [ ] Budget: tax rates per zone type, department funding, monthly income/expense
- [ ] Time control: pause / 1× / 3× / 9×, months and years
- [ ] Save / load

### Interface (equal priority to the sim — this is not polish)
- [ ] **Data layers**: land value, pollution, crime, traffic, power, water, desirability,
      coverage radii. Animated, beautiful, in the SC2013 tradition
- [ ] **Plan Mode** top-down schematic toggle (see CAMERA-AND-ART.md)
- [ ] **The Why Panel** — click any building/tile and get a plain-language causal readout:
      *"Abandoned. No road access within 3 tiles. Crime 72 (high). No R§§ jobs in range."*
      This is the single most important feature in the entire document.
- [ ] Road drawing tools: straight, curve, arc, grid-stamp, with snapping and guides
      (steal the SC2013 toolset wholesale — it's the best ever made)
- [ ] Undo/redo, at least 50 deep, for all construction
- [ ] Graphs over time for every tracked stat

### Feel
- [ ] Orthographic ¾ camera with snapping rotation, three zoom bands
- [ ] ~30 buildings from a modular kit, semantic palette by zone type
- [ ] Placement/bulldoze feedback that feels good (sound, snap, ghost preview, cost)

---

## M1 — Shippable game

### Simulation depth
- [ ] Full wealth tiers (3 residential, 3 commercial, 2–3 industrial incl. dirty/mfg/hi-tech)
- [ ] Education and health as **slow multi-decade stats** that gate high-wealth/hi-tech
      demand (the SC4 mechanic — the best long-horizon incentive in the genre)
- [ ] Services with real coverage: police, fire, health, schools, parks
- [ ] Garbage & waste management as a subsystem (SC3000's best addition)
- [ ] Traffic: honest and *teachable* — see "The traffic rule" below
- [ ] Mass transit: bus, rail/subway, with an underground layer
- [ ] Terrain with elevation; water bodies; basic terraforming
- [ ] Disasters, individually toggleable, with a "no disasters" sandbox switch
- [ ] Land value → gentrification/displacement dynamics (abandonment isn't only failure)

### Systems that create decisions
- [ ] **Ordinances / policies** — city-wide and per-district, with real trade-offs
- [ ] **Districts / neighborhoods** — name them, set policy per district (CS's best idea)
- [ ] **Neighbor deals** — buy/sell power, water, garbage with adjacent cities on contracts
- [ ] **Devil's-bargain buildings** — the toxic-waste-dump pattern: big money, real cost
- [ ] Bonds/loans with interest; budget crises that are recoverable
- [ ] Zoning-adjacent regulation: height limits, setbacks, mixed-use, historic preservation

### Voice & character
- [ ] **The newspaper.** Subscribable, periodic, procedurally assembled from real sim
      events. Doubles as the diagnosis channel and the personality channel. SC2000 did
      this in 1993 and nobody has done it since. This is a differentiator.
- [ ] Advisors with distinct personalities and *conflicting* recommendations
- [ ] Citizen petitions / complaints tied to actual local field values
- [ ] Milestones and city-name/mayor-name reactivity

### Structure
- [ ] **Region play** — multiple city tiles on a shared map, trading power/water/garbage
      and **commuters**. SC4's crown jewel; still unmatched. Design for it from day one
      even if it lands in M1, because it constrains the save format and the sim boundary.
- [ ] Scenario mode — authored challenges with win/lose conditions (the 1989 tradition)
- [ ] Sandbox mode with unlimited money and all buildings
- [ ] Difficulty settings that change *economic pressure*, not just starting cash

### Technical
- [ ] Simulation runs off the render thread; deterministic and fixed-timestep
- [ ] Target performance stated and enforced by an automated benchmark from week one
- [ ] Fully offline. Single-player. No account required.

---

## M2+ — What makes it the one

- [ ] **Mod / asset pipeline** as a supported product (every entry with real modding
      outlived every entry without it). Data-driven building definitions, an asset import
      path, a documented sim-hook API
- [ ] **Refactor tools** — upgrade a whole district, replace a road class along a corridor,
      copy/paste a neighborhood block. Directly attacks the "bulldoze busywork" complaint
- [ ] Follow-a-citizen mode with a *genuinely persistent* individual (only if the sim
      actually tracks them — otherwise cut it, see DO-NOT-DO)
- [ ] Late-game pressure: aging infrastructure, demographic shifts, climate/sea level,
      economic cycles and recessions — the answer to "money is infinite by hour 20"
- [ ] Historical eras / tech progression, or a modern-era-only sharpening (open question)
- [ ] Photo mode and shareable city postcards / GIF export
- [ ] Timelapse replay of your city's whole history
- [ ] Async region multiplayer (share city tiles with a friend, never real-time)
- [ ] Steam Workshop or equivalent
- [ ] Accessibility: colorblind-safe overlay palettes, full keyboard control, UI scaling

---

## The traffic rule

Traffic is where this genre goes to die. Both Cities: Skylines games ship a pathfinder
that assigns one route at spawn and never re-evaluates, so agents bunch into a single
lane, ignore most of the network, and get *worse* when you add capacity. Players cannot
form a mental model of it, so they cannot learn, so they install mods to replace it.

The rule for this project: **traffic must be teachable.**
- Prefer an aggregate flow/assignment model over per-agent pathfinding: compute
  origin-destination demand between zones and assign it across the network with congestion
  feedback (a classic four-step or incremental equilibrium assignment). It is cheaper,
  it scales, and it produces *correct-feeling* congestion.
- Vehicles you see on screen are a **visualization sampled from the flow field**, not the
  thing being simulated. Honest, because that's exactly what the UI will say it is.
- Adding capacity must reliably reduce congestion (or induce demand *visibly and
  explainably*). If a player can't predict the sign of the effect, the model is wrong.
- The Why Panel must be able to explain any congested segment.

## The performance rule

Cities: Skylines II shipped knowingly broken and it defined the game's reputation
permanently. Performance is a design constraint here, not a polish task:
- Targets are **tiered** (full table in [TECH-STACK.md](TECH-STACK.md)):
  **Tier 1** 512² / 200k pop / 60fps + 10 ticks/s is the M1 ship gate;
  **Tier 2** 1024² / ~1M pop must stay reachable;
  **Tier 3** 2048² / multi-million ("metropolis mode") may degrade to 30fps but must never
  stall. Ship Tier 1, never foreclose Tier 3.
- Write a synthetic city generator that can fill *any* tier with fake data **before any
  real content exists**, and measure frame time and tick time against it.
- Run it in CI. A regression is a build failure, not a bug ticket. Tier 1 must pass to
  ship; Tier 2 is measured every build so we learn the day we break it.
- The field-based sim is O(tiles), which is the whole reason to choose it — it doesn't
  care how many citizens there are. What breaks first is the **tick budget** and the
  **origin–destination matrix** (the one genuinely quadratic thing), not memory.

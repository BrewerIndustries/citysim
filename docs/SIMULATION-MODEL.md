# Simulation Model — Field-Based vs Agent-Based

The single most consequential technical decision in the project. This doc explains both
models, why the field approach wins here, and the three-layer hybrid we'll actually build.

---

## The two models

### Agent-based: the entity is the unit

Every citizen, car, and delivery is a discrete object with its own state — a position, a
home, a job, a destination, a decision routine. You tick them all, each one decides what to
do, and city-level behavior emerges from the sum.

```
for each of 200,000 citizens:
    if at home and it's morning:  find job → compute route → start driving
    if driving:                   advance along route, check for congestion
    ...
```

**What it buys you:** genuine individual stories. You can follow one person. Emergent
behavior nobody scripted. It's intuitively "real."

**What it costs you:**
- **Cost scales with population.** 200k citizens is 200k decisions per tick. Pathfinding
  dominates — a route query over a large road graph is expensive, and you need thousands
  per second.
- **So you cheat.** Every shipped agent-based city builder cheats in the same place.
  SimCity 2013 made agents interchangeable — a sim went to the *nearest* house and the
  *nearest* job, not *their* home and job, and emergency vehicles picked destinations at
  random. Cities: Skylines 1 and 2 compute one route at spawn and never re-evaluate it, so
  cars commit to a lane a mile early, ignore most of the network, and adding capacity can
  make congestion *worse*.
- **The cheat is the scandal.** Both games marketed depth and shipped theater. Players
  eventually reverse-engineer it, and the discovery does more lasting reputational damage
  than a bad launch does.
- **It's nearly impossible to explain.** "Why did this building abandon?" requires
  replaying a history of thousands of individual decisions. This is why agent-based
  builders have no diagnosis layer — not because nobody thought of it, but because the
  data model can't answer the question.

### Field-based: the *map* is the unit

Every tile holds a set of scalar values — land value, pollution, crime, desirability,
traffic load, police coverage, education level, and so on. Each tick you run a small number
of **diffusion passes** over the grid: values spread to neighbors, decay with distance, and
accumulate from sources.

```
pollution[i] += emission[i]           # factories, traffic, power plants add
pollution     = blur(pollution)        # spreads to neighbors
pollution    *= 0.98                   # decays
landValue[i]  = f(amenities[i], -pollution[i], -crime[i], transitAccess[i])
```

Buildings then read their own tile's values and make one cheap decision: develop, upgrade,
downgrade, or abandon. **Population is a number attached to a building, not a set of
objects.** A 40-storey tower is `residents: 480, wealth: 2`, not 480 allocations.

**What it buys you:**
- **Cost is O(tiles), not O(citizens).** A city of 200k and a city of 2 million cost
  exactly the same to simulate, because you're processing the same grid either way. This
  is the entire reason to choose it, and it's why Cities: Skylines II's simulation starts
  choking around 100k population while SimCity 4 — a 2003 game on one CPU core — doesn't
  have that failure mode at all.
- **It's the right shape for hardware.** Every pass is a stencil operation over a flat
  typed array: sequential memory access, cache-friendly, trivially parallel, and a
  straight path to SIMD or the GPU later if needed.
- **It's deterministic and debuggable.** Same input, same output, every time. You can
  snapshot, diff, and unit-test the whole simulation.
- **It's explainable — and this is the killer feature.** Every outcome is literally a
  number sitting in an array on that tile. The Why Panel isn't a feature we bolt on; it's
  a readout of the data model. *"Abandoned. crime=72, landValue=11, jobAccess(R§§)=0,
  roadAccess=false."* SimCity 4 had exactly this data and just never surfaced it. That
  omission is the biggest open goal in the genre.
- **It's what actually made SimCity deep.** SC1 (1989) and SC4 (2003) are both
  field-based. SC4 is still called the most complete city sim ever made.

**What it costs you:**
- No individual stories for free. There is no "Bob" unless you build one.
- Genuinely identity-dependent things are awkward — a specific truck's cargo, one
  person's exact commute.
- It can feel abstract if you don't visualize it well. (Which is why data layers are a
  day-one feature, not polish.)

---

## The three-layer hybrid we're building

The trick is that "field vs agent" is a false binary. Use each where it's honest.

### Layer 1 — Fields: **the truth**
All economic, social, and environmental state. Land value, pollution, crime, fire risk,
desirability, service coverage, education, health, RCI demand. Runs over the whole grid
every tick. This is what buildings read and what the game means when it says anything.

### Layer 2 — Aggregate flow: **the network truth**
Traffic, power, and water are *flows on a graph*, not journeys by individuals. Build an
origin–destination demand table between traffic zones, then assign it across the road
network with congestion feedback until it settles near equilibrium — standard transport
engineering, decades older than any of these games.

Congestion emerges from the flow-to-capacity ratio on each segment, which means it behaves
the way players expect: **adding capacity reliably helps, and induced demand shows up as a
visible, explainable second-order effect** rather than as inexplicable lane-bunching.
This is the direct fix for the genre's worst-reviewed system.

### Layer 3 — Sampled agents: **the show, plus a small honest subset**

**The show.** Cars and pedestrians on screen are spawned to *match* the flow computed in
layer 2. If a segment carries 800 vehicles/hour, we render a density that reflects 800
vehicles/hour. They are a visualization of the simulation, driven by it and accurate to
it — and the UI will say exactly that. That's honest. Claiming individual agency you don't
have is the thing that sank SimCity 2013; sampling a real aggregate model and being open
about it is not the same act.

**The honest subset.** Separately, keep a small pool — a few hundred — of *genuinely
persistent* citizens with real homes, real jobs, real routes, and real life events. Because
N is tiny, they can be fully simulated with no cheating at all. That gives you "follow a
citizen," human-scale narrative, and newspaper material, without the lie. It also gives you
a **validation harness**: if the tracked citizens' commutes don't match what the flow model
predicts, the flow model is wrong. The narrative feature doubles as a test suite.

---

## Worked example: pollution

| | Agent-based | Field-based |
|---|---|---|
| Model | 500 factories emit particle objects; particles drift, decay, and are sensed by nearby buildings | `pollution[i] += emission[i]`, blur pass, decay pass |
| Cost | Thousands of moving objects, spatial queries every tick | Three array passes over the grid |
| Result on screen | Roughly the same | Roughly the same |
| Can you query it? | "Sum the particles near this tile, maybe" | `pollution[i]` — it's a number, right there |
| Can you explain it? | Not really | *"Pollution 84. Sources: heavy industry 2 tiles NE (61), highway 4 tiles W (23)."* |

Same visual outcome, orders of magnitude cheaper, and only one of them can talk.

---

## The rules that follow from this

1. **The simulation is a pure module.** Typed arrays in, typed arrays out. No DOM, no
   three.js, no browser APIs, no dependency on the renderer. It runs in a Web Worker and
   could be lifted into WASM or a native host later without touching game logic. This is
   our insurance policy on the platform choice (see TECH-STACK.md).
2. **Zero allocation in the tick loop.** No objects created per tile, per building, or per
   frame. Everything is pre-allocated struct-of-arrays. GC pauses are the JS equivalent of
   CS2's frame hitching, and they're avoidable by construction.
3. **Determinism is enforced by test.** Seeded RNG only. A fixed input city must produce a
   byte-identical state after N ticks, checked in CI. This makes save/load, replay,
   timelapse, and bug reports all fall out for free.
4. **Every displayed number is a real field value.** No cosmetic stats. If the UI shows it,
   you can find it in an array; if you can't find it in an array, the UI doesn't show it.
5. **Rendering never drives simulation.** The visible cars can be culled, thinned, or
   turned off entirely at high zoom with zero effect on the city. If disabling the visuals
   changes the simulation, the layering is broken.

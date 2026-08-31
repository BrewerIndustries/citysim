# Camera, Perspective & Art Direction

You said: leaning top-down, maybe ¾, maybe both depending on what you're doing;
realistic but not photoreal ultra-HD. Here's the honest analysis and a recommendation.

---

## The four options

### A. True top-down orthographic (SimCity 1, Micropolis)
- **Pros:** maximum legibility, trivial to render, data layers are native, no occlusion
  ever, art is cheap (one sprite per building), runs on a potato.
- **Cons:** no charm, no skyline, no "look what I built" moment. Buildings are icons.
  Hard to sell a modern game on it. Verticality is invisible.

### B. Classic isometric / dimetric ¾ (SC2000, SC3000, SC4)
- **Pros:** the iconic look. Great readability *and* a real skyline. Sprites or
  pre-rendered art means beautiful frames at near-zero GPU cost. LOD is free.
- **Cons:** fixed rotations (4 or 8) or you re-author every sprite. Tall buildings occlude
  the tiles behind them — the classic SC4 "I can't see what I'm clicking" problem.
  Terrain slopes and sprites fight each other. Curved roads are painful.

### C. Full 3D with a free perspective camera (SC2013, Cities: Skylines 1/2)
- **Pros:** spectacle, curved roads, free rotation, ground-level photo mode.
- **Cons:** this is exactly where CS2 died — LODs, culling, draw calls, and a content
  pipeline that has to look good from every angle at every distance. It is *most* of the
  budget of a project like this, and the payoff is the part players complain about least.

### D. 3D geometry under an orthographic camera, with two presentation modes ← **recommended**
Model everything in real 3D. Render it through an **orthographic** camera locked to a
¾ tilt (~40–50°) with snapping rotation. Then add a **Plan Mode** toggle that lifts the
camera to 90° top-down *and swaps the materials to a flat schematic style* — flat colors,
crisp outlines, labels, data overlays.

This gives you genuinely both views, and it costs almost nothing extra: it's one camera
rig and one material swap, not two renderers.

---

## Why D is the right call

1. **It matches how people actually play.** Building and zoning is a *planning* activity —
   you want top-down, gridded, unoccluded, with a pollution or land-value overlay on.
   Admiring and diagnosing is a *spatial* activity — you want the ¾ diorama. Nobody wants
   one view for both, which is why every SimCity shipped data layers that effectively
   flatten the world anyway. Make that an actual first-class mode instead of a hack.
2. **Orthographic buys you the iso look with modern geometry.** No perspective distortion,
   so the grid stays readable across the whole screen, buildings at the edge don't lean
   over, and you keep the "architectural model" feeling. But you still get real rotation,
   real terrain, real curved roads, and real shadows.
3. **It caps the graphics budget by construction.** A fixed tilt band and a fixed zoom
   range means you know exactly which LODs exist and exactly what the silhouette needs to
   read like. You never have to make a building look good from a street-level camera at
   2m — which is where photoreal costs explode.
4. **It's the cheapest path to the "not photoreal" brief.** Flat-ish shading + strong
   ambient occlusion + a controlled palette reads as "architectural scale model," which is
   *exactly* the aesthetic you described and is far cheaper than PBR realism.

**Concrete camera spec to start from:**
- Orthographic projection. Tilt adjustable 30°–65°, default 45°. Yaw free but snaps to
  45° increments (hold a modifier for free rotate).
- Plan Mode: hotkey (Tab), animates to 90° tilt + schematic material set + grid on.
  Data overlays available in both modes, but *default on* in Plan Mode.
- Three zoom bands: District (whole city, buildings become massing blocks), Neighborhood
  (default working zoom), Street (detail, animation, people visible).
- Buildings above a height threshold get automatic fade/x-ray when they occlude the
  cursor's tile. Never let a tower hide a click target.

---

## Art direction: "architectural scale model"

The target is a **physical diorama / architect's massing model**, not a photograph.

- **Materials:** matte, low-spec, minimal texture detail. Color and form carry the read,
  not surface detail. No wet asphalt, no lens flares, no screen-space reflections.
- **Lighting:** one key sun with soft shadows + strong ambient occlusion. AO is doing 80%
  of the work here — it makes simple geometry look sculpted and it's cheap.
- **Palette:** limited and *semantic*. Residential/commercial/industrial each have a
  restrained hue family, so a zoomed-out city is instantly readable as a land-use map
  even with overlays off. This is the single biggest readability win available.
- **Scale cheat:** slightly exaggerated building proportions (like a model kit), slightly
  oversized signage/props. Reads better at the working zoom than true-to-scale does.
- **Kit-of-parts:** buildings are assembled from modular pieces (base, floors, roof,
  details) with per-instance color/variation, not hand-authored one-offs. This is how you
  get hundreds of distinct-looking buildings out of a small art budget, and it's how you
  keep draw calls low via instancing.
- **People and cars:** simple, stylized, instanced. Present for life and motion; they are
  *decoration driven by the sim*, never the sim itself (see the DO-NOT-DO list).
- **Seasons/weather:** color-grade and material tint passes, not new asset sets.

**Reference feel:** SimCity 4's silhouette clarity + SimCity 2013's color language and
data-layer beauty + the matte, model-like surfacing of something like Timberborn or
Townscaper. Explicitly *not* Cities: Skylines II's photoreal-ish target.

# Tech Stack, Distribution & Scaling

Decisions: TypeScript + three.js, simulation in a Web Worker. Web is the **development and
demo** target; **Steam is the commercial target**, reached by wrapping the same codebase in
a bundled-Chromium desktop shell. Target city size is tiered, with the architecture
required to reach the top tier even if we only ship the bottom one first.

---

## 1. Why Steam and not a web release

These aren't alternatives — they're different jobs, and the same codebase does both.
Vampire Survivors is the standing proof: an HTML5/Phaser game released free in the browser
on itch.io in March 2021, then put on Steam in Early Access that December, where it became
one of the decade's biggest indie successes. Web build, native storefront.

**Web is excellent as a development and funnel target.** Instant iteration, no install, a
playable link you can hand anyone, and it drops straight onto your existing GitHub
Pages + Cloudflare pipeline. A free browser demo that converts to a Steam wishlist is a
strong funnel for exactly this genre.

**Web is a poor *commercial* target for a game like this**, for five concrete reasons:

**1. Mods are the genre's life-support, and they need a real filesystem.** SimCity 4 and
Cities: Skylines are both alive today because of the Network Addon Mod and the Steam
Workshop. A browser tab cannot offer real asset importing, gigabyte mod libraries, or
one-click subscribe/update. Steam Workshop is the single largest longevity multiplier
available to this project, and it's Steam-only.

**2. Saves must be files the player owns.** Browser storage (IndexedDB / OPFS) is
origin-scoped and *evictable* — the browser can delete it under storage pressure, and users
clear it by accident routinely. Losing a 40-hour city is unrecoverable trust damage. Native
builds write real save files to a real directory, with Steam Cloud on top.

**3. Session shape.** City builders are four-hour sessions. Browser tabs get backgrounded,
throttled, memory-pressured, and OOM-killed. A native window doesn't.

**4. Memory ceiling.** This is the one that actually bites on "large metropolises." A
browser tab has a practical memory budget well below a native process, and if any of the
hot path ever moves to WASM, `wasm32` caps the address space at 4GB (memory64 exists but
support and performance are still uneven). Tier 3 city sizes (below) get uncomfortable in a
tab and are routine natively.

**5. Money and discovery.** There's no meaningful storefront for a paid browser game. Steam
is where city-builder players already are, and it brings achievements, cloud saves, a
refund policy players trust, and a review system that this genre's audience actually reads.

**Conclusion:** build for the browser, ship to Steam. Keep a permanently free, size-capped
browser demo as the marketing funnel.

---

## 2. The desktop shell: Electron, not Tauri

Tauri is the default choice for wrapping a web app these days, and it's the wrong one
here. It produces far smaller binaries (~3–10MB vs
Electron's ~120–200MB) and uses less RAM, which is why it wins most desktop-app
comparisons. But it uses **the OS's own webview** — WebKit on macOS, WebView2 on Windows,
WebKitGTK on Linux — and for a 3D game that's disqualifying:

- Tauri's maintainers support **WebGPU only behind an unsafe/experimental flag** in
  WebView2. For a renderer this is a hard blocker.
- Rendering differs per OS by design, because each platform's webview is a different
  browser. For a visually complex app that means a cross-platform testing burden on every
  frame you draw; for a game it means "looks and performs correctly on my Mac" tells you
  nothing about Windows.

Electron bundles a known Chromium version, so WebGL2/WebGPU behave identically on every
platform and you test one renderer instead of three. For a game, a ~150MB download is a
non-issue — nobody buying a city builder blinks at that — and the consistency is worth far
more than the disk. **Take the size hit.**

(NW.js is a viable equivalent and has genre precedent; Electron has the larger ecosystem
and better Steamworks integration paths. Either beats Tauri here.)

---

## 3. Scaling ladder — the target is tiered

You want the stated benchmark but with headroom to real metropolises. So the target is
three tiers: **Tier 1 is the shipping gate, Tier 2 is what the architecture must not
preclude, Tier 3 is where we're allowed to degrade gracefully.**

| | Grid | Area @8m cells | Population | Frame / sim target |
|---|---|---|---|---|
| **Tier 1** — ship gate | 512² (262k tiles) | ~16 km² | ~200k | 60fps, 10 ticks/s, mid-range 2023 laptop |
| **Tier 2** — must remain reachable | 1024² (1.05M tiles) | ~67 km² | ~1M | 60fps, 10 ticks/s |
| **Tier 3** — "metropolis mode" | 2048² (4.2M tiles) | ~268 km² | multi-million | 30fps acceptable; sim may slow gracefully, never stall |

For scale: Tier 3 is roughly 2.5× the land area of Paris, and about a third of New York
City. It's a genuinely large metropolis, not a token gesture.

**The good news:** field-based simulation is the reason this is even plausible. Cost is
O(tiles), so population is free. Rough field-data budget at 64 bytes/tile:
~17MB at Tier 1, ~67MB at Tier 2, ~270MB at Tier 3 — and roughly half again for the
ping-pong buffers diffusion needs. That's comfortable natively and tight-but-viable in a
tab, which is exactly why the browser stays the demo and Steam is the product.

**Where it actually breaks first** — the things to design against now:

1. **Tick budget, not memory.** At 10 ticks/s you have 100ms per tick, and a full-grid
   pass at Tier 3 touches 4.2M cells. A dozen such passes will blow the budget. Mitigations,
   all of which must be designed in from the start, not retrofitted:
   - **Dirty-chunk updates** — divide the grid into chunks; only re-diffuse chunks whose
     inputs changed. Most of a mature city is static most of the time.
   - **Staggered update rates** — pollution every tick, education every tenth tick. Slow
     fields don't need fast updates.
   - **Multi-resolution fields** — slow, wide-spreading values live on a coarser grid.
   - **Row-split across Web Workers** — stencil passes parallelize almost perfectly.
2. **The origin–destination matrix, which is the one thing that *is* O(zones²).** A dense
   OD table at Tier 3 (~4,000 traffic zones) is ~67MB *per demand class* and grows
   quadratically. Never store it densely: keep trips sparse, and use hierarchical zones —
   fine-grained locally, aggregated into superzones for long trips. Most trips are short;
   exploit that.
3. **Draw calls and culling, not polygons.** This is precisely what killed Cities:
   Skylines II — no meaningful LODs, no culling, full-detail geometry rendered for things
   you can't see. Chunked instanced rendering with whole-chunk massing blocks at far zoom
   is mandatory from the first renderer commit.

**The benchmark rule stands and gets stricter:** write a synthetic city generator *before
any content exists* that can fill any of the three tiers with fake data, measure frame time
and tick time, and run it in CI. A regression is a build failure. Tier 1 must pass to ship;
Tier 2 must be measured every build so we find out the day we break it, not a year later.

---

## 4. Portability insurance

The platform choice is right for iteration speed, but it has the lowest ceiling of the
options considered. The hedge costs almost nothing if we adopt it now and is expensive
to retrofit:

- **The simulation is a pure module** — typed arrays in, typed arrays out, no DOM, no
  three.js, no browser APIs (see SIMULATION-MODEL.md). It can be ported to Rust/C++/Zig
  compiled to WASM, or lifted into a native host, without touching game logic.
- **Zero allocation in the tick loop**, struct-of-arrays throughout. This is both the
  GC-pause fix and what makes a future WASM port mechanical rather than a rewrite.
- **A stable, versioned save format** that is not "JSON of whatever objects exist today."
  Binary, explicit, versioned, with migrations from v1.
- **Renderer behind a thin interface** so a WebGPU path, or eventually a native renderer,
  is a swap and not a rewrite.

If we ever hit a hard ceiling, the escape hatch is porting the *host*, not the *game*.

---

## 5. Sources

- [Vampire Survivors on Steam](https://store.steampowered.com/app/1794680/Vampire_Survivors/) · [Phaser origins](https://phaser.io/news/2024/02/vampire-survivors-space-54) · [Gamedev.js writeup](https://gamedevjs.com/games/vampire-survivors/)
- [Tauri vs Electron 2026 — Rustify](https://rustify.rs/articles/rust-tauri-vs-electron-2026)
- [Tauri v2 vs Electron 2026 — buildmvpfast](https://www.buildmvpfast.com/blog/tauri-v2-vs-electron-desktop-apps-2026)
- [Replace Electron with Tauri — GDevelop discussion (game-engine perspective)](https://github.com/4ian/GDevelop/discussions/6419)
- [Cities: Skylines II performance autopsy — Tom's Hardware](https://www.tomshardware.com/pc-components/gpus/cities-skylines-2-performance-autopsy-highlights-massive-optimization-failures)

# Research — The City Builder Lineage

Working notes for a SimCity-spirit remake. Everything here is "what shipped, what
people loved, what they hated," pulled from the games themselves plus contemporary
and retrospective reviews (sources at the bottom).

---

## 1. The SimCity line, version by version

### SimCity (1989, Will Wright / Maxis)
**View:** true top-down, 2D tile grid.
**Model:** cellular. Zones grow/decay based on neighboring tile values (land value,
pollution, crime, traffic density) computed by diffusion passes over the grid. No agents.

- **Liked:** perfect legibility — the map *is* the UI. Instant readability of a whole
  city at a glance. Tiny rule set producing genuinely emergent city shapes. It ran on
  anything.
- **Disliked:** opaque — no explanation of why a zone died. Very limited toolset.
- **Takeaway:** the cellular/field model is still the most robust core ever shipped for
  this genre. It scales to huge maps because cost is O(tiles), not O(citizens).
- **Bonus:** the original engine was open-sourced as **Micropolis** (GPL). Legal,
  readable reference for the classic value-propagation model.

### SimCity 2000 (1993)
**View:** dimetric isometric (the classic 2:1 "¾" look), with terrain elevation and a
**separate underground layer** for pipes and subways.

- **Liked:** the charm peak of the series. Newspaper system (subscribable, procedurally
  filled headlines that doubled as diagnostics — "aging power plant," disaster reports,
  opinion polls). Ordinances. Neighbor connections. Arcologies as an aspirational
  late-game. Query tool. The underground layer as a genuinely separate design space.
- **Disliked:** rotating the map to build under overhangs; water/power routing tedium.
- **Takeaway:** the **newspaper is the single most-missed feature in the whole series**
  and it was never repeated. It solved diagnosis *and* personality in one system.

### SimCity 3000 (1999)
**View:** higher-res isometric, same dimetric grid.

- **Liked:** **neighbor deals** — buy/sell power, water, and garbage capacity with
  adjacent cities, with real contract terms. Business deals (take the toxic waste dump
  for cash, eat the land-value hit). Waste management as a full subsystem. Advisors and
  petitioners with actual voice. Building Architect Tool → early real modding.
- **Disliked:** mostly a beautification of SC2000 rather than a deeper sim; slow at scale.
- **Takeaway:** neighbor deals and *devil's-bargain* buildings are cheap to implement and
  produce great decisions. Steal both.

### SimCity 4 (2003) + Rush Hour
**View:** isometric again, but buildings are pre-rendered 3D sprites; four rotations,
three zooms.
**Model:** the deep one. Wealth-tiered RCI (R§/R§§/R§§§ etc.), demand caps, land value,
education (EQ) and health (HQ) as *slow-moving multi-decade* stats that gate high-tech
industry, per-tile traffic simulation, and **regional play** — one big map cut into city
tiles that trade power, water, garbage and *commuters* with each other.

- **Liked, still, in 2026:** widely called the most complete pure city sim ever made.
  Regional play is the feature modern games still haven't matched. Graphs and data views.
  U-Drive-It. Mods — the Network Addon Mod (NAM) is a 20-year community project.
- **Disliked:** brutally opaque failure — a city dies and nothing tells you why, so
  players bounce off. City tiles too small. Single-threaded, chokes at scale. The traffic
  simulator was the weakest link and the community had to replace it. Doesn't run cleanly
  on modern OSes without patches.
- **Takeaway:** the depth ceiling to aim at, *plus* the clearest evidence that depth
  without diagnosis is a trap.

### SimCity Societies (2007, Tilted Mill)
Not a city sim. Dropped zoning and RCI entirely for six "societal values"
(productivity, prosperity, creativity, spirituality, authority, knowledge) that shape
which buildings you can place and how your city *feels*.

- **Liked:** expressive — you could build a genuinely dystopian or hippie city and it
  read that way. Direct placement was pleasant.
- **Disliked:** mixed reviews. Criticized as oversimplified, unchallenging, and a
  performance hog. Long-time fans revolted before it even shipped.
- **Takeaway:** "the personality axis" is a real want; deleting the simulation to get it
  is not the way. Keep the sim, layer character on top.

### SimCity (2013, "GlassBox")
**View:** full 3D, free-rotating camera.
**Model:** agent-based — every sim, car, unit of power and drop of water was a discrete
agent moving through the world. Marketed hard as "we simulate everything."

- **Liked:** genuinely great things in here. The **road-drawing tools** (curves, arcs,
  guides, snapping) are still best in class. The **data-layer visualizations** are the
  best the genre has ever had — beautiful, animated, instantly readable. Gorgeous
  stylized art with a consistent readable silhouette language. Building upgrade modules.
  Specializations (mining, gambling, education city).
- **Disliked (the famous part):** always-online DRM with servers that fell over at
  launch, for no gameplay reason — a modder had it running offline within days. Tiny
  2km² city plots. And the simulation was *theater*: agents were interchangeable, so
  sims went to the nearest house and nearest job rather than *their* home and job,
  emergency vehicles picked jobs at random, and traffic pathed dumbly. It looked deep and
  measured shallow. Creative director Ocean Quigley later described a vision clash —
  Maxis wanted the first full-3D SimCity, EA wanted an always-online multiplayer platform.
- **Takeaway:** the clearest cautionary tale in the genre. **Simulate what you display,
  display what you simulate.** Also: their UI/tooling team was right about almost
  everything; their architecture team and their publisher were not.

### SimCity BuildIt (2014, mobile)
Free-to-play with construction timers and IAP. Reviewed as competent underneath and
"borderline monstrous" on top; more Clash of Clans than SimCity.
- **Takeaway:** the anti-pattern. Timers are not gameplay.

---

## 2. The successors people actually play

### Cities: Skylines (2015)
The real heir. Big maps, no always-online, Steam Workshop assets, districts + policies,
strong mass transit.
- **Liked:** modding as a first-class citizen. Road tools. Districts with per-district
  policy. Scale.
- **Disliked:** money becomes meaningless by mid-game, so there's no late-game pressure.
  Citizens are not persistent individuals. And the traffic: **there is no traffic AI** —
  each agent gets exactly one instruction at spawn ("A to B, fastest") and never adapts.
  Agents bunch into one lane, ignore most of the network, and stack a mile deep waiting
  to turn past three empty lanes. Giving the network *more* routes often makes it worse.
  Whole mod ecosystems exist to replace the pathfinder. One player's summary of the
  genre's failure mode: "animated wallpaper rather than meaningful challenge."

### Cities: Skylines II (2023)
- **Liked on paper:** deeper economy, far better road tools, real terrain.
- **Disliked in practice:** shipped knowingly with performance problems. GPU-bottlenecked
  by missing LODs and no meaningful culling — it rendered full-detail geometry, including
  modeled *teeth* on citizens you never see. Simulation slows badly around ~100k
  population. Content thinner than the 8-year-old predecessor it replaced; asset editor
  delayed. Widely called an early-access release at full price.
- **Takeaway:** performance is a *design* constraint in this genre, not a polish task.
  Decide your target city size and prove it with fake data before building content.

### Worth mining, non-SimCity
| Game | Steal this |
|---|---|
| **Tropico** | Political factions with named characters; your decisions have a *person* attached |
| **Frostpunk** | Scenario framing + moral law-book; constraint creates story |
| **Workers & Resources: Soviet Republic** | Real supply-chain logistics; nothing teleports |
| **Anno 1800** | Production chains + genuinely beautiful dense cities |
| **Foundation / Manor Lords** | Gridless organic growth; buildings fit the terrain |
| **Timberborn** | Verticality and water physics as the puzzle |
| **Against the Storm** | Run-based roguelite loop — solves "nothing to do at hour 40" |
| **Terra Nil** | Reverse city builder; ecology as the scoring function |
| **OpenTTD / Transport Fever** | Network simulation that's legible and teachable |
| **Citystate II** | Ideology/policy as the primary economic lever |
| **Metropolis 1998** | A recent, well-received retro SC2000-homage — direct comparable, watch it |

---

## 3. What people consistently *love* (the "must have" pattern)

1. **Legibility.** Data layers, graphs, and overlays that make an invisible system visible.
   Every beloved entry had them; SC2013's were the best-looking ever made.
2. **Diagnosis.** Being told *why* something is failing. SC2000's newspaper did it with
   charm; almost nothing since has done it at all.
3. **Context.** The city is not an island — SC4's region and SC3000's neighbor deals.
4. **Policy levers.** Ordinances/districts: cheap to build, produce real decisions.
5. **Tools that feel good.** Road drawing, snapping, copy/paste, undo. SC2013 and CS both
   scored hugely on this alone.
6. **Personality.** Newspapers, advisors, petitioners, a ticker, disasters with headlines.
7. **Emergent individual stories.** "Follow this one sim." Powerful when *real*, poisonous
   when faked (see 2013).
8. **Modding.** Every entry with real modding outlived every entry without it.
9. **Meaningful money.** Constraint is the game. CS lost this by mid-game and the late
   game evaporated with it.

## 4. What people consistently *hate* (the "never do" pattern)

1. **Always-online / DRM** with no gameplay justification.
2. **Artificially tiny maps** that cap ambition (SC2013's 2km²).
3. **Fake simulation** — agent theater that looks deep and measures shallow.
4. **Opaque failure.** "My city is dying and the game won't say why." (SC4's real flaw.)
5. **Performance collapse at scale**, which in this genre means the game *ends* at the
   moment it should get interesting.
6. **Simplification that deletes the game** (Societies).
7. **Timers and IAP** (BuildIt).
8. **Brittle, unteachable traffic** that punishes you for building more roads.
9. **DLC-gating basics** (bikes, tunnels, seasons).
10. **Late-game emptiness** — the city works, money is infinite, nothing left to decide.
11. **Bulldoze busywork** — no way to *refactor* a district, only to flatten it.

---

## Sources
- [Maxis dev on the SimCity 2013 failure — Softpedia](https://news.softpedia.com/news/Maxis-Dev-Provides-Insider-Outlook-on-SimCity-2013-Failure-475237.shtml)
- [SimCity plays fine offline — NBC News](https://www.nbcnews.com/tech/tech-news/gamers-confront-ea-simcity-plays-fine-offline-flna1C8895843)
- [SimCity launch disaster — NBC News](https://www.nbcnews.com/id/wbna51099972)
- [SimCity petition / "deeply damaging" — TechRadar](https://www.techradar.com/news/gaming/fans-sign-simcity-petition-as-launch-debacle-branded-deeply-damaging-1136912)
- [Why SimCity died and how an indie saved the genre — Medium](https://medium.com/age-of-awareness/why-simcity-died-and-how-an-indie-developer-saved-the-city-building-genre-2163ae2f07a1)
- [Best city builder every year, 1964–2025 — Simtropolis](https://community.simtropolis.com/forums/topic/763990-the-best-city-builder-every-year-from-1964-to-2025/)
- [SimCity: is it still the ultimate city builder? — PlayRatedGames](https://playratedgames.com/simcity-is-it-still-the-ultimate-city-builder-2/)
- [How traffic works in Cities: Skylines — Game Developer](https://www.gamedeveloper.com/design/how-traffic-works-in-cities-skylines)
- [Smarter AI traffic/pathfinding? — CS Steam discussions](https://steamcommunity.com/app/255710/discussions/0/611702631217042875/)
- [Yet again terrible path finding AI — CS2 Steam discussions](https://steamcommunity.com/app/949230/discussions/0/601891467285328134/)
- [CS2 performance autopsy — Tom's Hardware](https://www.tomshardware.com/pc-components/gpus/cities-skylines-2-performance-autopsy-highlights-massive-optimization-failures)
- [Why Cities: Skylines 2 performs poorly — paavohtl's blog](https://blog.paavo.me/cities-skylines-2-performance/)
- [CS2 will intentionally launch with performance issues — GamesHub](https://www.gameshub.com/news/news/cities-skylines-2-performance-issues-2631365/)
- [SimCity 2000 — Maxis Wiki](https://maxis.fandom.com/wiki/SimCity_2000)
- [SimCity 3000 — SimCity Wiki](https://simcity.fandom.com/wiki/SimCity_3000)
- [SimCity Societies — Wikipedia](https://en.wikipedia.org/wiki/SimCity_Societies)
- [SimCity Societies review — GameSpot](https://www.gamespot.com/reviews/simcity-societies-review/1900-6183059/)
- [SimCity BuildIt review — TouchArcade](https://toucharcade.com/2014/12/23/simcity-buildit-review/)
- [SimCity BuildIt critic reviews — Metacritic](https://www.metacritic.com/game/simcity-buildit/critic-reviews/?platform=ios-iphoneipad)
- [10 promising indie city-builders coming in 2026 — GameObserver](https://gameobserver.com/10-promising-indie-city-builders-coming-in-2026)
- [15 best city building games to play in 2026 — Yahoo](https://www.yahoo.com/entertainment/gaming/articles/15-best-city-building-games-120628699.html)

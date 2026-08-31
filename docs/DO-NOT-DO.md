# Do Not Do

Anti-goals. Each one is a specific, documented failure from a real game in this genre.
When scope pressure hits, these are the things that *stay* cut.

---

## Architecture & business

**1. No always-online. No DRM. No account requirement.**
SimCity 2013's servers fell over at launch, made the game unplayable for days, and a
modder had it running offline within a week — proving the requirement was never technical.
It permanently defined the game's reputation. This game must be fully playable offline,
forever, with no login.

**2. No free-to-play timers, energy, or IAP.**
SimCity BuildIt was reviewed as competent underneath and "borderline monstrous" on top.
Timers are not gameplay.

**3. No DLC-gating of basics.**
Bikes, tunnels, seasons, and the asset editor being paid or delayed content is a
reputational tax that compounds. If it's a core urban system, it ships in the box.

**4. Don't ship knowingly broken to hit a date.**
Cities: Skylines II did exactly this, publicly, and never recovered the narrative. Slip
the date or cut the feature.

---

## Simulation

**5. No agent theater.**
SimCity 2013 marketed "we simulate every sim" and shipped interchangeable agents that went
to the *nearest* house and *nearest* job, with emergency vehicles picking destinations at
random. It looked deep and measured shallow, and the discovery of this did more lasting
damage than the servers did.
**Rule: simulate what you display, display what you simulate.** If cars on screen are a
visualization of an aggregate flow model, say so in the UI and be proud of it — that's
honest. Claiming individual agency you don't have is the failure.

**6. No per-citizen agent pathfinding as the core traffic model.**
Both Cities: Skylines games assign each agent one route at spawn with no re-evaluation.
Result: agents stack a mile deep to turn while three lanes sit empty, and adding roads can
make congestion *worse*. Players can't build a mental model, so they can't learn, so they
mod it out. See "The traffic rule" in FEATURES.md.

**7. No opaque failure states.**
This is SimCity 4's actual flaw, the reason a beloved deep game bounces new players. If a
building abandons, a district decays, or the budget collapses, the game must be able to
say why *in plain language, at the point of failure*. No wiki-required diagnosis.

**8. Don't delete the simulation to reach a wider audience.**
SimCity Societies dropped zoning and RCI entirely and was criticized as oversimplified and
unchallenging by fans and critics alike. Accessibility comes from *explanation and good
defaults*, not from removing systems.

**9. Don't make money meaningless.**
By mid-game Cities: Skylines players have infinite cash and the game stops asking
questions. Constraint is the game. If the economy solves itself, add pressure (aging
infrastructure, cycles, demographics) rather than accepting a decorative late game.

---

## Scope & scale

**10. No artificially tiny maps.**
SimCity 2013's ~2km² plots were the second-most-cited complaint after the servers. If
there's a size limit, it should come from an honest performance ceiling you've measured
and stated — not from a design decision to force regional multiplayer.

**11. Don't build a free perspective camera and street-level photoreal detail.**
That's where the budget dies (see the CS2 autopsy: no LODs, no culling, modeled teeth on
invisible citizens). Fixed tilt band + orthographic + defined zoom levels caps the art and
render budget by construction.

**12. No real-time multiplayer.**
Every attempt in this genre has cost enormous engineering for shallow payoff — SimCity
2013's "collaboration" amounted to sharing a few utilities, and the multiplayer mandate is
what drove the always-online decision in the first place. If multiplayer ever happens, it
is asynchronous region sharing.

**13. Don't start with historical eras / tech progression.**
It multiplies the art pipeline by the number of eras before the core loop is proven. It's
an M2+ conversation at the earliest.

---

## Craft

**14. Don't treat data layers and the UI as polish.**
In every beloved entry, the overlays *are* the game's readability. They belong in the
vertical slice, not in the final month.

**15. Don't make the player bulldoze to iterate.**
Refactoring a district by flattening it is busywork, not decision-making. Upgrade,
replace-along-corridor, and copy/paste tools are features, not conveniences.

**16. Don't build a hand-authored building for every slot.**
Modular kit-of-parts with per-instance variation, or the art budget consumes the project.

**17. Don't add "follow one citizen" unless the sim genuinely tracks that citizen.**
It is a great feature and a catastrophic lie. If the model is aggregate, either build real
persistent tracking for a small sampled subset, or cut the feature.

**18. Don't ship an art style that has to compete on fidelity.**
"Realistic but not photoreal" means an architectural scale model: matte materials, strong
ambient occlusion, semantic palette. Competing with AAA fidelity is a fight this project
cannot win and doesn't need to.

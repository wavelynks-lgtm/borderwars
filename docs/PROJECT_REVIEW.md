# BorderWars project review — 19 September 2026

## Scope and reference

Reviewed the local application across simulation, combat, AI, map generation, navigation, rail/economy, rendering, input, and UI. Downloaded the complete current OpenFrontIO repository and inspected the relevant mechanics and architecture at commit `df9114ee681dcb1a0af47215438f4e60db5d0719`.

This is a cross-system review and implementation pass, not a claim that every line of OpenFrontIO's client, server, authentication, payments, tooling, and tests has been individually audited. BorderWars remains a local single-player game. No upstream source files were copied into the application in this pass.

Reference points:

- [Combat execution](https://github.com/openfrontio/OpenFrontIO/blob/df9114ee681dcb1a0af47215438f4e60db5d0719/src/core/execution/AttackExecution.ts): connected frontier queues, troop commitments, retreats and annexation.
- [Configuration and balance](https://github.com/openfrontio/OpenFrontIO/blob/df9114ee681dcb1a0af47215438f4e60db5d0719/src/core/configuration/Config.ts): troop density, terrain resistance, growth and unit rules.
- [Simulation worker](https://github.com/openfrontio/OpenFrontIO/blob/df9114ee681dcb1a0af47215438f4e60db5d0719/src/core/worker/WorkerClient.ts): separation of simulation and rendering.
- [GPU renderer](https://github.com/openfrontio/OpenFrontIO/blob/df9114ee681dcb1a0af47215438f4e60db5d0719/src/client/render/gl/Renderer.ts): incremental texture updates and grouped uploads.

## Implemented

### Globe balance and expansion

- Track spherical land area using precomputed row weights, proportional to cosine(latitude). Ownership, victory, leaderboard order, population capacity, country rewards and takeover rewards use area rather than treating every map pixel as equally large.
- Expansion follows four-connected land, so it cannot jump diagonally across water or impassable gaps. A globe-aware frontier solver combines perpendicular travel with terrain, friendly support, defense cover, seeded local jitter, and coherent spherical resistance patches. This avoids regular Manhattan diamonds and uniform rings while giving favorable flanks room to advance. It adapts OpenFront’s terrain/support/random priorities; it does not copy its tick-priority formula unchanged.
- Movement credit accumulates across ticks. Weak attacks no longer receive one free tile every simulation tick regardless of how expensive that tile should be. Armies cannot capture tiles whose troop cost exceeds their remaining commitment.
- Scale time and casualty calculations across map resolutions, including reference-area defender density. The existing 4K map remains the balance baseline. Building radii and spawn radii now scale with resolution.
- Restrict cleanup annexation to a tiny, adjacent remnant below 5% of the defender's peak territory. Losing a single tile no longer instantly eliminates a newly spawned small nation or annexes a distant island.
- Keep attacks on different neutral countries separate, avoid reinforcing attacks already retreating, seed attacks from the match RNG, and enforce spawn protection in the execution layer as well as the UI.

### Performance and usability

- Store dirty column spans per row instead of one global rectangle. Coalesce similar spans, cap uploads per frame, and rotate the upload cursor so active northern fronts cannot starve southern updates.
- Compare the actual highlighted-front samples, fixing stale highlights when the middle of a front changes while its endpoints stay the same.
- Budget simulation work per frame and preserve fractional timing. Hidden tabs stop advancing; returning does not trigger a catch-up burst.
- Fix labels disappearing or staying at old anchors with a stationary camera. Hide labels behind the actual globe horizon.
- Defer game/Three.js downloads until a match starts. The initial JavaScript entry is approximately 33 KB minified, down from the previous single approximately 868 KB bundle. Game dependencies still download before playing.
- Add **F3** for FPS, average simulation tick time, and selected game speed.
- Ignore game hotkeys inside editable controls and avoid repeated pause/build toggles when a key is held. Clear terrain view after losing focus.
- Prevent disabled-unit hotkeys from opening a missing build-bar item.
- Label quick/custom matches honestly as single-player, replace invented player counts/wins with AI roster information, and avoid enabling development cheats merely because the game runs locally. Existing explicit developer settings remain respected.
- Allow play when browser settings storage is unavailable.

### Economy, navigation and weapons

- Population growth respects troops **plus workers**. Worker allocation now affects gold income: 40% workers retains the existing base; the multiplier is bounded between 0.25× and 1.75×. The slider now offers an actual army-versus-income tradeoff.
- Validate coarse water-route segments against the full terrain so ships cannot cross thin land strips. Add a bounded fine-grid fallback for narrow straits and coves. Pathfinding can still report no route when its search budget is exhausted.
- Let isolated neutral coasts use transport fallback. Recheck the transport limit when queued launches initialize.
- Reserve silo cooldown immediately, preventing multiple clicks in one simulation tick from firing the same silo repeatedly. Choose completed, ready, in-range silos.
- Permit free upgrades with infinite gold and block upgrades while construction is unfinished.
- Restore fallout and the optional **Nuke flooding** setting, including its menu control. Use the Mars palette for flooded Mars terrain.
- Use great-circle flight distances and stable antipodal interpolation so missiles do not collapse through the centre of the globe. Scale MIRV separation to the actual scatter radius.
- Reserve SAM targets immediately and stop already-flying shells/SAMs from damaging a newly friendly target. Do not trade with unfinished docks.

## Validation and measured results

- `npm run build`: TypeScript and production build pass. Three.js still produces a large shared chunk warning; it is deferred until a game starts.
- `npm test`: 44 regression tests cover area bookkeeping, population, workforce income, attack connectivity, affordability, pacing, annexation, determinism, resolution scaling, map wrap, great-circle/antipodal flight, water routing, queued boats, silo reservation, upgrades, nukes, and dirty texture updates.
- Browser checks: isolated headless Chrome at 1440×900, 4096×2048 maps, normal graphics, no developer cheats. Earth and Mars both loaded, rendered and passed pause/resume checks with zero JavaScript/WebGL errors. Final production smoke check also exercises deferred chunks and F3.
- Early-match frame sampling: approximately 16.67 ms/frame (60 FPS) in this environment. This is not a before/after FPS gain claim, a mobile benchmark, or a late-game worst-case guarantee.
- Packed simulations: 100 players each on Earth and Mars, 1,800 additional simulation ticks. No territory-owner mismatches, no measured area bookkeeping discrepancy, and no negative/non-finite populations. Earth tick p95 was approximately 0.4 ms; Mars approximately 1.3 ms. These accelerated checks exercise simulation and ownership; they do not measure sustained rendered late-game FPS.

### Controlled territory-upload comparison

Same browser, map and fifty scattered 8×8 patches; fifty updates per implementation, then repeat in reverse order. Both paths upload through the real WebGL context; measurements include `gl.finish()`.

| Measurement | Original | Updated |
|---|---:|---:|
| Pixels packed/uploaded per update | 1,568,400 | 3,200 |
| Upload calls per update | 50 | 50 |
| Median update time | ~6.0 ms | ~0.0–0.1 ms |
| 95th percentile | ~6.2–7.5 ms | ~0.1–0.2 ms |

That workload moves about **99.8% fewer pixels**. Sub-millisecond timing is limited by browser timer precision. Dense fronts spanning entire rows will benefit less. This isolates territory uploads, not total frame cost.

## Recommended next work

1. **Move simulation and pathfinding into a worker**, using compact changed-tile and unit snapshots as OpenFront does. This is the strongest next architectural step for preventing long AI/pathfinding ticks from blocking input. It needs an explicit command/snapshot boundary because the current UI directly references mutable game objects.
2. **Unify spherical distance rules for every weapon and range preview.** Area, expansion direction, and missile flight now account for the sphere, but local defense/SAM/nuke discs, rail connection ranges and some AI distance choices still use wrapped grid distance. Change those together with their preview geometry; changing only hit detection would make previews inaccurate.
3. **Longer strategic playtests**, especially hard/impossible AI, naval campaigns, and city/rail-heavy late games. The new population cap and geography weighting intentionally change balance. Three-minute simulations cannot establish complete match pacing or late-game fairness.
4. **Save/resume and deterministic replay**, followed by a seed field and a compact match summary. These are better fits for this single-player game than copying OpenFront's accounts, payments, or multiplayer server.
5. **Clarify remote border marching.** It currently permits travel along other territories' edges. Decide whether to retain that game rule or replace it with controlled land access and explicit naval invasions; it differs from ordinary front expansion.
6. **Dedicated mobile input/accessibility and context-loss recovery tests.** Desktop browser checks do not establish touch usability or recovery after GPU resets.

## Reproducing checks

Use Node 22.14+ (the test loader uses Node's TypeScript transformation support).

```sh
npm test
npm run build
npm run dev -- --host 127.0.0.1
node scripts/browser-check.mjs
BW_PACKED=1 BW_WORLD=earth node scripts/browser-check.mjs
BW_PACKED=1 BW_WORLD=mars node scripts/browser-check.mjs
node scripts/benchmark-territory.mjs
```

Browser scripts use an installed Google Chrome via Playwright. Set `BW_URL` to test a production preview. The benchmark optionally accepts the absolute path to a pre-change `GlobeRenderer.ts`; without it, it measures only the current implementation. Screenshots and detailed browser/benchmark output are written to the operating system temporary directory. No deployment was made.

## Visual and frontier follow-up

- All terrain and territory samples use one latitude-band display grid, also used by mouse picking. Adjacent displayed owners determine territory outlines, so the outline cannot revert to stretched native pixels. Native cells may be aggregated within one displayed cell at high latitude; small features can therefore be hidden. A fully uniform spherical simulation mesh would be a larger topology migration. Perfect undistorted square tiling everywhere on a sphere is not possible.
- Real and preview rails use surface ribbons with constant physical width. Real tracks have rails and sleepers. Geometry is batched and rebuilt on network changes, not on every frame. Trains sample their complete route by distance, preserving corners and seam wrapping; the tail engine follows the carriages. Ships now travel in latitude-adjusted distance too.
- Boats use the upstream 5×5 transport/trade and 11×11 warship silhouettes. Train loaded-carriage art uses the supplied PNG. Building glyphs were vertically inverted; their transform is corrected. Structure stacks invalidate after adding/removing buildings, and replaced texture/material caches are disposed.
- Unit visibility uses the actual globe horizon. Sprite and building styles remain adapted to the 3D view; premium cosmetics and every upstream visual state are not reproduced.
- New tests cover display-cell aspect ratio, picking/wrapping, coherent frontier variation, terrain preference, rail corners, carriage spacing, and boat speed at latitude. Browser fixtures inspect 0°, 75°, and 85° views with ships, trains, buildings and territory.
- Run `BW_URL=http://127.0.0.1:5175 node scripts/visual-check.mjs` against a development server for these synthetic scenes. The fixture places ships on a uniform land background deliberately to compare sprite size and orientation; real ship navigation is checked separately.

Final follow-up production check (100-player Earth): approximately 60 FPS in the early rendered sample; 1,800 additional simulation ticks had p95 ~0.8 ms, zero ownership mismatches, area discrepancy below 7e-11, and no JavaScript/WebGL errors. This checks the coherent-resistance front implementation; it is not a late-game FPS guarantee.

## Enemy invasion follow-up

Compared the current upstream `AttackExecution.ts` initialization and neighbor priorities. Normal enemy land attacks now seed every shared frontier, including AI attacks and clicks that previously supplied a single contact tile. Neutral country expansion and naval beachheads retain their local scope. Enemy attacks no longer clip to geographic country IDs, and reinforcement clicks merge into one army while picking up newly established shared borders.

For enemy invasions, friendly support strongly favors filling pockets and widening supported advances; terrain and defensive cover matter more than the bounded random variation. The spherical travel solver remains a globe-specific adaptation, rather than OpenFront’s exact tick-priority formula. Tests cover all shared borders, crossing country boundaries, isolated naval fronts, reinforcement behavior, and local resistance priorities.

## Combat pacing parity

Removed the per-tick capture cap based on `(border + 5) * resolution / 10`; it suppressed movement independently of troop strength and discarded unused movement credit. Conquest now spends its formula-derived budget, retaining fractional credit. A 4,096-candidate CPU guard remains and preserves unspent credit when reached.

Timing and casualties now use the same reference-area conversion. Frontier length uses exposed physical edges rather than compressed longitude cell counts, then converts into reference-map length. Combat recalculates troop density and strength after each capture rather than reusing stale values for six tiles.

`tests/fixtures/openfront-combat.json` records 72 numerical outputs obtained by executing the upstream Config.attackLogic method with its deterministic math at revision df9114ee681dcb1a0af47215438f4e60db5d0719. Tests match reference-scale cost/time formulas within numeric tolerance, verify their conversion at three resolutions and latitudes, and check actual budget spending and army-strength effects. These are formula and execution checks, not a claim of identical end-to-end matches: spherical geography, frontier order, fractional-budget handling, and the CPU guard remain intentional differences. Upstream's overwhelming-army speed floor is retained.

## Placed icons, trains and rails

Placed structures now sample the actual six-cell OpenFront icon atlas, rather than substituting its HUD SVGs. Shape scales, glyph padding, fill/border darkening and the close-zoom size baseline follow the upstream render settings. Factory hexagons have flat tops. Camera-facing placed icons and previews stay upright across both poles; units render below structure markers. Train sprite PNGs remain upstream assets, with two-pixel carriage intervals and a four-pixel engine-to-first-car gap measured along the surface route. Rails use the upstream one-third-width bands and ties, transparent gaps, local light/dark contrast, and owner-derived colors instead of a gray roadbed. They remain projected surface geometry, not a flat-map raster; premium effects and bridge pixel ornaments are not claimed as identical.

The long combat stress-test tick was traced to twelve full failed sea-route searches inside a single boat-launch attempt. Those alternative launch points now share one 40,000-node search budget. This bounds that repeated-search spike while retaining the fine-grid fallback; searches that exhaust the budget can still report no route.

The persistent upside-down placement bug was ultimately isolated to partial territory uploads bypassing Three.js’s cached pixel-store state. Uploads now use renderer.state.pixelStorei, so later CanvasTextures receive the correct Y orientation. Coverage includes a cache-coherence regression and an actual rendered missile-silo silhouette check after territory uploads, in addition to camera-orientation checks.

## Higher resolution and slower enemy fronts (September 20)

- Default Earth and Mars grids are now 5792×2896 (16,773,632 cells), approximately twice the previous 8,388,608 cells. Both dimensions grow by about sqrt(2), preserving the spherical aspect ratio. Memory requirements increase accordingly. Latitude-adjusted display cells and area-based combat conversion remain in place; tests now include the new resolution.
- Enemy attacks receive 0.5 movement credits per tick instead of 1, intentionally halving the upstream-derived movement rate for the globe. Neutral expansion retains its previous timing. The underlying 72 upstream formula fixtures still match: casualty cost per captured surface area is unchanged. Fractional credit still accumulates, so expensive tiles do not stall permanently.
- Coherent enemy-front resistance has stronger variation (exponent 0.7, bounded 0.45–2.2). Terrain, friendly support, and defense posts still influence priorities. Enemy-specific tests verify reproducible uneven flanks and incremental captures with unchanged casualty costs. This is an intentional globe adaptation, not exact OpenFront simulation parity.
- Unit appearance, positions, and walker synchronization reuse results between simulation ticks when the camera is stationary. Camera rotation, viewport height, unit lifecycle changes, and simulation ticks invalidate the reused work; effects and target rings still animate each frame. The browser fixture verifies 60 unchanged frames perform zero repeated unit-material checks and both camera and tick changes refresh them.
- 46 automated tests pass. The production 100-player higher-resolution soak ran 1,800 additional ticks with no ownership mismatches or browser/WebGL errors; simulation p95 was 3.9 ms, maximum 11 ms in the first sample. Visual fixtures pass at 0°, 75°, 85°, and −85°, including the rendered upright-icon check. Results are local samples, not a guarantee for every device or late-game match.

Isolated production rerun: mean frame time 16.67 ms (about 60 FPS), p95 16.7 ms; simulation p95 3.7 ms and maximum 10.2 ms. This sustains the earlier 60 FPS sample while doubling map cells; it does not establish an FPS increase beyond the display refresh cap.

## Building density, upgrades, and worldwide regions

- Replaced the US-only administrative overlay with 4,596 Natural Earth admin-1 features, simplified into a 5.9 MB local asset. Regions are clipped to existing national coastlines/borders and gaps flood only within their parent country; water is preserved. The production map contains 85 Russian, 31 Chinese, 13 Canadian, 27 Brazilian, 8 Australian, and 51 US subdivisions with playable pixels. Small or unsampled regions may disappear at this resolution; countries without subdivisions retain their original geography. These are state/province-level regions, not every city or a verbatim OpenFront map.
- Placement snaps to the nearest owned matching building within a small surface-scaled radius, including across the date line and near the poles. Repeating a build upgrades the same unit, retaining the level badge. Existing upgradeable types retain their level limits; Defense Posts are non-upgradeable, as in current upstream. Build-bar prepayment is reconciled against the upgrade price; unfinished, demolition-pending and maximum-level units cannot consume another upgrade purchase. The ghost snaps to the actual structure, and upgrades no longer preview a new railway station.
- City population capacity, factory/train output, port traffic, SAM capacity/range, and silo targeting retain level-based effects. Radar upgrades now expand radar coverage; rail/economic and visual caches are refreshed after upgrades. Tiny-region capture bonuses now scale with area so adding thousands of boundaries does not multiply fixed rewards.
- Following upstream StructurePass's icon/dot zoom modes, icons smaller than 18 projected pixels become compact owner-colored markers. Same-owner markers merge in 8-screen-pixel cells; full icons and levels return on zoom-in. Overview markers are one GPU draw call. In a 500-building browser fixture, 130 compact markers replace 500 full icons and the entire fixture renders in four draw calls. Camera motion/resize and simulation updates refresh the overview.
- 52 tests pass, including upgrade cost/capacity, prepayment refunds, polar snapping, invalid upgrades, subdivision clipping/water/gaps, reward scaling and marker grouping. Production build and 100-player gameplay/ownership checks pass. Polar visual fixtures and actual rendered icon orientation checks pass.

Final loader validation also removes the temporary full GameMap allocation previously used only for terrain cleanup. Final 100-player sample: 1,800 additional ticks, zero ownership mismatches, no browser/WebGL errors, simulation p95 4.5 ms / maximum 8.8 ms. Rendering measured about 30 FPS in this run (earlier runs varied from about 21–54 FPS), so no overall FPS increase is claimed from this change; the verified optimization is the building-marker draw-call reduction.

## Readable gameplay regions and border hierarchy

The full administrative overlay is now an input to fixed gameplay-region grouping. Countries under 100,000 km² stay whole. Other countries target at most one region per 150,000 km² (minimum two); adjacent regions under 50,000 km² are merged where possible. Shared-border length and area guide deterministic merges, retaining national boundaries and avoiding joins across water for large countries. Disconnected islands can remain exceptions to the target count. Area uses spherical latitude weights, so thresholds are independent of map resolution. Merged names explicitly say “region” rather than implying unchanged official province boundaries.

Verified production counts: Turkey 6, Belgium 1, Russia 60, China 28, Canada 12, Brazil 23, Australia 7, US 43. Country parent IDs preserve original national identity for rendering. Baked terrain alpha distinguishes national and regional borders without adding fragment texture lookups. National borders retain 0.65 strength; regional strength smoothly fades from 0.48 near the surface to zero at altitude 83. Hovered neutral regions get a clearer warm highlight. Zoom never changes capture regions or ownership.

56 tests and production build pass. Added tests cover grouping connectivity, national/water preservation, small-country consolidation, large-province retention, determinism, resolution/latitude scaling, and border fading. The production 100-player soak had zero ownership mismatches and no browser/WebGL errors; simulation p95 4.9 ms, maximum 11.3 ms in this run. Close and distant Turkey screenshots were inspected; browser uniform checks confirm regional borders disappear while national borders remain. Overall FPS was variable, so no new FPS gain is claimed.

## Neutral-region attacks use the whole shared border

Normal land expansion now seeds every owned border touching the selected neutral gameplay region, with its existing region restriction and movement/casualty budgets. Repeated clicks reinforce the same region's army and refresh newly established fronts. Click handling identifies the selected region directly instead of finding a potentially different region through unrestricted neutral-land search. Enemy all-border behavior and local naval beachheads remain unchanged. Added regressions cover separated fronts in one region, exclusion of neighboring regions, reinforcement refresh, deep-click targeting, and neutral naval isolation. The seam-crossing regression isolates its target region so it does not assume a particular order among randomized competing fronts.

## Troop-limited advance across wide fronts (September 21)

Opening the full neutral-region border exposed an upstream pacing assumption: total capture throughput increased with the entire geometric border, even for a tiny army. AttackExecution now passes a troop-supported front length into the unchanged baseline formula. Each 200 internal troops (20 displayed) supports one reference-map edge, with a one-edge minimum; the limit converts to map resolution using sqrt(tileScale). The full frontier remains eligible, but speed cannot multiply simply because a small army borders a long region. The limit is recalculated after every capture as troops fall, applies to neutral and enemy land advances, and leaves casualty cost per tile unchanged. This is an intentional globe-specific balance adjustment.

62 tests and production build pass. New real-formula tests compare small armies on 40- and 120-cell fronts, ensure their one-second advances remain small, verify larger armies gain substantially more ground, and check resolution scaling and depletion. The 72 baseline upstream formula fixtures still pass.

## Defense Post and SAM coverage

Removed the general 1/12 effect-radius compression from Defense Posts and SAM launchers. At 5792×2896, Defense Posts now have a 23-equatorial-pixel radius (previously 2), and level-1 SAMs have a 57-pixel radius (previously 5); SAM levels and radar bonuses still expand coverage. Hover/placement circles use these same configuration values.

Actual coverage now uses great-circle distances: Defense Post cache updates and border previews visit the spherical disc, while SAM checks cover both fractional in-flight positions and impact sites on the sphere. This fixes narrow east/west protection near the poles despite round visual indicators. Friendly radar coverage also uses spherical distance. Post removal clears coverage using the same disc, preserving overlapping posts. Updated the misleading “within 1 tile” tooltip.

66 automated tests and production build pass, including enlarged radii, scaling, SAM level growth, exact disc enumeration versus brute-force great-circle checks at the seam and both poles, Defense Post removal, and SAM interception of a polar impact site that the old flat-distance check missed.

## Match loading before countdown

The start flow now holds a full-screen pixel-art loader until the selected map, icon atlas, ship/train sprites, fonts, roster placement, AI initialization, starting territory uploads, common per-player structure/vehicle textures, shader compilation and warm-up frames complete. All AI are placed before play; manual human placement remains available during the full countdown. Preparation never calls game.tick, and the frame accumulator resets when the match is revealed. Higher-level/dynamic effects can still create resources later; this is startup preparation, not a promise of no future frame stalls.

Removed automatic full-resolution loading of both worlds from the menu: loading the second world could compete with the newly started match. Failed cached world loads are evicted. Loader progress describes preparation stages (not a time estimate), with a stepped rotating pixel planet, orbiting marker, segmented bar, reduced-motion support and a retry button on failure.

68 tests and production build pass. A 100-player production browser check observed ticks=0 and no unspawned AI when the loader disappeared. The loaded sample averaged 16.67 ms/frame (~60 FPS); the 1,800-tick soak had p95 3.5 ms and maximum 10.3 ms, zero ownership mismatches, and no browser/WebGL errors. The loading screenshot was visually inspected. Results remain device- and match-dependent.

## Opening pace, surface ranges, and missile salvos (September 21)

Land advance now has a troop-dependent throughput ceiling that ramps from 30% to 100% over the first 90 combat seconds. Occupation costs have a terrain-adjusted floor of 60 internal troops per reference-map surface tile, equally for humans and bots. Both cost and pacing retain resolution/latitude conversion; each capture spends troops and recalculates the next capture's pace. Reinforcement cannot release a large bank of movement credit at once. This supersedes earlier notes that occupation costs were unchanged. The 72 upstream baseline fixtures still pass, but live gameplay deliberately applies these additional balance rules.

Range fill and outline vertices now sit on radius 100.015, following the globe instead of a raised tangent plane. Radial tessellation keeps filled circles close to the surface across their full area, with terrain depth testing and building icons in front. Placement and selected-unit range previews share this geometry.

Missile launches no longer fly the camera to the origin silo. The planner accepts up to 20 land targets, previews their outer blast areas, and supports undo before launch. Launching prepays the whole salvo and uses ready, completed, in-range silos; remaining orders wait for cooldowns. Cancelling refunds only unlaunched orders. Orders whose silos become unavailable are refunded with a notice. Normal-play silo requirements remain intact; the existing developer-mode single-launch cheat is unchanged.

All 73 tests and the production build pass. Regression coverage includes troop depletion over a sustained advance, opening pace, silo requirements/range/reloads, invalid-plan charging, cancellation, and destroyed-silo refunds. Production browser checks exercise target marking, salvo launch/cancellation, and unchanged camera position for both single and queued launches, with no browser errors. Surface geometry checks and inspected images cover 0°, 75°, 85°, and −85°; the separate dense-building fixture still uses four draw calls. A short production frame sample averaged 16.67 ms (~60 FPS), not a guarantee for every match or device.

## Multiplayer implementation (September 21)

Added a Node WebSocket match server, server-side order validation and simulation, account registration/login with salted password hashes, revocable sessions, public/private lobbies, loading readiness, deterministic command/tick replay, reconnect catch-up, and server-derived completed-match rankings. UI actions now route through the online command transport, including diplomacy, ratios, retreat, construction, upgrades, patrols and missile salvos. Build selection no longer mutates a network client's gold; the server charges accepted placement. Pause/speed/developer controls cannot affect online matches. Unit and initialized attack IDs are scoped to each game to preserve replay identity; AI emoji targeting no longer changes its random sequence with the viewing player.

Online Earth uses a version-hashed bundled 2048×1024 map, retaining the same world geography and rules at reference scale, with six nations and four bots plus up to eight humans. Default capacity is one active room, chosen for free-tier memory limits. The countdown waits for all browsers to initialize. Browser reload reconnects replay the active match; server restarts cancel active games without rankings. PostgreSQL persists completed records; local SQLite is for development only and production refuses to start without a database URL. Wins rankings include public matches lasting at least five minutes; private matches still appear in history.

A two-browser production-build test created separate accounts, joined the same room, synchronized a worker ratio and attack order, verified server checksums, then reloaded one browser and caught up to the live match with no browser errors. Public deployment and a real hosted PostgreSQL connection remain unverified until accounts/environment variables are connected. Deployment instructions document free-tier limits and remaining features (account recovery, observer-only joins, distributed servers, and collusion prevention).

Final verification: 80 automated tests pass, along with frontend build and server TypeScript checks. The two-browser test also verified surrender returns to the lobby without rejoining the forfeited match. The existing single-player browser check passes with the 5792×2896 map, all AI prepared before tick zero, and no browser/WebGL errors. A local frame sample averaged 16.67 ms (~60 FPS). SQLite persistence was tested across reopen, and failed result writes roll back without partial awards. Hosted PostgreSQL and public deployment still require configuration.

## 2026-09-21 — online matchmaking and custom worlds

Random Match, Quick Play and the featured card now join real server-managed queues. Main-menu badges poll actual connected queue players and public custom lobbies. Random rooms choose a shared rules preset and count down from 30 seconds once two players join; departures below two reset the timer. Waiting rooms show every connected player, readiness, host and rules. Custom rooms have a separate browser, saved World Forge selection (up to 2048px), bounded settings, private codes and a five-second ready countdown. Generated maps are built in a server worker, hashed, and downloaded identically by all clients. Custom matches are unranked; waiting hosts transfer ownership on departure.

Validation: 91 tests passed, server type-check and production build passed. A three-browser test verified live menu counts, queue sharing, countdown reset, synchronized random play, public custom discovery, custom map/palette transfer and synchronized custom play with selected gold income. No browser errors. Temporary verification accounts were removed. Vercel production deployment dpl_J5hBAgH7Jahm8vNTPnhdhk6nqpXq completed at https://borderwars.vercel.app. Public matchmaking still needs a deployed match server and VITE_MULTIPLAYER_URL; the Vercel project had no production environment variables at deployment. Local server is connected to Neon.

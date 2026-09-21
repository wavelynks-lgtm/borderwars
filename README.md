# BorderWars — a FrontWars.io clone on a 3D globe

A single-player, browser-based real-time territory game in the spirit of
[FrontWars.io](https://frontwars.io) / [OpenFront.io](https://openfront.io), with one twist:
instead of a flat pixel map you fight on a rotatable **3D Earth** where every country is
mapped from Natural Earth data. AI nations are literal countries that spawn in their homeland.

The simulation is a from-scratch reimplementation of the FrontWars rules (tile spreading,
troop economy, buildings, boats, nukes, alliances, AI personalities) — see *Mechanics* below.

## Run it

```sh
npm install
npm run assets   # downloads the free map data into public/data (run once)
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
```

## Review and validation

See [the project review](docs/PROJECT_REVIEW.md) for the globe adaptations, measured performance improvements, validation, and remaining work. Run `npm test` with Node 22.14+ for regression tests.

## Controls

| Action | Input |
| --- | --- |
| Rotate / zoom globe | drag / mouse wheel |
| Choose spawn (spawn phase) | click on land (click again to move) |
| Attack | left-click land adjacent to your border (neutral or enemy) |
| Send a boat | left-click a coast that is *not* adjacent to you (max 3 boats) |
| Build menu / upgrade | right-click your own territory |
| Player panel (alliance, donate, attack, emoji) | right-click enemy territory, click a leaderboard row, or Alt+click |
| Attack ratio | slider, keys `1` / `2`, or Shift + wheel |
| Troops / workers split | slider in the bottom-left panel |
| Terrain view | hold `Space` |
| Fly home | `H` |
| Pause | `P` |
| FPS / simulation timing | `F3` |
| Sim speed | `[` / `]` |
| Close panels / cancel nuke targeting | `Esc` |

## Mechanics (what was cloned)

- **World**: an equirectangular 5792×2896 tile grid wrapped on a sphere. Every tile has terrain
  (water / plains / highland / mountain / impassable ice) and an owner. Countries are rasterized
  from Natural Earth polygons, so borders, names and AI spawns are the real ones.
- **Spreading**: connected, four-neighbour frontier expansion with terrain, friendly support and seeded resistance patches.
  East/west travel accounts for latitude. Attacks accumulate fractional movement credit, pay for each
  captured tile, and open every shared border with the selected neutral region. Different neutral-region attacks remain separate; enemy invasions span all shared borders with that opponent.
  Opposing attacks cancel out; retreat returns survivors minus 25% against enemies. Only tiny adjacent
  remnants qualify for cleanup annexation.
- **Globe area**: victory, population capacity, country rewards and combat use latitude-weighted land
  area so polar pixels do not count as much as equatorial ones. Troop density and pacing are normalized
  for map resolution. Defense and SAM coverage use spherical distances, and range previews follow the globe surface.
- **Economy**: population = troops + workers, with growth stopping at the shared capacity. Cities add
  capacity. The worker slider trades military strength for gold: 40% workers keeps base income,
  with a bounded 0.25×–1.75× workforce multiplier. Factories and docks earn additional income through trade.
- **Buildings**: City (pop cap, upgradable), Defense Post, Port (trade ships sail between ports for gold, enables
  Warships), Missile Silo (Atom 750k / Hydrogen 5M, 90-tick cooldown), SAM Launcher (intercepts). Costs scale
  with how many you own. Structures on captured land change hands; defense posts are destroyed.
- **Boats**: transports carry troops along a water path (A* on a coarse grid) and land as a beachhead attack.
  Warships patrol around their port and sink enemy transports / trade ships.
- **Nukes**: clear ownership on tiles in the inner radius, probabilistically up to the outer radius, kill `5·troops/tiles`
  per tile, destroy units, leave fallout (or flood terrain when enabled), break alliances and wreck relations.
- **Diplomacy**: alliance requests (5-minute alliances, extendable), donations, betrayal → traitor for 30 s
  (defence halved), relations −100..100 that decay to neutral, embargo on attack, emoji quick chat.
- **AI**: *Nations* roll a personality (decision cadence by difficulty, reserve / trigger / expand ratios,
  aggression) and each decision: expand into neutral land, random boat raids, alliance requests to strong
  neighbours, pick a target (who attacks us → hostile → weakest neighbour), build cities / posts / ports /
  silos / SAMs, launch nukes at threats, accept or reject alliances by relation. *Bots* are grey tribes that
  expand, retaliate and squabble.
- **Win**: hold 80% of the land (configurable in the menu).

## Project layout

- `src/core` — pure simulation: `Config` (all formulas), `GameMap`, `Game`, `Player`, `Unit`, `executions/`
  (attack, transport, nuke, warship, port/trade), `ai/` (NationAI, BotAI), `WaterPathfinder`, `actions`.
- `src/map` — `MapBuilder` + `raster` (scanline rasterization of TopoJSON, antimeridian-aware), `geo`.
- `src/render` — `GlobeRenderer` (three.js sphere + custom shader compositing terrain, country borders,
  territory, fallout, hover), `UnitLayer`, `Labels`.
- `src/ui` — menu, HUD, panels; `src/app` — game loop, input, setup.

## Data & licences

- `public/data/countries-50m.json` — [world-atlas](https://github.com/topojson/world-atlas) (ISC), built from
  [Natural Earth](https://www.naturalearthdata.com/) 1:50m Admin 0 countries (public domain).
- `public/data/earth-water.png`, `earth-topology.png`, `earth-dark.jpg` — example textures from
  [three-globe](https://github.com/vasturiano/three-globe) (MIT).
- Code dependencies: [three.js](https://threejs.org) (MIT), [topojson-client](https://github.com/topojson/topojson-client) (ISC).

The game rules were studied from the AGPL-licensed OpenFront.io source, but this project contains no code from it.

## Globe rendering and natural fronts

Terrain, ownership, and picking share a latitude-adaptive display grid. Surface cells have approximately equal width and height, including near the poles. Perspective foreshortening and small band transitions remain; this does not replace the native simulation raster with a true equal-area spherical grid.

Expansion combines terrain, friendly support, defensive positions, seeded pixel variation, and coherent resistance patches. It favors different flanks instead of imposing a diamond or uniform circular front. Trains follow their actual rail path with distance-based carriage spacing; ships and trains account for latitude when moving.

Ship and train PNGs and HUD/building SVGs are OpenFront assets, licensed CC BY-SA 4.0 with attribution in `src/assets/`. Rails use globe surface geometry, so this renderer is an adaptation, not pixel-identical to the flat OpenFront renderer. See [the review](docs/PROJECT_REVIEW.md) for verification and remaining limitations.

The underlying combat formulas are checked against 72 upstream OpenFront numerical scenarios. Gameplay adds globe-specific pacing: the first 90 seconds are slower, troop strength limits capture throughput, and occupation costs reduce the advancing army after each capture. Enemy advances retain a further speed reduction.

Missiles require a completed silo in normal play. Select a missile and click land for a single launch, or choose **Mark multiple targets**, click up to 20 target areas, then **Launch salvo**. Surface rings preview each target's outer blast radius. Queued shots wait for silos to reload; **Cancel remaining & refund** returns payment for unlaunched shots. Launching leaves the camera in place.

Building placement snaps to nearby matching upgradeable structures; repeat placement raises the level rather than adding another icon. Distant structures use batched compact markers, returning to full icons and level badges when zoomed in. Earth groups worldwide state/province boundaries from Natural Earth into readable gameplay regions. Small countries stay whole; neighboring tiny provinces merge. National borders remain visible while internal borders fade at distant zoom. Start a new match after reloading to use updated geography.

## Multiplayer

**Play Online** opens authenticated public/private lobbies for up to eight players, with server-controlled matches, reconnects, saved match history and a global wins leaderboard. Run `npm run server` alongside the frontend to try it locally. The online Earth uses a shared 2048×1024 raster to fit free-tier server memory; single-player retains its higher resolution. Players and AI now start with zero troops/workers and recruit after the countdown (except the explicit infinite-troops cheat).

The frontend can stay on Vercel. Public online play additionally needs a deployed Node match server and PostgreSQL database. Deployment files and exact environment settings are in [the multiplayer guide](docs/MULTIPLAYER.md). This source is prepared for Render's free server tier plus an external free PostgreSQL provider; public service credentials and hosting setup are not included.

## Personalization, World Forge, and store

**Customize** selects a flag, territory colors and a surface pattern. **World Forge** generates fictional spherical worlds with configurable land layout, water, mountains, ice, countries and palettes. Save/load recipes locally, import/export them, and start a solo match. **Store** prepares one-time ad removal and cosmetic Supporter perks; purchases and menu ads remain off until provider accounts are configured. See [the customization and monetization guide](docs/CUSTOMIZATION_AND_COMMERCE.md) for setup, tests and hosting requirements.

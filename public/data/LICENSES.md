# Data licences

- `countries-50m.json` — from the `world-atlas` npm package (ISC), derived from Natural Earth 1:50m Admin 0 countries. Natural Earth data is in the public domain.
- `earth-water.png`, `earth-topology.png`, `earth-dark.jpg` — example textures from the `three-globe` project (MIT licence, Vasco Asturiano).

Run `npm run assets` to (re)download them.

- `admin1.json` — 4,596 worldwide state/province features from [Natural Earth admin-1](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_10m_admin_1_states_provinces.geojson), public domain. Prepared with `scripts/prepare-regions.py`: redundant properties removed, boundaries simplified at 0.012 degrees and coordinates rounded to 0.001 degrees. Existing country coastlines and borders clip the overlay. Dataset snapshot downloaded September 20, 2026; boundaries are game geography, not a live administrative registry.

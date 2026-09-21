#!/bin/sh
# Downloads the free map data used by the game into public/data.
# - world-atlas (Natural Earth 1:50m countries, public domain data, ISC package)
# - three-globe example textures (MIT): water mask, elevation (topology), dark earth base
set -e
cd "$(dirname "$0")/.."
mkdir -p public/data
fetch() {
  if [ -s "public/data/$2" ]; then echo "have $2"; return; fi
  echo "fetching $2"
  curl -sSL "$1" -o "public/data/$2"
}
fetch "https://unpkg.com/world-atlas@2.0.2/countries-50m.json" countries-50m.json
fetch "https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json" us-states.json
fetch "https://unpkg.com/three-globe@2.45.2/example/img/earth-water.png" earth-water.png
fetch "https://unpkg.com/three-globe@2.45.2/example/img/earth-topology.png" earth-topology.png
fetch "https://unpkg.com/three-globe@2.45.2/example/img/earth-dark.jpg" earth-dark.jpg
echo "done"

if [ ! -s public/data/admin1.json ]; then
  region_source=$(mktemp)
  trap 'rm -f "$region_source"' EXIT
  curl -fLsS https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson -o "$region_source"
  python3 scripts/prepare-regions.py "$region_source"
fi

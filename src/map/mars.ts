import { GameMap, type CountryInfo } from "../core/GameMap";
import { TerrainType } from "../core/types";
import { DEFAULT_MAP_OPTIONS, type MapBuildOptions } from "./MapBuilder";

/** Named Mars regions — Voronoi colonies, polar ice excluded from play. */
export const COLONIES: { name: string; lat: number; lon: number }[] = [
  { name: "Olympus Mons", lat: 18.65, lon: -133.8 },
  { name: "Tharsis", lat: 1.5, lon: -112.0 },
  { name: "Arsia Mons", lat: -8.4, lon: -120.5 },
  { name: "Pavonis Mons", lat: 0.8, lon: -113.4 },
  { name: "Ascraeus Mons", lat: 11.3, lon: -104.5 },
  { name: "Valles Marineris", lat: -13.9, lon: -59.2 },
  { name: "Noctis Labyrinthus", lat: -7.0, lon: -102.2 },
  { name: "Hellas", lat: -42.4, lon: 70.5 },
  { name: "Argyre", lat: -49.7, lon: -43.0 },
  { name: "Elysium", lat: 25.0, lon: 147.0 },
  { name: "Amazonis", lat: 15.0, lon: -158.0 },
  { name: "Arcadia", lat: 45.0, lon: -170.0 },
  { name: "Acidalia", lat: 47.0, lon: -22.0 },
  { name: "Utopia", lat: 47.0, lon: 118.0 },
  { name: "Arabia Terra", lat: 20.0, lon: 30.0 },
  { name: "Terra Sabaea", lat: 2.0, lon: 42.0 },
  { name: "Syrtis Major", lat: 8.4, lon: 69.5 },
  { name: "Isidis", lat: 12.9, lon: 87.0 },
  { name: "Chryse", lat: 27.0, lon: -40.0 },
  { name: "Xanthe", lat: 2.0, lon: -48.0 },
  { name: "Lunae Planum", lat: 10.0, lon: -65.0 },
  { name: "Tempe Terra", lat: 40.0, lon: -70.0 },
  { name: "Terra Cimmeria", lat: -35.0, lon: 145.0 },
  { name: "Terra Sirenum", lat: -40.0, lon: -150.0 },
  { name: "Noachis", lat: -45.0, lon: 10.0 },
  { name: "Promethei", lat: -58.0, lon: 100.0 },
  { name: "Aonia", lat: -55.0, lon: -95.0 },
  { name: "Vastitas Borealis", lat: 62.0, lon: 30.0 },
];

function hash2(x: number, y: number): number {
  let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function bump(lat: number, lon: number, clat: number, clon: number, sigma: number): number {
  const dlat = lat - clat;
  let dlon = lon - clon;
  if (dlon > 180) dlon -= 360;
  if (dlon < -180) dlon += 360;
  const k = Math.cos(((lat + clat) * 0.5 * Math.PI) / 180);
  const d2 = dlat * dlat + dlon * k * (dlon * k);
  return Math.exp(-d2 / (2 * sigma * sigma));
}

function canyon(lat: number, lon: number): number {
  if (lat > -4 || lat < -16 || lon < -105 || lon > -25) return 0;
  const along = (lon + 100) / 70;
  const centerLat = -9 - along * 3;
  const d = Math.abs(lat - centerLat);
  if (d > 3.5) return 0;
  return (1 - d / 3.5) * 55;
}

function fbm(lat: number, lon: number): number {
  const x = ((lon + 180) * 8) | 0;
  const y = ((lat + 90) * 8) | 0;
  let n = 0;
  let a = 1;
  let f = 1;
  for (let i = 0; i < 4; i++) {
    n += (hash2(x * f, y * f) - 0.5) * a;
    a *= 0.5;
    f *= 2;
  }
  return n;
}

/** Elevation 0..255 plus ice / dust-sea flags for a lat/lon. */
export function sampleMars(lat: number, lon: number): { elev: number; ice: boolean; sea: boolean } {
  let e = 108 - lat * 0.38;
  e += bump(lat, lon, 18.65, -133.8, 5) * 90;
  e += bump(lat, lon, 11.3, -104.5, 4) * 55;
  e += bump(lat, lon, 0.8, -113.4, 4) * 50;
  e += bump(lat, lon, -8.4, -120.5, 4) * 52;
  e += bump(lat, lon, 25.0, 147.2, 8) * 40;
  e -= bump(lat, lon, -42.3, 70.5, 14) * 75;
  e -= bump(lat, lon, -49.7, -43, 8) * 50;
  e -= bump(lat, lon, 12.9, 87.0, 6) * 35;
  e -= canyon(lat, lon);
  e += fbm(lat, lon) * 22;
  const elev = Math.max(0, Math.min(255, e));
  const ice = lat > 78 || lat < -80;
  const sea =
    !ice &&
    ((lat > 32 && elev < 72) ||
      bump(lat, lon, -42.3, 70.5, 12) > 0.45 ||
      bump(lat, lon, -49.7, -43, 7) > 0.5 ||
      bump(lat, lon, 12.9, 87, 5) > 0.55);
  return { elev, ice, sea };
}

function lonDist(a: number, b: number): number {
  let d = Math.abs(a - b);
  if (d > 180) d = 360 - d;
  return d;
}

function dist2(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dlat = lat1 - lat2;
  const dlon = lonDist(lon1, lon2);
  const k = Math.cos(((lat1 + lat2) * 0.5 * Math.PI) / 180);
  return dlat * dlat + dlon * k * (dlon * k);
}

export function nearestColony(lat: number, lon: number): number {
  let best = 1;
  let bestD = Infinity;
  for (let i = 0; i < COLONIES.length; i++) {
    const c = COLONIES[i];
    const d = dist2(lat, lon, c.lat, c.lon);
    if (d < bestD) {
      bestD = d;
      best = i + 1;
    }
  }
  return best;
}

function yieldFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

export async function buildMars(opts: Partial<MapBuildOptions> = {}): Promise<GameMap> {
  const o = { ...DEFAULT_MAP_OPTIONS, highlandMin: 100, mountainMin: 165, ...opts };
  const W = o.width;
  const H = o.height;
  const progress = o.onProgress ?? (() => {});
  progress("Raising Olympus Mons…");
  await yieldFrame();

  const terrain = new Uint8Array(W * H);
  const country = new Uint16Array(W * H);
  const elev = new Uint8Array(W * H);
  const countries: CountryInfo[] = [{ id: 0, name: "", centroid: -1, tiles: 0, lat: 0, lon: 0 }];
  COLONIES.forEach((c, i) => {
    countries.push({ id: i + 1, name: c.name, centroid: -1, tiles: 0, lat: c.lat, lon: c.lon });
  });

  progress("Splitting the colonies…");
  for (let y = 0; y < H; y++) {
    if ((y & 63) === 0) {
      progress(`Splitting the colonies… ${((y / H) * 100) | 0}%`);
      await yieldFrame();
    }
    const lat = 90 - ((y + 0.5) * 180) / H;
    for (let x = 0; x < W; x++) {
      const lon = ((x + 0.5) * 360) / W - 180;
      const t = y * W + x;
      const s = sampleMars(lat, lon);
      elev[t] = s.elev;
      if (s.ice) {
        terrain[t] = TerrainType.Impassable;
        country[t] = 0;
        continue;
      }
      country[t] = nearestColony(lat, lon);
      if (s.sea) {
        terrain[t] = TerrainType.Water;
      } else if (s.elev >= o.mountainMin) {
        terrain[t] = TerrainType.Mountain;
      } else if (s.elev >= o.highlandMin) {
        terrain[t] = TerrainType.Highland;
      } else {
        terrain[t] = TerrainType.Plains;
      }
    }
  }

  progress("Carving dust seas…");
  await yieldFrame();
  const landSeed = new Int32Array(countries.length).fill(-1);
  const map = new GameMap(W, H, terrain, country, countries);
  map.elevation = elev;
  map.world = "mars";
  for (let t = 0; t < terrain.length; t++) {
    if ((t & 0x7ffff) === 0) await yieldFrame();
    if (map.isLand(t)) {
      const cid = country[t];
      countries[cid].tiles++;
      if (landSeed[cid] < 0) landSeed[cid] = t;
    }
  }
  for (const c of countries) {
    if (c.id === 0) continue;
    let tile = map.latLonToTile(c.lat, c.lon);
    if (!map.isLand(tile) || map.country[tile] !== c.id) {
      tile = landSeed[c.id] >= 0 ? landSeed[c.id] : map.nearestLand(tile, map.tiles(24));
    }
    c.centroid = tile;
  }
  progress("Mars ready");
  return map;
}

import { groupRegions } from "./regionGrouping";
import { splitRegions, type RegionFeature } from "./subdivisions";
import * as topojson from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { FeatureCollection, MultiPolygon, Polygon, Position } from "geojson";
import { GameMap, type CountryInfo } from "../core/GameMap";
import { TerrainType } from "../core/types";
import { Rasterizer, largestRingCentroid, type CountryFeature } from "./raster";

export interface MapBuildOptions {
  width: number;
  height: number;
  /** elevation (0..255) thresholds */
  highlandMin: number;
  mountainMin: number;
  onProgress?: (msg: string) => void;
}

/**
 * 5792×2896: approximately twice the cells of 4096×2048, keeping 2:1 geometry.
 */
export const DEFAULT_MAP_OPTIONS: MapBuildOptions = {
  width: 5792,
  height: 2896,
  highlandMin: 58,
  mountainMin: 110,
};

function yieldFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

/** Double total cells, rather than quadrupling memory by doubling both axes. */
export function detectMapSize(): { width: number; height: number } {
  return { width: 5792, height: 2896 };
}

const DATA = "/data/";

async function loadImageGray(url: string, w: number, h: number): Promise<Uint8ClampedArray> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to load ${url}`);
  const bmp = await createImageBitmap(await res.blob());
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bmp, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h).data;
  const out = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = img[j];
  bmp.close();
  return out;
}

async function loadCountries(): Promise<CountryFeature[]> {
  const res = await fetch(DATA + "countries-50m.json");
  if (!res.ok) throw new Error("failed to load countries");
  const topo = (await res.json()) as Topology<{ countries: GeometryCollection<{ name: string }> }>;
  const fc = topojson.feature(topo, topo.objects.countries) as FeatureCollection<
    Polygon | MultiPolygon,
    { name: string }
  >;
  return fc.features.filter(
    (f) => f.geometry && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon"),
  ) as CountryFeature[];
}

function wrapLon(lon: number): number {
  let x = lon;
  while (x <= -180) x += 360;
  while (x > 180) x -= 360;
  return x;
}

function wrapFeature(f: CountryFeature): CountryFeature {
  const wrapPoly = (poly: Position[][]) => poly.map((ring) => ring.map((p) => [wrapLon(p[0]), p[1]] as Position));
  if (f.geometry.type === "Polygon") {
    return { ...f, geometry: { type: "Polygon", coordinates: wrapPoly(f.geometry.coordinates) } };
  }
  return {
    ...f,
    geometry: { type: "MultiPolygon", coordinates: f.geometry.coordinates.map(wrapPoly) },
  };
}

async function loadRegions(): Promise<RegionFeature[]> {
  const res = await fetch(DATA + "admin1.json");
  if (!res.ok) throw new Error("Failed to load states and provinces");
  const data = await res.json() as { features: RegionFeature[] };
  return data.features;
}

export async function buildMap(opts: Partial<MapBuildOptions> = {}): Promise<GameMap> {
  const o = { ...DEFAULT_MAP_OPTIONS, ...opts };
  const W = o.width;
  const H = o.height;
  const progress = o.onProgress ?? (() => {});

  progress("Loading country borders…");
  const [features, water, elev, regions] = await Promise.all([
    loadCountries(),
    loadImageGray(DATA + "earth-water.png", W, H),
    loadImageGray(DATA + "earth-topology.png", W, H),
    loadRegions(),
  ]);

  progress("Rasterizing countries…");
  const country = new Uint16Array(W * H);
  const raster = new Rasterizer(W, H);
  const countries: CountryInfo[] = [{ id: 0, name: "", centroid: -1, tiles: 0, lat: 0, lon: 0 }];
  let antarcticaId = 0;
  features.forEach((f, idx) => {
    const id = idx + 1;
    const name = f.properties?.name ?? `Region ${id}`;
    if (name === "Antarctica") antarcticaId = id;
    const c = largestRingCentroid(f);
    countries.push({ id, name, centroid: -1, tiles: 0, lat: c.lat, lon: c.lon });
    raster.rasterize(f, id, country);
  });
  progress("Splitting states and provinces worldwide…");
  await splitRegions(country, countries, regions, W, H, yieldFrame);

  progress("Building terrain…");
  const terrain = new Uint8Array(W * H);
  const landSeed = new Int32Array(countries.length).fill(-1);
  for (let i = 0; i < terrain.length; i++) {
    if ((i & 0x7ffff) === 0) {
      progress(`Building terrain… ${((i / terrain.length) * 100) | 0}%`);
      await yieldFrame();
    }
    const cid = country[i];
    if (cid === 0) {
      terrain[i] = TerrainType.Water;
      continue;
    }
    if (cid === antarcticaId) {
      terrain[i] = TerrainType.Impassable;
      continue;
    }
    if (water[i] > 140) {
      terrain[i] = TerrainType.Water;
      continue;
    }
    const e = elev[i];
    terrain[i] =
      e >= o.mountainMin ? TerrainType.Mountain : e >= o.highlandMin ? TerrainType.Highland : TerrainType.Plains;
  }
  progress("Grouping small provinces into readable regions…");
  groupRegions(country, terrain, countries, W, H);
  await yieldFrame();
  // remove 1-tile water specks inside land (mask noise) and 1-tile land specks in water
  const buf: number[] = [0, 0, 0, 0];
  // Cleanup needs only terrain and neighbors; do not allocate a second full
  // simulation map (ownership/rail/fallout buffers) during high-resolution loading.
  const isLand = (t: number) => terrain[t] !== TerrainType.Water && terrain[t] !== TerrainType.Impassable;
  for (let t = 0; t < terrain.length; t++) {
    if ((t & 0x7ffff) === 0) await yieldFrame();
    if (terrain[t] !== TerrainType.Impassable) {
      let n = 0;
      const x = t % W;
      if (t >= W) buf[n++] = t - W;
      if (t + W < terrain.length) buf[n++] = t + W;
      buf[n++] = t - x + (x + 1) % W;
      buf[n++] = t - x + (x + W - 1) % W;
      let landN = 0;
      for (let i = 0; i < n; i++) if (isLand(buf[i])) landN++;
      if (terrain[t] === TerrainType.Water && landN === n && country[t] !== 0) {
        terrain[t] = TerrainType.Plains;
      } else if (terrain[t] !== TerrainType.Water && landN === 0) {
        terrain[t] = TerrainType.Water;
      }
    }
    if (isLand(t)) {
      const cid = country[t];
      countries[cid].tiles++;
      if (landSeed[cid] < 0) landSeed[cid] = t;
    }
  }

  const map = new GameMap(W, H, terrain, country, countries);
  map.elevation = new Uint8Array(elev.buffer, elev.byteOffset, elev.length);
  for (const c of countries) {
    if (c.id === 0) continue;
    let t = map.latLonToTile(c.lat, c.lon);
    if (!map.isLand(t) || map.country[t] !== c.id) {
      t = landSeed[c.id] >= 0 ? landSeed[c.id] : map.nearestLand(t, map.tiles(24));
    }
    c.centroid = t;
  }
  map.world = "earth";
  progress("Map ready");
  return map;
}

export function findNearestTileOfCountry(map: GameMap, t: number, cid: number, maxR: number): number {
  const cx = map.x(t);
  const cy = map.y(t);
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const n = map.refWrapped(cx + dx, cy + dy);
        if (n >= 0 && map.isLand(n) && map.country[n] === cid) return n;
      }
    }
  }
  return -1;
}

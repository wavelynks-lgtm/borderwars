import type {WorldRecipe} from "../map/generator";
import { TerrainType, type TileRef, type WorldId } from "./types";

export interface CountryInfo {
  /** Original nation; gameplay regions retain this for border hierarchy. */
  parentId?: number;
  id: number; // 1-based, 0 = none
  name: string;
  /** centroid tile (guaranteed land & passable, or -1) */
  centroid: TileRef;
  tiles: number;
  lat: number;
  lon: number;
}

/**
 * Equirectangular tile grid wrapped around the globe.
 * Row 0 is the north pole edge (lat 90), x wraps at the antimeridian.
 */
export class GameMap {
  readonly width: number;
  readonly height: number;
  readonly terrain: Uint8Array;
  /** owner smallID per tile, 0 = terra nullius */
  readonly owner: Uint16Array;
  readonly country: Uint16Array;
  /** ticks until fallout expires (0 = no fallout) — stored as tick/16 to fit a byte, see hasFallout */
  readonly fallout: Uint8Array;
  readonly countries: CountryInfo[]; // index 0 unused
  numLandTiles: number;
  /** Surface area in equatorial pixel units; longitude pixels shrink toward the poles. */
  landArea = 0;
  readonly rowArea: Float64Array;
  readonly dirtyRowMinX: Int32Array;
  readonly dirtyRowMaxX: Int32Array;
  /** tiles per "reference tile" of the 2048-wide grid the balance numbers were tuned on */
  readonly scale: number;
  /** raw elevation 0..255 (rendering only) */
  elevation: Uint8Array | null = null;
  numFalloutTiles = 0;
  /** terrain palette / atmosphere */
  world: WorldId = "earth";
  generated?: WorldRecipe;

  /**
   * per-tile render flags maintained by the game: bit3 (8) = territory border,
   * bit4 (16) = border reinforced by a Defense Post. Bits 0-2 are used by fallout / fronts.
   */
  readonly flags: Uint8Array;
  /** 0 = none, 1=NS, 2=EW, 3=NW, 4=NE, 5=SW, 6=SE, 7=cross — packed into owner tex A */
  readonly railType: Uint8Array;

  /** set whenever owner/fallout/flags change; renderer clears it */
  dirty = false;
  /** row range touched since the last renderer sync */
  dirtyMinY = 0;
  dirtyMaxY = 0;
  /** column span of dirty tiles (inclusive) */
  dirtyMinX = 0;
  dirtyMaxX = 0;
  /** 1 for every row touched since the last sync (renderer clears rows as it uploads them) */
  readonly dirtyRows: Uint8Array;

  markDirty(t: TileRef): void {
    const w = this.width;
    const x = t % w;
    const y = (t / w) | 0;
    this.dirtyRows[y] = 1;
    this.dirtyRowMinX[y] = Math.min(this.dirtyRowMinX[y], x);
    this.dirtyRowMaxX[y] = Math.max(this.dirtyRowMaxX[y], x);
    if (!this.dirty) {
      this.dirty = true;
      this.dirtyMinY = y;
      this.dirtyMaxY = y;
      this.dirtyMinX = x;
      this.dirtyMaxX = x;
    } else {
      if (y < this.dirtyMinY) this.dirtyMinY = y;
      if (y > this.dirtyMaxY) this.dirtyMaxY = y;
      if (x < this.dirtyMinX) this.dirtyMinX = x;
      if (x > this.dirtyMaxX) this.dirtyMaxX = x;
    }
  }
  clearDirty(): void {
    this.dirty = false;
  }

  constructor(
    width: number,
    height: number,
    terrain: Uint8Array,
    country: Uint16Array,
    countries: CountryInfo[],
  ) {
    this.width = width;
    this.height = height;
    this.terrain = terrain;
    this.country = country;
    this.countries = countries;
    this.scale = width / 2048;
    this.owner = new Uint16Array(width * height);
    this.fallout = new Uint8Array(width * height);
    this.flags = new Uint8Array(width * height);
    this.railType = new Uint8Array(width * height);
    this.dirtyRows = new Uint8Array(height);
    this.dirtyRowMinX = new Int32Array(height).fill(width);
    this.dirtyRowMaxX = new Int32Array(height).fill(-1);
    this.rowArea = Float64Array.from({ length: height }, (_, y) => Math.sin(Math.PI * (y + 0.5) / height));
    this.dirty = false;
    this.dirtyMinY = 0;
    this.dirtyMaxY = 0;
    this.dirtyMinX = 0;
    this.dirtyMaxX = 0;
    let land = 0;
    for (let i = 0; i < terrain.length; i++) {
      const t = terrain[i];
      if (t !== TerrainType.Water && t !== TerrainType.Impassable) {
        land++;
        this.landArea += this.rowArea[Math.floor(i / width)];
      }
    }
    this.numLandTiles = land;
  }

  /** convert a distance given in reference tiles (2048-wide grid) to this map's tiles */
  tiles(n: number): number {
    return Math.max(1, Math.round(n * this.scale));
  }

  ref(x: number, y: number): TileRef {
    return y * this.width + x;
  }
  x(t: TileRef): number {
    return t % this.width;
  }
  y(t: TileRef): number {
    return (t / this.width) | 0;
  }
  isValidCoord(x: number, y: number): boolean {
    return y >= 0 && y < this.height && x >= 0 && x < this.width;
  }
  /** wraps x around the antimeridian; returns -1 if y out of range */
  refWrapped(x: number, y: number): TileRef {
    if (y < 0 || y >= this.height) return -1;
    const w = this.width;
    x = ((x % w) + w) % w;
    return y * w + x;
  }

  isValid(t: TileRef): boolean {
    return Number.isInteger(t) && t >= 0 && t < this.terrain.length;
  }
  tileArea(t: TileRef): number {
    return this.rowArea[this.y(t)];
  }
  /** Great-circle distance in equatorial pixel units, for flight times. */
  surfaceDistance(a: TileRef, b: TileRef): number {
    return this.surfaceDistanceXY(a, this.x(b) + .5, this.y(b) + .5);
  }
  /** Distance to a moving unit's fractional map coordinates. */
  surfaceDistanceXY(a: TileRef, x: number, y: number): number {
    const latA = Math.PI * (0.5 - (this.y(a) + 0.5) / this.height);
    const latB = Math.PI * (0.5 - y / this.height);
    const dLon = (x - this.x(a) - .5) * 2 * Math.PI / this.width;
    const h = Math.sin((latB - latA) / 2) ** 2 + Math.cos(latA) * Math.cos(latB) * Math.sin(dLon / 2) ** 2;
    return this.width / Math.PI * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
  }

  /** Visit the exact spherical coverage disc, including seam wrapping and poles. */
  forEachSurfaceTile(center: TileRef, radius: number, visit: (tile: TileRef) => void): void {
    const angle = Math.min(Math.PI, radius * 2 * Math.PI / this.width);
    const lat = Math.PI * (.5 - (this.y(center) + .5) / this.height);
    const rows = Math.ceil(angle * this.height / Math.PI);
    const minY = Math.max(0, this.y(center) - rows), maxY = Math.min(this.height-1, this.y(center)+rows);
    for(let y=minY;y<=maxY;y++) {
      const rowLat = Math.PI * (.5 - (y+.5)/this.height);
      const cosLon = (Math.cos(angle)-Math.sin(lat)*Math.sin(rowLat))/(Math.cos(lat)*Math.cos(rowLat));
      if(cosLon>1+1e-12)continue;
      const span=Math.ceil(Math.acos(Math.max(-1,Math.min(1,cosLon)))*this.width/(2*Math.PI));
      const length=Math.min(this.width,span*2+1);
      for(let i=0;i<length;i++) {
        const tile=this.refWrapped(this.x(center)-span+i,y);
        if(this.surfaceDistance(center,tile)<=radius+1e-8)visit(tile);
      }
    }
  }

  terrainType(t: TileRef): TerrainType {
    return this.terrain[t] as TerrainType;
  }
  isLand(t: TileRef): boolean {
    const v = this.terrain[t];
    return this.isValid(t) && v !== TerrainType.Water && v !== TerrainType.Impassable;
  }
  isWater(t: TileRef): boolean {
    return this.terrain[t] === TerrainType.Water;
  }
  isImpassable(t: TileRef): boolean {
    return this.terrain[t] === TerrainType.Impassable;
  }
  /** land or water but not impassable */
  isPassable(t: TileRef): boolean {
    return this.isValid(t) && this.terrain[t] !== TerrainType.Impassable;
  }
  ownerID(t: TileRef): number {
    return this.owner[t];
  }
  hasOwner(t: TileRef): boolean {
    return this.owner[t] !== 0;
  }
  hasFallout(t: TileRef): boolean {
    return this.fallout[t] !== 0;
  }
  setFallout(t: TileRef, on: boolean): void {
    const was = this.fallout[t] !== 0;
    if (was === on) return;
    this.fallout[t] = on ? 1 : 0;
    this.numFalloutTiles += on ? 1 : -1;
    this.markDirty(t);
  }

  private nbuf: TileRef[] = [0, 0, 0, 0, 0, 0, 0, 0];

  /** 4-neighbours written into `out`; returns count (2..4) */
  neighbors4(t: TileRef, out: TileRef[]): number {
    const w = this.width;
    const x = t % w;
    const y = (t - x) / w;
    let n = 0;
    out[n++] = x === 0 ? t + w - 1 : t - 1;
    out[n++] = x === w - 1 ? t - w + 1 : t + 1;
    if (y > 0) out[n++] = t - w;
    if (y < this.height - 1) out[n++] = t + w;
    return n;
  }

  /** 8-neighbours (wraps longitude). Diagonals keep a 4K flood from growing plains tendrils. */
  neighbors8(t: TileRef, out: TileRef[]): number {
    const w = this.width;
    const x = t % w;
    const y = (t - x) / w;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= this.height) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        let nx = x + dx;
        if (nx < 0) nx += w;
        else if (nx >= w) nx -= w;
        out[n++] = ny * w + nx;
      }
    }
    return n;
  }

  isShore(t: TileRef): boolean {
    if (!this.isLand(t)) return false;
    const n = this.neighbors4(t, this.nbuf);
    for (let i = 0; i < n; i++) if (this.isWater(this.nbuf[i])) return true;
    return false;
  }

  /** squared distance in tile units, accounting for x wrap */
  distSq(a: TileRef, b: TileRef): number {
    const w = this.width;
    let dx = (a % w) - (b % w);
    if (dx < 0) dx = -dx;
    if (dx > w / 2) dx = w - dx;
    const dy = ((a / w) | 0) - ((b / w) | 0);
    return dx * dx + dy * dy;
  }
  dist(a: TileRef, b: TileRef): number {
    return Math.sqrt(this.distSq(a, b));
  }

  // ---- geo conversions ----
  tileToLatLon(t: TileRef): { lat: number; lon: number } {
    const x = this.x(t) + 0.5;
    const y = this.y(t) + 0.5;
    return {
      lon: (x / this.width) * 360 - 180,
      lat: 90 - (y / this.height) * 180,
    };
  }
  latLonToTile(lat: number, lon: number): TileRef {
    let x = Math.floor(((lon + 180) / 360) * this.width);
    let y = Math.floor(((90 - lat) / 180) * this.height);
    x = ((x % this.width) + this.width) % this.width;
    y = Math.max(0, Math.min(this.height - 1, y));
    return this.ref(x, y);
  }
  /** uv (0..1, 0..1 with v=1 at north) → tile */
  uvToTile(u: number, v: number): TileRef {
    let x = Math.floor(u * this.width);
    let y = Math.floor((1 - v) * this.height);
    x = ((x % this.width) + this.width) % this.width;
    y = Math.max(0, Math.min(this.height - 1, y));
    return this.ref(x, y);
  }

  /** find the nearest land (passable) tile to t within maxR (spiral search) */
  nearestLand(t: TileRef, maxR = this.tiles(40)): TileRef {
    if (this.isLand(t)) return t;
    const cx = this.x(t);
    const cy = this.y(t);
    for (let r = 1; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const n = this.refWrapped(cx + dx, cy + dy);
          if (n >= 0 && this.isLand(n)) return n;
        }
      }
    }
    return -1;
  }

  countryAt(t: TileRef): CountryInfo | null {
    const id = this.country[t];
    return id === 0 ? null : this.countries[id];
  }
}

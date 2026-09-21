import { FlatBinaryHeap } from "./BinaryHeap";
import type { Game } from "./Game";
import type { Player } from "./Player";
import type { Unit } from "./Unit";
import { FLAG_RAIL, TerrainType, UnitType, type TileRef } from "./types";

/** structure types that can become a train station */
export const STATION_TYPES: ReadonlySet<UnitType> = new Set([UnitType.City, UnitType.Port, UnitType.Factory]);
/** stations where a train stop pays gold */
export const TRADE_STATION_TYPES: ReadonlySet<UnitType> = new Set([UnitType.City, UnitType.Port]);

/** OpenFront railroad.frag.glsl: 0=none, 1=V 2=H 3=TopLeft 4=TopRight 5=BottomLeft 6=BottomRight */
export const RailType = {
  None: 0,
  Vertical: 1,
  Horizontal: 2,
  TopLeft: 3,
  TopRight: 4,
  BottomLeft: 5,
  BottomRight: 6,
} as const;

export interface RailGhostTile {
  ref: TileRef;
  type: number;
}

export interface RailGhost {
  tiles: RailGhostTile[];
  overlap: TileRef[];
}

function wrapDx(x1: number, x2: number, w: number): number {
  let dx = x2 - x1;
  if (dx > w / 2) dx -= w;
  else if (dx < -w / 2) dx += w;
  return dx;
}

function railExtremity(tile: number, next: number, w: number): number {
  const dx = wrapDx(tile % w, next % w, w);
  const dy = ((next / w) | 0) - ((tile / w) | 0);
  if (dy === 0 && dx !== 0) return RailType.Horizontal;
  return RailType.Vertical;
}

function railDirection(prev: number, cur: number, next: number, w: number): number {
  const x1 = prev % w;
  const y1 = (prev / w) | 0;
  const x2 = cur % w;
  const y2 = (cur / w) | 0;
  const x3 = next % w;
  const y3 = (next / w) | 0;
  const dx1 = wrapDx(x1, x2, w);
  const dy1 = y2 - y1;
  const dx2 = wrapDx(x2, x3, w);
  const dy2 = y3 - y2;
  if (dx1 === dx2 && dy1 === dy2) return dx1 !== 0 ? RailType.Horizontal : RailType.Vertical;
  if ((dx1 === 0 && dx2 !== 0) || (dx1 !== 0 && dx2 === 0)) {
    if (dx1 === 0 && dx2 === 1 && dy1 === -1) return RailType.BottomRight;
    if (dx1 === 0 && dx2 === -1 && dy1 === -1) return RailType.BottomLeft;
    if (dx1 === 0 && dx2 === 1 && dy1 === 1) return RailType.TopRight;
    if (dx1 === 0 && dx2 === -1 && dy1 === 1) return RailType.TopLeft;
    if (dx1 === 1 && dx2 === 0 && dy2 === -1) return RailType.TopLeft;
    if (dx1 === -1 && dx2 === 0 && dy2 === -1) return RailType.TopRight;
    if (dx1 === 1 && dx2 === 0 && dy2 === 1) return RailType.BottomLeft;
    if (dx1 === -1 && dx2 === 0 && dy2 === 1) return RailType.BottomRight;
  }
  return RailType.Vertical;
}

/** Orient a station-to-station path the way OpenFront's RailroadCache does. */
export function computeRailTiles(tileRefs: number[], w: number): RailGhostTile[] {
  if (tileRefs.length === 0) return [];
  if (tileRefs.length === 1) return [{ ref: tileRefs[0], type: RailType.Vertical }];
  const result: RailGhostTile[] = [{ ref: tileRefs[0], type: railExtremity(tileRefs[0], tileRefs[1], w) }];
  for (let i = 1; i < tileRefs.length - 1; i++) {
    result.push({ ref: tileRefs[i], type: railDirection(tileRefs[i - 1], tileRefs[i], tileRefs[i + 1], w) });
  }
  const last = tileRefs.length - 1;
  result.push({ ref: tileRefs[last], type: railExtremity(tileRefs[last], tileRefs[last - 1], w) });
  return result;
}

export class Railroad {
  constructor(
    readonly a: Station,
    readonly b: Station,
    /** tiles from a to b, including both station tiles */
    readonly tiles: TileRef[],
  ) {}
  other(s: Station): Station {
    return s === this.a ? this.b : this.a;
  }
  /** tiles ordered so a train leaving `from` follows them, ending on the far station */
  tilesFrom(from: Station): TileRef[] {
    const seq = from === this.a ? this.tiles.slice() : this.tiles.slice().reverse();
    if (seq.length && seq[0] === from.tile) seq.shift();
    return seq;
  }
}

export class Station {
  readonly rails = new Set<Railroad>();
  private byNeighbor = new Map<Station, Railroad>();
  constructor(readonly unit: Unit) {}
  get tile(): TileRef {
    return this.unit.tile;
  }
  get owner(): Player {
    return this.unit.owner;
  }
  get type(): UnitType {
    return this.unit.type;
  }
  get active(): boolean {
    return this.unit.active;
  }
  addRail(r: Railroad): void {
    this.rails.add(r);
    this.byNeighbor.set(r.other(this), r);
  }
  removeRail(r: Railroad): void {
    this.rails.delete(r);
    this.byNeighbor.delete(r.other(this));
  }
  railTo(s: Station): Railroad | null {
    return this.byNeighbor.get(s) ?? null;
  }
  neighbors(): Station[] {
    return [...this.byNeighbor.keys()];
  }
  /** can `p`'s trains stop here? own stations always; foreign ones unless either side embargoes the other */
  tradeAvailable(p: Player): boolean {
    const o = this.owner;
    if (o === p) return true;
    if (!o.alive) return false;
    return !o.embargoes.has(p.smallID) && !p.embargoes.has(o.smallID);
  }
}

/**
 * Railways between Cities, Ports and Factories (OpenFront's rail economy).
 * A Factory is always a station and pulls every City/Port/Factory in range
 * into the network; a City/Port only joins when a finished Factory is nearby.
 * Rails are laid with A* over land (short bridges allowed at a steep cost).
 * Each tile stores a NESW connection mask (`railType` bits 1/2/4/8) so the
 * globe shader can draw two parallel tracks like OpenFront. Neighboring stations
 * always link; a new station sitting on an existing track snaps onto it.
 */
export class RailNetwork {
  readonly stations = new Map<Unit, Station>();
  readonly railroads = new Set<Railroad>();
  /** bumped whenever a rail is laid or removed (renderer rebuilds tracks) */
  version = 0;
  /** how many railroads run through each tile (for un-flagging) */
  private railCount: Uint8Array;

  constructor(readonly game: Game) {
    this.railCount = new Uint8Array(game.map.width * game.map.height);
  }

  stationOf(u: Unit): Station | null {
    return this.stations.get(u) ?? null;
  }

  /** a finished structure may (or may make others) join the network */
  onStructureCompleted(u: Unit): void {
    if (!STATION_TYPES.has(u.type) || !u.active) return;
    const R = this.game.config.trainStationMaxRange();
    if (u.type === UnitType.Factory) {
      this.addStation(u);
      for (const other of this.nearbyStructures(u.tile, R)) {
        if (other !== u) this.addStation(other);
      }
      return;
    }
    if (!this.factoryInRange(u.tile, R)) return;
    this.addStation(u);
  }

  onUnitRemoved(u: Unit): void {
    const s = this.stations.get(u);
    if (!s) return;
    for (const r of [...s.rails]) this.removeRailroad(r);
    this.stations.delete(u);
  }

  /** stations reachable from `s` over rails */
  cluster(s: Station): Set<Station> {
    const seen = new Set<Station>([s]);
    const stack = [s];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const n of cur.neighbors()) {
        if (!seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    return seen;
  }

  /** City/Port stations in `from`'s cluster where `owner`'s trains may stop */
  hasTradeDest(from: Station, owner: Player): boolean {
    for (const s of this.cluster(from)) {
      if (s !== from && s.active && TRADE_STATION_TYPES.has(s.type) && s.tradeAvailable(owner)) return true;
    }
    return false;
  }

  /** City/Port stations in `from`'s cluster where `owner`'s trains may stop */
  tradeDestinations(from: Station, owner: Player): Station[] {
    const out: Station[] = [];
    for (const s of this.cluster(from)) {
      if (s !== from && s.active && TRADE_STATION_TYPES.has(s.type) && s.tradeAvailable(owner)) out.push(s);
    }
    return out;
  }

  /**
   * Dual-rail ghost for a structure at `from`.
   * Factories connect to nearby Cities/Ports/Factories; a City/Port only
   * previews when a finished Factory is already in range. Sitting on (or
   * within snap range of) an existing track highlights those rails green
   * instead of drawing a new path — same as OpenFront.
   */
  ghostPlacement(from: TileRef, type: UnitType): RailGhost {
    const overlap = this.overlappingRailroads(from);
    if (this.canSnap(from)) return { tiles: [], overlap };
    const cfg = this.game.config;
    const R = cfg.trainStationMaxRange();
    if (type !== UnitType.Factory && !this.factoryInRange(from, R)) return { tiles: [], overlap };
    const maxLen = cfg.railroadMaxSize();
    const minR2 = cfg.trainStationMinRange() ** 2;
    const map = this.game.map;
    const r2 = R * R;
    const w = map.width;
    const cands: { tile: TileRef; st: Station | null; d2: number }[] = [];
    if (type === UnitType.Factory) {
      for (const u of this.nearbyStructures(from, R)) {
        const d2 = map.distSq(u.tile, from);
        if (d2 === 0 || d2 < minR2) continue;
        cands.push({ tile: u.tile, st: this.stations.get(u) ?? null, d2 });
      }
    } else {
      for (const s of this.stations.values()) {
        if (!s.active) continue;
        const d2 = map.distSq(s.tile, from);
        if (d2 > 0 && d2 <= r2 && d2 >= minR2) cands.push({ tile: s.tile, st: s, d2 });
      }
    }
    cands.sort((a, b) => a.d2 - b.d2);
    const tiles: RailGhostTile[] = [];
    const linked: Station[] = [];
    for (const { tile, st } of cands) {
      if (linked.length >= 5) break;
      if (st && linked.some((s) => this.hopDistance(st, s, 3) !== -1)) continue;
      const path = this.findRailPath(from, tile, maxLen);
      if (!path || path.length < 2) continue;
      tiles.push(...computeRailTiles(path, w));
      if (st) linked.push(st);
    }
    return { tiles, overlap };
  }

  /** existing rail tiles within snap range of `tile` (turn green on the ghost) */
  overlappingRailroads(tile: TileRef): TileRef[] {
    const r2 = this.game.config.trainSnapRange() ** 2;
    const seen = new Set<TileRef>();
    const out: TileRef[] = [];
    for (const rail of this.railroads) {
      let hit = false;
      for (const t of rail.tiles) {
        if (this.game.map.distSq(t, tile) <= r2) {
          hit = true;
          break;
        }
      }
      if (!hit) continue;
      for (const t of rail.tiles) {
        if (seen.has(t)) continue;
        seen.add(t);
        out.push(t);
      }
    }
    return out;
  }

  private canSnap(tile: TileRef): boolean {
    const r2 = this.game.config.trainSnapRange() ** 2;
    for (const rail of this.railroads) {
      for (const t of rail.tiles) {
        if (this.game.map.distSq(t, tile) <= r2) return true;
      }
    }
    return false;
  }

  /** shortest station-hop route (BFS) or null when disconnected */
  stationPath(from: Station, to: Station): Station[] | null {
    if (from === to) return [from];
    const prev = new Map<Station, Station | null>([[from, null]]);
    const queue = [from];
    for (let qi = 0; qi < queue.length; qi++) {
      const cur = queue[qi];
      for (const n of cur.neighbors()) {
        if (prev.has(n)) continue;
        prev.set(n, cur);
        if (n === to) {
          const path: Station[] = [];
          for (let s: Station | null = to; s; s = prev.get(s) ?? null) path.push(s);
          return path.reverse();
        }
        queue.push(n);
      }
    }
    return null;
  }

  // ---------------- construction ----------------

  private nearbyStructures(tile: TileRef, R: number): Unit[] {
    const map = this.game.map;
    const r2 = R * R;
    const out: Unit[] = [];
    for (const u of this.game.units) {
      if (!u.active || u.constructing || !STATION_TYPES.has(u.type)) continue;
      if (map.distSq(u.tile, tile) <= r2) out.push(u);
    }
    return out;
  }

  private factoryInRange(tile: TileRef, R: number): boolean {
    const map = this.game.map;
    const r2 = R * R;
    for (const u of this.game.units) {
      if (u.type === UnitType.Factory && u.active && !u.constructing && map.distSq(u.tile, tile) <= r2) return true;
    }
    return false;
  }

  private addStation(u: Unit): Station {
    let s = this.stations.get(u);
    if (s) return s;
    s = new Station(u);
    this.stations.set(u, s);
    this.snapToRails(s);
    this.connect(s);
    return s;
  }

  /** OpenFront: a new station within snap range splits that railroad in two */
  private snapToRails(s: Station): boolean {
    const r2 = this.game.config.trainSnapRange() ** 2;
    let snapped = false;
    for (const rail of [...this.railroads]) {
      if (rail.a === s || rail.b === s) continue;
      let bestI = -1;
      let bestD = Infinity;
      for (let i = 0; i < rail.tiles.length; i++) {
        const d = this.game.map.distSq(rail.tiles[i], s.tile);
        if (d < bestD) {
          bestD = d;
          bestI = i;
        }
      }
      if (bestI <= 0 || bestI >= rail.tiles.length - 1 || bestD > r2) continue;
      const left = rail.tiles.slice(0, bestI + 1);
      const right = rail.tiles.slice(bestI);
      const a = rail.a;
      const b = rail.b;
      this.removeRailroad(rail);
      if (left.length >= 2) this.addRailroad(new Railroad(a, s, left));
      if (right.length >= 2) this.addRailroad(new Railroad(s, b, right));
      snapped = true;
    }
    return snapped;
  }

  /** lay rails to nearby stations (OpenFront: skip if already within 4 hops) */
  private connect(s: Station): void {
    const cfg = this.game.config;
    const map = this.game.map;
    const R = cfg.trainStationMaxRange();
    const maxLen = cfg.railroadMaxSize();
    const r2 = R * R;
    const cands: { st: Station; d2: number }[] = [];
    for (const other of this.stations.values()) {
      if (other === s || !other.active) continue;
      const d2 = map.distSq(other.tile, s.tile);
      if (d2 > r2) continue;
      cands.push({ st: other, d2 });
    }
    cands.sort((a, b) => {
      const as = a.st.owner === s.owner ? 0 : 1;
      const bs = b.st.owner === s.owner ? 0 : 1;
      return as - bs || a.d2 - b.d2;
    });
    const linked: Station[] = [];
    const minR2 = cfg.trainStationMinRange() ** 2;
    for (const { st, d2 } of cands) {
      if (s.railTo(st)) continue;
      if (d2 < minR2) continue;
      if (this.hopDistance(s, st, 4) !== -1) continue;
      if (linked.some((other) => this.hopDistance(st, other, 3) !== -1)) continue;
      if (this.layRail(s, st, maxLen)) linked.push(st);
    }
  }

  /** BFS hop count along existing rails, or -1 if farther than maxHops */
  private hopDistance(start: Station, dest: Station, maxHops: number): number {
    if (start === dest) return 0;
    const seen = new Set<Station>([start]);
    const q: Station[] = [start];
    const dist = new Map<Station, number>([[start, 0]]);
    for (let qi = 0; qi < q.length; qi++) {
      const cur = q[qi];
      const d = dist.get(cur)!;
      if (d >= maxHops) continue;
      for (const n of cur.neighbors()) {
        if (seen.has(n)) continue;
        if (n === dest) return d + 1;
        seen.add(n);
        dist.set(n, d + 1);
        q.push(n);
      }
    }
    return -1;
  }

  private layRail(a: Station, b: Station, maxLen: number): boolean {
    if (a.railTo(b)) return true;
    if (a.tile === b.tile) {
      const r = new Railroad(a, b, [a.tile, a.tile]);
      this.railroads.add(r);
      a.addRail(r);
      b.addRail(r);
      this.version++;
      return true;
    }
    const tiles = this.findRailPath(a.tile, b.tile, maxLen);
    if (!tiles || tiles.length < 2) return false;
    this.addRailroad(new Railroad(a, b, tiles));
    return true;
  }

  private addRailroad(r: Railroad): void {
    this.railroads.add(r);
    r.a.addRail(r);
    r.b.addRail(r);
    const painted = computeRailTiles(this.railPaintTiles(r), this.game.map.width);
    for (const { ref, type } of painted) this.paintRail(ref, 1, type);
    this.version++;
  }

  private removeRailroad(r: Railroad): void {
    if (!this.railroads.delete(r)) return;
    r.a.removeRail(r);
    r.b.removeRail(r);
    for (const t of this.railPaintTiles(r)) this.paintRail(t, -1);
    this.version++;
  }

  private railPaintTiles(r: Railroad): TileRef[] {
    if (r.tiles.length === 2 && r.tiles[0] === r.tiles[1]) return [];
    return r.tiles;
  }

  /** flag this rail tile and stamp OpenFront's 1-6 orientation into railType */
  private paintRail(t: TileRef, delta: number, type = 0): void {
    const map = this.game.map;
    const next = this.railCount[t] + delta;
    this.railCount[t] = next < 0 ? 0 : next;
    if (next > 0) {
      map.flags[t] |= FLAG_RAIL;
      if (type > 0) map.railType[t] = type;
    } else {
      map.flags[t] &= ~FLAG_RAIL;
      map.railType[t] = 0;
    }
    map.markDirty(t);
  }

  // ---------------- pathfinding ----------------

  private coastalBuf: TileRef[] = [0, 0, 0, 0];

  /** land shore or water next to land — OpenFront only bridges these */
  private isCoastal(t: TileRef): boolean {
    const map = this.game.map;
    const land = map.isLand(t);
    const water = map.isWater(t);
    if (!land && !water) return false;
    const n = map.neighbors4(t, this.coastalBuf);
    for (let i = 0; i < n; i++) {
      const nb = this.coastalBuf[i];
      if (land && map.isWater(nb)) return true;
      if (water && map.isLand(nb)) return true;
    }
    return false;
  }

  /** land always; water only as a one-tile shore bridge */
  private canRailStep(from: TileRef, to: TileRef): boolean {
    const map = this.game.map;
    if (map.isImpassable(to)) return false;
    if (!map.isWater(to)) return true;
    return this.isCoastal(from) || this.isCoastal(to);
  }

  /**
   * A* over a 4-connected grid inside a box around both endpoints.
   * OpenFront costs: land 1, water/shore 6, turn +3. Water only as a
   * one-tile shore bridge.
   */
  findRailPath(from: TileRef, to: TileRef, maxLen: number): TileRef[] | null {
    if (from === to) return [from];
    const astar = this.astarRail(from, to, maxLen);
    if (astar) return astar;
    return this.landManhattan(from, to, maxLen);
  }

  private astarRail(from: TileRef, to: TileRef, maxLen: number): TileRef[] | null {
    const map = this.game.map;
    const W = map.width;
    const H = map.height;
    const x0 = map.x(from);
    const y0 = map.y(from);
    const x1 = map.x(to);
    const y1 = map.y(to);
    let dx = x1 - x0;
    if (dx > W / 2) dx -= W;
    else if (dx < -W / 2) dx += W;
    const dist = Math.abs(dx) + Math.abs(y1 - y0);
    const pad = Math.ceil(dist * 0.5) + 12;
    const bx0 = Math.min(x0, x0 + dx) - pad;
    const bx1 = Math.max(x0, x0 + dx) + pad;
    const by0 = Math.max(0, Math.min(y0, y1) - pad);
    const by1 = Math.min(H - 1, Math.max(y0, y1) + pad);
    const bw = bx1 - bx0 + 1;
    const bh = by1 - by0 + 1;
    const N = bw * bh;
    if (N > 800_000) return null;

    const g = new Float32Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const heap = new FlatBinaryHeap(4096);
    const wrap = (x: number) => ((x % W) + W) % W;
    const local = (x: number, y: number) => (y - by0) * bw + (x - bx0);
    const tileOf = (li: number): TileRef => {
      const lx = li % bw;
      const ly = (li - lx) / bw;
      return map.ref(wrap(lx + bx0), ly + by0);
    };
    const start = local(x0, y0);
    const goalX = x0 + dx;
    const goal = local(goalX, y1);
    g[start] = 0;
    heap.enqueue(start, 0);
    const terrain = map.terrain;
    const stepCost = (fromLi: number, toLi: number): number => {
      const fromT = tileOf(fromLi);
      const toT = tileOf(toLi);
      if (!this.canRailStep(fromT, toT)) return Infinity;
      const tt = terrain[toT];
      if (tt === TerrainType.Impassable) return Infinity;
      // OpenFront AStar.Rail: land 1, water/shore 6, turn +3
      let c = this.game.map.isWater(toT) || this.isCoastal(toT) ? 6 : 1;
      const came = prev[fromLi];
      if (came >= 0 && toLi - fromLi !== fromLi - came) c += 3;
      return c;
    };
    let expanded = 0;
    while (heap.size()) {
      const cur = heap.dequeue();
      if (cur === goal) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      if (++expanded > 250_000) return null;
      const cx = cur % bw;
      const cy = (cur - cx) / bw;
      const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
      for (const [ox, oy] of dirs) {
        const nx = cx + ox;
        const ny = cy + oy;
        if (ny < 0 || ny >= bh || nx < 0 || nx >= bw) continue;
        const ni = ny * bw + nx;
        if (closed[ni]) continue;
        const sc = stepCost(cur, ni);
        if (sc === Infinity) continue;
        const ng = g[cur] + sc;
        if (ng >= g[ni]) continue;
        g[ni] = ng;
        prev[ni] = cur;
        const hx = goalX - (nx + bx0);
        const hy = y1 - (ny + by0);
        heap.enqueue(ni, ng + 2 * (Math.abs(hx) + Math.abs(hy)));
      }
    }
    if (prev[goal] < 0 && goal !== start) return null;
    const out: TileRef[] = [];
    for (let li = goal; li >= 0; li = prev[li]) {
      out.push(tileOf(li));
      if (li === start) break;
    }
    if (out.length < 2 || out.length > maxLen) return null;
    return out.reverse();
  }

  /** greedy 4-connected walk on land when A* cannot find a path */
  private landManhattan(from: TileRef, to: TileRef, maxLen: number): TileRef[] | null {
    const map = this.game.map;
    const buf: TileRef[] = [0, 0, 0, 0];
    const path: TileRef[] = [from];
    const seen = new Set<TileRef>([from]);
    let cur = from;
    for (let step = 0; step < maxLen; step++) {
      if (cur === to) return path.length >= 2 ? path : null;
      const n = map.neighbors4(cur, buf);
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < n; i++) {
        const nb = buf[i];
        if (seen.has(nb)) continue;
        if (nb !== to && (map.isWater(nb) || map.isImpassable(nb))) continue;
        const d = map.distSq(nb, to);
        if (d < bestD) {
          bestD = d;
          best = nb;
        }
      }
      if (best < 0) return null;
      seen.add(best);
      path.push(best);
      cur = best;
    }
    return cur === to && path.length >= 2 ? path : null;
  }
}

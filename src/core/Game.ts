import { Config, TICKS_PER_SECOND } from "./Config";
import type { GameMap } from "./GameMap";
import { Player, type Alliance, type AllianceRequest } from "./Player";
import { PseudoRandom } from "./PseudoRandom";
import { RailNetwork } from "./RailNetwork";
import { Unit } from "./Unit";
import { BorderPathfinder } from "./BorderPathfinder";
import { WaterPathfinder } from "./WaterPathfinder";
import type { AttackExecution } from "./executions/AttackExecution";
import { fmt, fmtTroops } from "./executions/AttackExecution";
import {
  FLAG_BORDER,
  FLAG_DEFENDED,
  MessageType,
  PlayerType,
  NUKES,
  STRUCTURES,
  UnitType,
  TerrainType,
  type GameEvent,
  type GameSettings,
  type PlayerID,
  type TileRef,
} from "./types";

export interface Execution {
  init(game: Game): void;
  tick(): void;
  isActive(): boolean;
  /** run during the spawn phase too (default false) */
  activeDuringSpawnPhase?: boolean;
}

/** 1-pixel army walking country borders toward a far attack. */
export interface BorderWalker {
  owner: Player;
  fx: number;
  fy: number;
  heading: number;
  path: TileRef[];
  pathIndex: number;
  tile: TileRef;
}

const EMPTY_UNITS: Unit[] = [];

export class Game {
  readonly config: Config;
  readonly random: PseudoRandom;
  ticks = 0;
  online = false;
  private nextUnitId = 1;
  nextAttackId = 1;
  /** players indexed by smallID (index 0 unused) */
  readonly players: (Player | undefined)[] = [undefined];
  private executions: Execution[] = [];
  private pendingExecutions: Execution[] = [];
  readonly events: GameEvent[] = [];
  winner: Player | null = null;
  human: Player | null = null;
  private allianceId = 1;
  private requestId = 1;
  private falloutExpiry = new Map<TileRef, number>();
  private nbuf: TileRef[] = [0, 0, 0, 0];
  private playerCache: Player[] | null = null;
  private neighborCacheTick = -1;
  private neighborCache = new Map<number, { players: Player[]; neutral: boolean }>();
  private homeFrontCacheTick = -1;
  private homeFrontCache = new Map<number, { invaders: Player[]; neutralHome: boolean }>();
  /** all units in the world (structures + ships + nukes) for spatial queries */
  readonly units = new Set<Unit>();
  /** structures indexed by tile for O(1) lookup */
  private structByTile = new Map<TileRef, Unit[]>();
  private trainN = 0;
  private trainNTick = -1;
  /** callback hooks for UI/renderer */
  onUnitAdded: ((u: Unit) => void) | null = null;
  onUnitRemoved: ((u: Unit) => void) | null = null;
  onPlayerDied: ((p: Player, killer: Player | null) => void) | null = null;
  onNukeDetonated: ((tile: TileRef, type: UnitType) => void) | null = null;
  onSamIntercept: ((samTile: TileRef, missileTile: TileRef) => void) | null = null;
  onGoldFloat: ((tile: TileRef, gold: number, player: Player, troops?: number) => void) | null = null;
  onTerrainSunk: ((tile: TileRef) => void) | null = null;
  onAllianceBroken: ((breaker: Player, other: Player) => void) | null = null;
  onConstructionComplete: ((u: Unit) => void) | null = null;
  onBorderAssault: ((tile: TileRef, color: string) => void) | null = null;
  /** when true, nation/bot AI does not act (dev mode) */
  devFreezeAi = false;

  readonly waterPathfinder: WaterPathfinder;
  readonly borderPathfinder: BorderPathfinder;
  /** far-attack pixels currently walking country borders */
  readonly borderWalkers: BorderWalker[] = [];
  readonly rail: RailNetwork;
  /** smallID of the player whose finished Defense Post covers this tile (0 = none) */
  readonly defenseCover: Uint16Array;
  /** remaining unowned land tiles per country id */
  private readonly countryUnowned: Uint32Array;
  private readonly countryArea: Float64Array;
  private readonly countryRewarded: Uint8Array;
  /** cid → player smallID → tiles owned in that country */
  private readonly countryOwned = new Map<number, Map<number, number>>();

  constructor(
    readonly map: GameMap,
    settings: GameSettings,
  ) {
    this.config = new Config(settings, map.scale, map.landArea);
    this.random = new PseudoRandom(settings.seed);
    this.waterPathfinder = new WaterPathfinder(map);
    this.borderPathfinder = new BorderPathfinder(map);
    this.rail = new RailNetwork(this);
    this.defenseCover = new Uint16Array(map.width * map.height);
    this.countryUnowned = new Uint32Array(map.countries.length);
    this.countryArea = new Float64Array(map.countries.length);
    this.countryRewarded = new Uint8Array(map.countries.length);
    const terrain = map.terrain;
    const country = map.country;
    for (let t = 0; t < terrain.length; t++) {
      if (map.isLand(t)) {
        const cid = country[t];
        if (cid) { this.countryUnowned[cid]++; this.countryArea[cid] += map.tileArea(t); }
      }
    }
  }

  isDev(): boolean {
    return this.config.settings.devMode;
  }

  /** jump to the end of spawn so leftover nations/bots appear and building is allowed */
  skipSpawnPhase(): void {
    const end = this.config.spawnPhaseTicks();
    if (this.ticks < end) this.ticks = end;
    for (const p of this.allPlayers()) {
      if (p.hasSpawned) continue;
      const t = this.randomSpawnTile(p);
      if (t >= 0) this.spawnPlayer(p, t);
    }
  }

  finishConstruction(): void {
    for (const u of [...this.units]) {
      if (u.active && u.constructing) this.completeConstruction(u);
    }
  }

  /** steal a disc of land for `player` (dev painting) */
  claimAround(player: Player, tile: TileRef, radius: number): number {
    const map = this.map;
    const cx = map.x(tile);
    const cy = map.y(tile);
    let n = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > radius * radius) continue;
        const t = map.refWrapped(cx + dx, cy + dy);
        if (t < 0 || !map.isLand(t) || map.owner[t] === player.smallID) continue;
        this.conquer(player, t);
        n++;
      }
    }
    return n;
  }

  // ---------- players ----------
  addPlayer(name: string, type: PlayerType, color: string, countryId = 0, flag = ""): Player {
    const p = new Player(this.players.length, name, type, color, countryId, flag);
    const start = this.config.startPopulation(type);
    p.troops = start;
    p.workers = start * (1 - p.targetTroopRatio) / Math.max(0.05, p.targetTroopRatio);
    if (type === PlayerType.Human) {
      p.gold = this.isDev() ? 500_000_000 : this.config.settings.infiniteGold ? 1_000_000_000 : this.config.settings.startingGold;
    }
    this.players.push(p);
    this.playerCache = null;
    return p;
  }
  player(id: PlayerID): Player | null {
    return this.players[id] ?? null;
  }
  allPlayers(): Player[] {
    return this.playerCache ?? (this.playerCache = this.players.filter((p): p is Player => p !== undefined));
  }
  alivePlayers(): Player[] {
    return this.allPlayers().filter((p) => p.alive);
  }
  ownerAt(tile: TileRef): Player | null {
    const id = this.map.owner[tile];
    return id === 0 ? null : (this.players[id] ?? null);
  }

  inSpawnPhase(): boolean {
    return this.ticks < this.config.spawnPhaseTicks();
  }
  spawnPhaseTicksLeft(): number {
    return Math.max(0, this.config.spawnPhaseTicks() - this.ticks);
  }
  elapsedSeconds(): number {
    return this.ticks / TICKS_PER_SECOND;
  }

  addExecution(e: Execution): void {
    this.pendingExecutions.push(e);
  }

  /** Initialize queued AI/setup work during loading without running a simulation tick. */
  async prepareExecutions(yieldWork: () => Promise<void>): Promise<void> {
    while (this.pendingExecutions.length) {
      const pending = this.pendingExecutions; this.pendingExecutions = [];
      for (let i=0;i<pending.length;i++) {
        const execution=pending[i];execution.init(this);
        if(execution.isActive())this.executions.push(execution);
        if(i%8===7)await yieldWork();
      }
    }
  }

  // ---------- main loop ----------
  tick(): void {
    if (this.winner) return;
    const spawnPhase = this.inSpawnPhase();

    // spawn phase ending: place everyone who hasn't spawned
    if (this.ticks === this.config.spawnPhaseTicks()) {
      for (const p of this.allPlayers()) {
        if (!p.hasSpawned) {
          const t = this.randomSpawnTile(p);
          if (t >= 0) this.spawnPlayer(p, t);
        }
      }
    }

    // executions
    if (this.pendingExecutions.length) {
      const pend = this.pendingExecutions;
      this.pendingExecutions = [];
      for (const e of pend) {
        e.init(this);
        if (e.isActive()) this.executions.push(e);
      }
    }
    for (const e of this.executions) {
      if (spawnPhase && !e.activeDuringSpawnPhase) continue;
      if (e.isActive()) e.tick();
    }
    if (this.ticks % 10 === 0) {
      this.executions = this.executions.filter((e) => e.isActive());
    }

    // Instant-build factories never went through completeConstruction; keep
    // stations in sync so rails show up even if a factory was placed earlier.
    if (this.ticks % 20 === 7) {
      for (const u of this.units) {
        if (u.type === UnitType.Factory && u.active && !u.constructing && !this.rail.stationOf(u)) {
          this.rail.onStructureCompleted(u);
        }
      }
    }

    if (!spawnPhase) {
      for (const p of this.allPlayers()) this.tickPlayer(p);
      this.expireAlliances();
      this.expireAllianceRequests();
      if (this.ticks % 10 === 0) this.expireFallout();
      if (this.ticks % 10 === 5) this.checkWin();
    }
    this.ticks++;
  }

  private tickPlayer(p: Player): void {
    if (!p.hasSpawned) return;
    if (!p.alive) {
      if (p.diedAt < 0) this.handleDeath(p, p.lastAttackedBy);
      return;
    }
    if (this.ticks % 20 === 0) p.decayRelations();
    if (p.embargoUntil.size) {
      for (const [id, until] of p.embargoUntil) {
        if (until <= this.ticks) {
          p.embargoes.delete(id);
          p.embargoUntil.delete(id);
        }
      }
    }

    // structure capture: structures standing on someone else's land change hands
    const units = p.units;
    const captureTick = units.length > 0 && (this.ticks + p.smallID) % 4 === 0;
    if (units.length) {
      for (let i = 0; i < units.length; i++) {
        const u = units[i];
        if (u.constructing && this.ticks >= u.readyAt) this.completeConstruction(u);
        if (u.deleteAt >= 0 && this.ticks >= u.deleteAt && u.active) {
          this.removeUnit(u);
          i--;
          continue;
        }
        if (!captureTick || !u.isStructure() || !u.active) continue;
        const owner = this.ownerAt(u.tile);
        if (owner === p) continue;
        if (owner === null) {
          this.removeUnit(u);
          i--;
          continue;
        }
        if (u.type === UnitType.DefensePost) {
          this.removeUnit(u);
          i--;
          this.displayMessage(`${owner.name} destroyed your Defense Post`, MessageType.Warn, p.smallID);
        } else {
          this.transferUnit(u, owner);
          i--;
          this.displayMessage(`${owner.name} captured your ${unitLabel(u.type)}`, MessageType.Warn, p.smallID);
          this.displayMessage(`Captured ${unitLabel(u.type)} from ${p.name}`, MessageType.Success, owner.smallID);
        }
      }
    }

    // OpenFront troopIncreaseRate lands entirely as troops; we then walk toward the troop/worker slider.
    const inc = this.config.populationIncrease(p);
    p.troops += inc;
    // rebalance toward the target ratio
    const targetTroops = p.population * p.targetTroopRatio;
    const rate = this.config.troopAdjustmentRate(p);
    let diff = targetTroops - p.troops;
    diff = Math.max(-rate, Math.min(rate, diff));
    p.troops += diff;
    p.workers -= diff;
    if (p.workers < 0) {
      p.troops += p.workers;
      p.workers = 0;
    }
    p.addGold(this.goldIncome(p));
  }

  /** factories whose rails already reach a City or Dock */
  linkedFactoryLevels(p: Player): number {
    let n = 0;
    for (const u of p.units) {
      if (u.type !== UnitType.Factory || !u.active || u.constructing) continue;
      const st = this.rail.stationOf(u);
      if (!st || st.rails.size === 0) continue;
      if (this.rail.hasTradeDest(st, p)) n += u.level;
    }
    return n;
  }

  goldIncome(p: Player): number {
    if (this.ticks - p.linkedFactTick >= 15) {
      p.linkedFactories = this.linkedFactoryLevels(p);
      p.linkedFactTick = this.ticks;
    }
    return this.config.goldPerTick(p, p.linkedFactories);
  }

  private bumpCountryOwned(cid: number, pid: number, delta: number): void {
    let m = this.countryOwned.get(cid);
    if (!m) {
      m = new Map();
      this.countryOwned.set(cid, m);
    }
    const n = (m.get(pid) ?? 0) + delta;
    if (n <= 0) m.delete(pid);
    else m.set(pid, n);
  }

  private noteCountryTile(tile: TileRef, prevId: number, nextId: number): void {
    if (prevId === nextId) return;
    const cid = this.map.country[tile];
    if (!cid) return;
    if (prevId === 0) this.countryUnowned[cid] = Math.max(0, this.countryUnowned[cid] - 1);
    else this.bumpCountryOwned(cid, prevId, -this.map.tileArea(tile));
    if (nextId === 0) this.countryUnowned[cid]++;
    else this.bumpCountryOwned(cid, nextId, this.map.tileArea(tile));
    if (prevId === 0 && nextId !== 0 && this.countryUnowned[cid] === 0 && !this.countryRewarded[cid] && !this.inSpawnPhase()) {
      this.payoutCountryClaim(cid);
    }
  }

  /** last unowned tile of a country/state was taken — pay everyone who holds a share */
  private payoutCountryClaim(cid: number): void {
    this.countryRewarded[cid] = 1;
    const info = this.map.countries[cid];
    if (!info || info.tiles < 40) return;
    const shares = this.countryOwned.get(cid);
    if (!shares || shares.size === 0) return;
    const total = Math.max(1, this.countryArea[cid]);
    for (const [pid, tiles] of shares) {
      const p = this.player(pid);
      if (!p || !p.alive || tiles <= 0) continue;
      const gold = this.config.countryClaimGold(tiles, total);
      const troops = this.config.countryClaimTroops(tiles, total);
      if (gold > 0) p.addGold(gold);
      if (troops > 0) p.addTroops(troops);
      if (p === this.human) {
        const pct = Math.round((tiles / total) * 100);
        const split = shares.size > 1 ? ` · you ${pct}%` : "";
        this.displayMessage(
          `Claimed ${info.name}${split}: +${fmt(gold)} gold, +${fmtTroops(troops)} troops`,
          MessageType.Success,
          p.smallID,
        );
        if (info.centroid >= 0 && (gold > 0 || troops > 0)) this.onGoldFloat?.(info.centroid, gold, p, troops);
      }
    }
  }

  // ---------- territory ----------
  conquer(player: Player, tile: TileRef): void {
    const map = this.map;
    const prevId = map.owner[tile];
    if (prevId === player.smallID) return;
    if (prevId !== 0) {
      const prev = this.players[prevId];
      if (prev) {
        prev.tiles.delete(tile);
        prev.landArea = Math.max(0, prev.landArea - map.tileArea(tile));
        prev.borderTiles.delete(tile);
        prev.lastAttackedBy = player;
      }
    }
    map.owner[tile] = player.smallID;
    map.markDirty(tile);
    player.tiles.add(tile);
    player.landArea += map.tileArea(tile);
    player.peakLandArea = Math.max(player.peakLandArea, player.landArea);
    if (player.tiles.size > player.peakTiles) player.peakTiles = player.tiles.size;
    if (map.hasFallout(tile)) {
      map.setFallout(tile, false);
      this.falloutExpiry.delete(tile);
    }
    this.updateBorder(tile);
    const n = map.neighbors4(tile, this.nbuf);
    for (let i = 0; i < n; i++) this.updateBorder(this.nbuf[i]);
    this.noteCountryTile(tile, prevId, player.smallID);
  }

  relinquish(tile: TileRef): void {
    const map = this.map;
    const prevId = map.owner[tile];
    if (prevId === 0) return;
    const prev = this.players[prevId];
    if (prev) {
      prev.tiles.delete(tile);
      prev.landArea = Math.max(0, prev.landArea - map.tileArea(tile));
      prev.borderTiles.delete(tile);
    }
    map.owner[tile] = 0;
    map.markDirty(tile);
    this.updateBorder(tile);
    const n = map.neighbors4(tile, this.nbuf);
    for (let i = 0; i < n; i++) this.updateBorder(this.nbuf[i]);
    this.noteCountryTile(tile, prevId, 0);
  }
  sinkTile(tile: TileRef): void {
    const map = this.map;
    if (!map.isLand(tile)) return;
    const cid = map.country[tile];
    this.relinquish(tile);
    map.terrain[tile] = TerrainType.Water;
    map.numLandTiles = Math.max(0, map.numLandTiles - 1);
    map.landArea = Math.max(0, map.landArea - map.tileArea(tile));
    map.markDirty(tile);
    this.waterPathfinder.markWater(tile);
    const n = map.neighbors4(tile, this.nbuf);
    for (let i = 0; i < n; i++) this.updateBorder(this.nbuf[i]);
    if (cid) {
      if (this.countryUnowned[cid] > 0) this.countryUnowned[cid]--;
      this.countryArea[cid] = Math.max(0, this.countryArea[cid] - map.tileArea(tile));
    }
    this.onTerrainSunk?.(tile);
  }

  private bbuf: TileRef[] = [0, 0, 0, 0];
  /** recompute border membership + render flags (border / reinforced border) for one tile */
  private updateBorder(tile: TileRef): void {
    const map = this.map;
    const id = map.owner[tile];
    const flags = map.flags;
    if (id === 0) {
      if (flags[tile] & (FLAG_BORDER | FLAG_DEFENDED)) {
        flags[tile] &= ~(FLAG_BORDER | FLAG_DEFENDED);
        map.markDirty(tile);
      }
      return;
    }
    const p = this.players[id];
    if (!p) return;
    const n = map.neighbors4(tile, this.bbuf);
    let border = false;
    for (let i = 0; i < n; i++) {
      if (map.owner[this.bbuf[i]] !== id) {
        border = true;
        break;
      }
    }
    if (border) p.borderTiles.add(tile);
    else p.borderTiles.delete(tile);
    let f = flags[tile] & ~(FLAG_BORDER | FLAG_DEFENDED);
    if (border) {
      f |= FLAG_BORDER;
      if (this.defenseCover[tile] === id) f |= FLAG_DEFENDED;
    }
    if (f !== flags[tile]) {
      flags[tile] = f;
      map.markDirty(tile);
    }
  }

  /**
   * Recompute which player's finished Defense Post protects each tile around `center`
   * (the square that any post within range could touch) and refresh the border flags there.
   */
  refreshDefenseCover(center: TileRef): void {
    const map = this.map;
    const R = this.config.defensePostRange();
    const posts: Unit[] = [];
    for (const u of this.units) {
      if (u.type !== UnitType.DefensePost || !u.active || u.constructing) continue;
      if (map.surfaceDistance(u.tile, center) <= 2 * R) posts.push(u);
    }
    const cover = this.defenseCover;
    map.forEachSurfaceTile(center, R, t => {
      let best = 0, bestD = Infinity;
      for (const u of posts) {
        const d = map.surfaceDistance(u.tile, t);
        if (d <= R && d < bestD) { bestD = d; best = u.owner.smallID; }
      }
      if (cover[t] !== best) { cover[t] = best; this.updateBorder(t); }
    });
  }

  /** border tiles of `player` that a Defense Post at `tile` would reinforce */
  defendedBorderPreview(player: Player, tile: TileRef): TileRef[] {
    const map = this.map;
    const R = this.config.defensePostRange();
    const out: TileRef[] = [];
    for (const t of player.borderTiles) if (map.surfaceDistance(t, tile) <= R) out.push(t);
    return out;
  }

  /** does `player` border any tile owned by `targetId` (0 = neutral land)? */
  bordersOwner(player: Player, targetId: PlayerID): boolean {
    const map = this.map;
    const buf = this.bbuf;
    for (const t of player.borderTiles) {
      const n = map.neighbors4(t, buf);
      for (let i = 0; i < n; i++) {
        const nb = buf[i];
        if (map.owner[nb] === targetId && map.isLand(nb)) return true;
      }
    }
    return false;
  }

  /** does `player` own a land tile next to `tile`? */
  touches(player: Player, tile: TileRef): boolean {
    const map = this.map;
    const n = map.neighbors4(tile, this.nbuf);
    for (let i = 0; i < n; i++) {
      const nb = this.nbuf[i];
      if (map.owner[nb] === player.smallID && map.isLand(nb)) return true;
    }
    return false;
  }

  /** first target-owned land tile on `player`'s border, optionally inside one country */
  borderContact(player: Player, targetId: PlayerID, countryId = 0): TileRef {
    const map = this.map;
    const buf = this.nbuf;
    for (const t of player.borderTiles) {
      const n = map.neighbors4(t, buf);
      for (let i = 0; i < n; i++) {
        const nb = buf[i];
        if (!map.isLand(nb) || map.owner[nb] !== targetId) continue;
        if (countryId !== 0 && map.country[nb] !== countryId) continue;
        return nb;
      }
    }
    return -1;
  }

  /**
   * Shared-border tile nearest the click: walk through the target's (or unowned)
   * land until we hit our territory. That's the crossing the army marches to.
   */
  attackContact(player: Player, hint: TileRef, targetId: PlayerID): TileRef {
    const map = this.map;
    if (hint >= 0 && map.isLand(hint) && map.owner[hint] === targetId && this.touches(player, hint)) return hint;
    const start = hint >= 0 && map.isLand(hint) && map.owner[hint] === targetId ? hint : this.borderContact(player, targetId);
    if (start < 0) return -1;
    if (this.touches(player, start)) return start;
    const seen = new Set<TileRef>([start]);
    const q: TileRef[] = [start];
    const buf: TileRef[] = [0, 0, 0, 0];
    const cap = 40_000 * map.scale;
    for (let qi = 0; qi < q.length && qi < cap; qi++) {
      const t = q[qi];
      const n = map.neighbors4(t, buf);
      for (let i = 0; i < n; i++) {
        const nb = buf[i];
        if (!map.isLand(nb) || seen.has(nb)) continue;
        if (map.owner[nb] === player.smallID) return t;
        if (map.owner[nb] !== targetId) continue;
        seen.add(nb);
        q.push(nb);
      }
    }
    return this.borderContact(player, targetId);
  }

  /** players (and neutral = null) that share a land border with `player` */
  neighbors(player: Player): { players: Player[]; neutral: boolean } {
    if (this.ticks !== this.neighborCacheTick) {
      this.neighborCache.clear();
      this.neighborCacheTick = this.ticks;
    }
    const hit = this.neighborCache.get(player.smallID);
    if (hit) return hit;
    const map = this.map;
    const buf = this.bbuf;
    const ids = new Set<number>();
    let neutral = false;
    const tiles = player.borderTiles;
    const size = tiles.size;
    const step = size > 2500 ? Math.ceil(size / 2500) : 1;
    let i = 0;
    for (const t of tiles) {
      if (step > 1 && i++ % step !== 0) continue;
      const n = map.neighbors4(t, buf);
      for (let k = 0; k < n; k++) {
        const nb = buf[k];
        if (!map.isLand(nb)) continue;
        const o = map.owner[nb];
        if (o === 0) neutral = true;
        else if (o !== player.smallID) ids.add(o);
      }
    }
    const players: Player[] = [];
    for (const id of ids) {
      const p = this.players[id];
      if (p && p.alive) players.push(p);
    }
    const result = { players, neutral };
    this.neighborCache.set(player.smallID, result);
    return result;
  }

  /** remaining unowned land tiles in a country/state */
  unownedInCountry(countryId: number): number {
    if (countryId <= 0 || countryId >= this.countryUnowned.length) return 0;
    return this.countryUnowned[countryId];
  }
  homeFront(player: Player): { invaders: Player[]; neutralHome: boolean } {
    if (this.ticks !== this.homeFrontCacheTick) {
      this.homeFrontCache.clear();
      this.homeFrontCacheTick = this.ticks;
    }
    const cached = this.homeFrontCache.get(player.smallID);
    if (cached) return cached;
    const home = player.countryId;
    if (home === 0) {
      const n = this.neighbors(player);
      const result = { invaders: n.players, neutralHome: n.neutral };
      this.homeFrontCache.set(player.smallID, result);
      return result;
    }
    const map = this.map;
    const buf = this.bbuf;
    const ids = new Set<number>();
    let neutralHome = false;
    const tiles = player.borderTiles;
    const size = tiles.size;
    const step = size > 2500 ? Math.ceil(size / 2500) : 1;
    let i = 0;
    for (const t of tiles) {
      if (step > 1 && i++ % step !== 0) continue;
      const n = map.neighbors4(t, buf);
      for (let k = 0; k < n; k++) {
        const nb = buf[k];
        if (!map.isLand(nb) || map.country[nb] !== home) continue;
        const o = map.owner[nb];
        if (o === 0) neutralHome = true;
        else if (o !== player.smallID) ids.add(o);
      }
    }
    const invaders: Player[] = [];
    for (const id of ids) {
      const p = this.players[id];
      if (p && p.alive) invaders.push(p);
    }
    const result = { invaders, neutralHome };
    this.homeFrontCache.set(player.smallID, result);
    return result;
  }

  shoreTiles(player: Player): TileRef[] {
    const out: TileRef[] = [];
    for (const t of player.borderTiles) if (this.map.isShore(t)) out.push(t);
    return out;
  }

  // ---------- spawn ----------
  canSpawnAt(tile: TileRef, player: Player): boolean {
    const map = this.map;
    if (!map.isLand(tile)) return false;
    if (map.owner[tile] !== 0) return false;
    if (player.countryId !== 0 && map.country[tile] !== player.countryId) return false;
    const minD = this.config.minDistanceBetweenPlayers();
    if (minD > 0 && player.type !== PlayerType.Human) {
      for (const p of this.allPlayers()) {
        if (p === player || !p.hasSpawned) continue;
        if (player.countryId !== 0 && p.countryId !== 0 && player.countryId !== p.countryId) continue;
        if (map.dist(p.spawnTile, tile) < minD) return false;
      }
    }
    return true;
  }

  randomSpawnTile(player: Player): TileRef {
    if (player.countryId !== 0) {
      const home = this.randomTileInCountry(player.countryId, player);
      if (home >= 0) return home;
    }
    const map = this.map;
    for (let i = 0; i < 4000; i++) {
      const t = this.random.nextInt(0, map.terrain.length - 1);
      if (!map.isLand(t)) continue;
      if (map.terrain[t] !== 1 && this.random.bool(0.6)) continue; // prefer plains
      if (this.canSpawnAt(t, player)) return t;
    }
    for (let i = 0; i < 20000; i++) {
      const t = this.random.nextInt(0, map.terrain.length - 1);
      if (map.isLand(t) && map.owner[t] === 0) return t;
    }
    return -1;
  }

  /** unowned land inside a country, preferring a legal spawn */
  randomTileInCountry(countryId: number, player: Player): TileRef {
    const map = this.map;
    const info = map.countries[countryId];
    if (info && info.centroid >= 0 && this.canSpawnAt(info.centroid, player)) return info.centroid;
    const len = map.terrain.length;
    let fallback = -1;
    for (let i = 0; i < 12_000; i++) {
      const t = this.random.nextInt(0, len - 1);
      if (!map.isLand(t) || map.country[t] !== countryId || map.owner[t] !== 0) continue;
      if (this.canSpawnAt(t, player)) return t;
      fallback = t;
    }
    return fallback;
  }

  /**
   * OpenFront spawn blob: every passable unowned land tile inside a
   * center-shifted Euclidean disk (radius 4 on the 2048 map). Coast and
   * mountains bite the edge so it reads as a smudge, not a coin.
   */
  spawnTilesAt(tile: TileRef, player?: Player): TileRef[] {
    const map = this.map;
    const R = this.config.spawnRadius();
    const r2 = R * R;
    const w = map.width;
    const cx = map.x(tile);
    const cy = map.y(tile);
    const rx = cx - 0.5;
    const ry = cy - 0.5;
    const box = Math.ceil(R) + 1;
    const out: TileRef[] = [];
    const countryId = player?.countryId ?? 0;
    for (let dy = -box; dy <= box; dy++) {
      for (let dx = -box; dx <= box; dx++) {
        const t = map.refWrapped(cx + dx, cy + dy);
        if (t < 0 || !map.isLand(t) || map.hasOwner(t) || map.isImpassable(t)) continue;
        if (countryId !== 0 && map.country[t] !== countryId) continue;
        let x = map.x(t) - rx;
        if (x > w / 2) x -= w;
        else if (x < -w / 2) x += w;
        const y = map.y(t) - ry;
        if (x * x + y * y > r2) continue;
        out.push(t);
      }
    }
    return out;
  }

  spawnPlayer(player: Player, tile: TileRef): void {
    if (player.hasSpawned) this.unspawn(player);
    const claimed = this.spawnTilesAt(tile, player);
    if (claimed.length === 0 && this.map.isLand(tile) && this.map.owner[tile] === 0) claimed.push(tile);
    for (const t of claimed) this.conquer(player, t);
    player.spawnTile = tile;
    player.hasSpawned = true;
    player.spawnedAt = this.ticks;
  }

  unspawn(player: Player): void {
    for (const t of [...player.tiles]) this.relinquish(t);
    player.hasSpawned = false;
    player.spawnTile = -1;
  }

  // ---------- units ----------
  addUnit(type: UnitType, owner: Player, tile: TileRef): Unit {
    const u = new Unit(type, owner, tile, this.nextUnitId++);
    u.createdAt = this.ticks;
    u.fx = this.map.x(tile) + 0.5;
    u.fy = this.map.y(tile) + 0.5;
    const dur = this.config.constructionTicks(type);
    if (dur > 0) {
      u.constructing = true;
      u.readyAt = this.ticks + dur;
      // a silo cannot fire before it is finished
      if (type === UnitType.MissileSilo) u.cooldownUntil = u.readyAt;
    }
    owner.units.push(u);
    this.units.add(u);
    this.indexStructure(u);
    this.onUnitAdded?.(u);
    // Instant-build (dev mode) never sets `constructing`, so completeConstruction
    // would never fire — factories/cities must still join the rail network.
    if (dur === 0) {
      if (type === UnitType.SAMLauncher) u.samAmmo = u.level;
      if (type === UnitType.DefensePost) this.refreshDefenseCover(u.tile);
      this.rail.onStructureCompleted(u);
    }
    return u;
  }
  removeUnit(u: Unit): void {
    if (!u.active) return;
    const wasPost = u.type === UnitType.DefensePost && !u.constructing;
    this.unindexStructure(u);
    u.delete();
    this.units.delete(u);
    this.rail.onUnitRemoved(u);
    if (wasPost) this.refreshDefenseCover(u.tile);
    this.onUnitRemoved?.(u);
  }
  transferUnit(u: Unit, to: Player): void {
    const i = u.owner.units.indexOf(u);
    if (i >= 0) u.owner.units.splice(i, 1);
    u.owner = to;
    to.units.push(u);
    if (u.type === UnitType.DefensePost && !u.constructing) this.refreshDefenseCover(u.tile);
  }
  private completeConstruction(u: Unit): void {
    u.constructing = false;
    if (u.type === UnitType.SAMLauncher) u.samAmmo = u.level;
    if (u.type === UnitType.DefensePost) this.refreshDefenseCover(u.tile);
    this.rail.onStructureCompleted(u);
    if (u.owner === this.human) this.displayMessage(`${unitLabel(u.type)} completed`, MessageType.Success, u.owner.smallID);
    this.onConstructionComplete?.(u);
    u.owner.linkedFactTick = -100;
  }

  /** number of live trains (engines only — carriages share the engine's target) */
  trainCount(): number {
    if (this.trainNTick === this.ticks) return this.trainN;
    let n = 0;
    for (const u of this.units) {
      if (u.type === UnitType.Train && u.active && u.targetUnit !== null && u.targetUnit.type !== UnitType.Train) n++;
    }
    this.trainN = n;
    this.trainNTick = this.ticks;
    return n;
  }

  private indexStructure(u: Unit): void {
    if (!u.isStructure()) return;
    let list = this.structByTile.get(u.tile);
    if (!list) {
      list = [];
      this.structByTile.set(u.tile, list);
    }
    if (list.indexOf(u) < 0) list.push(u);
  }
  private unindexStructure(u: Unit): void {
    if (!u.isStructure()) return;
    const list = this.structByTile.get(u.tile);
    if (!list) return;
    const i = list.indexOf(u);
    if (i >= 0) list.splice(i, 1);
    if (list.length === 0) this.structByTile.delete(u.tile);
  }

  hasUnitNearby(tile: TileRef, range: number, type: UnitType, owner: Player): boolean {
    const r2 = range * range;
    for (const u of owner.units) {
      if (u.type !== type || !u.active || u.constructing) continue;
      if (this.map.distSq(u.tile, tile) <= r2) return true;
    }
    return false;
  }

  /** structures sitting on this exact tile */
  structuresAt(tile: TileRef): Unit[] {
    return this.structByTile.get(tile) ?? EMPTY_UNITS;
  }

  /** owned count used for pricing (MIRV scales with MIRV launches; Factory+Port share a curve) */
  ownedForCost(player: Player, type: UnitType): number {
    if (type === UnitType.MIRV) return player.stats.mirvsLaunched;
    if (type === UnitType.Factory || type === UnitType.Port) return player.unitLevels(UnitType.Factory) + player.unitLevels(UnitType.Port);
    return player.unitLevels(type);
  }

  nearestPort(owner: Player, from: TileRef): Unit | null {
    let best: Unit | null = null;
    let bestD = Infinity;
    for (const u of owner.units) {
      if (u.type !== UnitType.Port || !u.active || u.constructing) continue;
      const d = this.map.distSq(u.tile, from);
      if (d < bestD) {
        bestD = d;
        best = u;
      }
    }
    return best;
  }

  setEmbargo(from: Player, to: Player, on: boolean): void {
    if (on) {
      if (from.embargoes.has(to.smallID)) {
        from.embargoUntil.set(to.smallID, this.ticks + this.config.embargoDuration());
        return;
      }
      from.embargoes.add(to.smallID);
      from.embargoUntil.set(to.smallID, this.ticks + this.config.embargoDuration());
      this.displayMessage(`You embargoed ${to.name}`, MessageType.Info, from.smallID);
      this.displayMessage(`${from.name} embargoed you`, MessageType.Warn, to.smallID);
    } else {
      if (!from.embargoes.has(to.smallID)) return;
      from.embargoes.delete(to.smallID);
      from.embargoUntil.delete(to.smallID);
      this.displayMessage(`Embargo on ${to.name} lifted`, MessageType.Info, from.smallID);
    }
  }

  embargoAll(from: Player, on: boolean): void {
    for (const p of this.alivePlayers()) {
      if (p === from || from.isFriendly(p) || p.type === PlayerType.Bot) continue;
      this.setEmbargo(from, p, on);
    }
  }

  markDelete(player: Player, u: Unit): boolean {
    if (!u.active || u.owner !== player || !u.isStructure()) return false;
    if (u.deleteAt >= 0) return this.cancelDelete(player, u);
    u.deleteAt = this.ticks + this.config.structureDeleteTicks();
    if (player.isHuman()) this.displayMessage(`${unitLabel(u.type)} will be demolished in 30s`, MessageType.Warn, player.smallID);
    return true;
  }

  cancelDelete(player: Player, u: Unit): boolean {
    if (!u.active || u.owner !== player || u.deleteAt < 0) return false;
    u.deleteAt = -1;
    if (player.isHuman()) this.displayMessage(`${unitLabel(u.type)} demolition cancelled`, MessageType.Info, player.smallID);
    return true;
  }

  /** Snap placement to an existing matching icon, with surface-distance scaling. */
  stackTarget(player: Player, type: UnitType, tile: TileRef): Unit | undefined {
    let best: Unit | undefined;
    let distance = Math.max(4, this.map.tiles(4)) ** 2;
    for (const u of player.units) {
      if (!u.active || u.type !== type) continue;
      let dx = Math.abs(this.map.x(u.tile) - this.map.x(tile));
      dx = Math.min(dx, this.map.width - dx);
      const y = (this.map.y(u.tile) + this.map.y(tile) + 1) / 2;
      dx *= Math.sin(Math.PI * y / this.map.height);
      const dy = this.map.y(u.tile) - this.map.y(tile);
      const d = dx * dx + dy * dy;
      if (d <= distance && (!best || d < distance || u.id < best.id)) { best = u; distance = d; }
    }
    return best;
  }

  /** SAM range, 1.5× if a friendly Radar covers the launcher; stacked SAMs add 15% each */
  effectiveSamRange(sam: Unit): number {
    const base = this.config.samRange(sam.level);
    let range = base;
    const stacked = this.structuresAt(sam.tile).filter((u) => u.type === UnitType.SAMLauncher && u.active && !u.constructing).length;
    if (stacked > 1) range *= 1 + 0.15 * (stacked - 1);
    for (const p of this.allPlayers()) {
      if (p !== sam.owner && !sam.owner.isFriendly(p)) continue;
      for (const radar of p.unitsOf(UnitType.Radar)) {
        if (!radar.active || radar.constructing) continue;
        if (this.map.surfaceDistance(sam.tile, radar.tile) <= this.config.radarRange(radar.level)) return range * this.config.radarSamBonus();
      }
    }
    return range;
  }

  /** can `player` build `type` at `tile`? returns error string or null */
  canBuild(player: Player, type: UnitType, tile: TileRef, prepaid = false): string | null {
    const map = this.map;
    if (!player.alive) return "You have no territory";
    if (!map.isValid(tile)) return "Invalid location";
    if (this.config.isUnitDisabled(type)) return `${unitLabel(type)} is disabled`;
    if (STRUCTURES.has(type)) {
      if (map.owner[tile] !== player.smallID) return "Must build on your own territory";
      if (type === UnitType.Port && !this.stackTarget(player, type, tile) && !map.isShore(tile)) return "Docks must be built on the coast";
      const here = this.structuresAt(tile);
      if (here.length >= this.config.maxStack() && !here.some((u) => u.type === type)) return "Stack is full";
      const same = this.stackTarget(player, type, tile);
      if (same && same.deleteAt >= 0) return "Cancel demolition before upgrading";
      if (same?.constructing) return "Wait for construction to finish";
      if (same && same.level >= this.config.maxLevel(type)) return `${unitLabel(type)} already ×${same.level} (max)`;
    }
    if (type === UnitType.Warship) {
      if (!this.isDev()) {
        if (player.unitCount(UnitType.Port) === 0) return "Requires a Dock";
        if (player.unitsOf(UnitType.Port).every((p) => p.constructing)) return "Dock still under construction";
      }
      if (!map.isWater(tile)) return "Warships are deployed on water";
    }
    if (NUKES.has(type) && type !== UnitType.MIRVWarhead) {
      if (this.config.settings.disableNukes) return "Nukes are disabled";
      if (!this.isDev()) {
        if (player.unitCount(UnitType.MissileSilo) === 0) return "Requires a Missile Silo";
        if (player.unitsOf(UnitType.MissileSilo).every((s) => s.constructing)) return "Silo still under construction";
      }
      if (!map.isLand(tile)) return "Target must be land";
    }
    if (!prepaid && !this.isDev()) {
      const existing = STRUCTURES.has(type) ? this.stackTarget(player, type, tile) : undefined;
      const cost = existing ? this.config.upgradeCost(type, existing.level) : this.config.unitCost(type, this.ownedForCost(player, type));
      if (player.gold < cost) return `Not enough gold (${fmt(cost)})`;
    }
    return null;
  }

  // ---------- diplomacy ----------
  requestAlliance(from: Player, to: Player): AllianceRequest | null {
    if (from === to || from.isAlliedWith(to)) return null;
    if (from.incomingAllianceRequests.some((r) => r.requestor === to && r.status === "pending")) {
      // both want it: accept theirs
      const r = from.incomingAllianceRequests.find((r) => r.requestor === to && r.status === "pending")!;
      this.acceptAlliance(r);
      return r;
    }
    if (to.incomingAllianceRequests.some((r) => r.requestor === from && r.status === "pending")) return null;
    const last = from.lastAllianceRequestAt.get(to.smallID) ?? -Infinity;
    if (this.ticks - last < this.config.allianceRequestCooldown()) return null;
    from.lastAllianceRequestAt.set(to.smallID, this.ticks);
    const req: AllianceRequest = { id: this.requestId++, requestor: from, recipient: to, createdAt: this.ticks, status: "pending" };
    to.incomingAllianceRequests.push(req);
    from.outgoingAllianceRequests.push(req);
    if (to.isHuman()) {
      this.events.push({
        tick: this.ticks,
        type: MessageType.Alliance,
        text: `${from.name} requests an alliance`,
        to: to.smallID,
        from: from.smallID,
        allianceRequestId: req.id,
      });
    }
    return req;
  }

  acceptAlliance(req: AllianceRequest): void {
    if (req.status !== "pending") return;
    req.status = "accepted";
    this.removeRequest(req);
    const a: Alliance = {
      id: this.allianceId++,
      a: req.requestor,
      b: req.recipient,
      createdAt: this.ticks,
      expiresAt: this.ticks + this.config.allianceDuration(),
    };
    req.requestor.alliances.push(a);
    req.recipient.alliances.push(a);
    req.requestor.updateRelation(req.recipient, 40);
    req.recipient.updateRelation(req.requestor, 40);
    req.requestor.embargoes.delete(req.recipient.smallID);
    req.recipient.embargoes.delete(req.requestor.smallID);
    // cancel attacks between them (they retreat on their own next tick via isFriendly)
    this.displayMessage(`Alliance formed with ${req.recipient.name}`, MessageType.Success, req.requestor.smallID);
    this.displayMessage(`Alliance formed with ${req.requestor.name}`, MessageType.Success, req.recipient.smallID);
  }

  rejectAlliance(req: AllianceRequest): void {
    if (req.status !== "pending") return;
    req.status = "rejected";
    this.removeRequest(req);
    req.requestor.updateRelation(req.recipient, -10);
    this.displayMessage(`${req.recipient.name} rejected your alliance request`, MessageType.Info, req.requestor.smallID);
  }

  private removeRequest(req: AllianceRequest): void {
    const i = req.recipient.incomingAllianceRequests.indexOf(req);
    if (i >= 0) req.recipient.incomingAllianceRequests.splice(i, 1);
    const j = req.requestor.outgoingAllianceRequests.indexOf(req);
    if (j >= 0) req.requestor.outgoingAllianceRequests.splice(j, 1);
  }

  private expireAllianceRequests(): void {
    if (this.ticks % 10 !== 0) return;
    for (const p of this.allPlayers()) {
      for (const r of [...p.incomingAllianceRequests]) {
        if (this.ticks - r.createdAt > this.config.allianceRequestTimeout()) {
          r.status = "expired";
          this.removeRequest(r);
        }
      }
    }
  }

  /** breaking an alliance marks the breaker as traitor */
  breakAlliance(breaker: Player, other: Player): void {
    const a = breaker.allianceWith(other);
    if (!a) return;
    this.removeAlliance(a);
    breaker.traitorUntil = this.ticks + this.config.traitorDuration();
    other.updateRelation(breaker, -100);
    for (const p of this.allPlayers()) if (p !== breaker && p !== other) p.updateRelation(breaker, -20);
    this.displayMessage(`You betrayed ${other.name} and are marked as a traitor`, MessageType.Warn, breaker.smallID);
    this.displayMessage(`${breaker.name} betrayed you!`, MessageType.Error, other.smallID);
    this.onAllianceBroken?.(breaker, other);
  }

  private removeAlliance(a: Alliance): void {
    for (const p of [a.a, a.b]) {
      const i = p.alliances.indexOf(a);
      if (i >= 0) p.alliances.splice(i, 1);
    }
  }

  private expireAlliances(): void {
    if (this.ticks % 10 !== 0) return;
    const seen = new Set<Alliance>();
    for (const p of this.allPlayers()) {
      for (const a of [...p.alliances]) {
        if (seen.has(a)) continue;
        seen.add(a);
        if (a.expiresAt <= this.ticks) {
          this.removeAlliance(a);
          this.displayMessage(`Alliance with ${a.b.name} expired`, MessageType.Info, a.a.smallID);
          this.displayMessage(`Alliance with ${a.a.name} expired`, MessageType.Info, a.b.smallID);
        } else if (a.expiresAt - this.ticks === 30 * TICKS_PER_SECOND) {
          if (a.a.isHuman()) this.displayMessage(`Alliance with ${a.b.name} expires in 30s`, MessageType.Alliance, a.a.smallID, { from: a.b.smallID });
          if (a.b.isHuman()) this.displayMessage(`Alliance with ${a.a.name} expires in 30s`, MessageType.Alliance, a.b.smallID, { from: a.a.smallID });
        }
      }
    }
  }

  extendAlliance(p: Player, other: Player): void {
    const a = p.allianceWith(other);
    if (!a) return;
    a.expiresAt = this.ticks + this.config.allianceDuration();
    this.displayMessage(`Alliance with ${other.name} extended`, MessageType.Success, p.smallID);
    this.displayMessage(`${p.name} extended your alliance`, MessageType.Success, other.smallID);
  }

  donateTroops(from: Player, to: Player, amount: number): boolean {
    if (!from.isAlliedWith(to)) return false;
    amount = Math.min(from.troops, Math.floor(amount));
    if (amount <= 0) return false;
    from.removeTroops(amount);
    to.addTroops(amount);
    to.updateRelation(from, 25);
    this.displayMessage(`${from.name} sent you ${fmtTroops(amount)} troops`, MessageType.Success, to.smallID);
    return true;
  }
  donateGold(from: Player, to: Player, amount: number): boolean {
    if (!from.isAlliedWith(to)) return false;
    amount = Math.min(from.gold, Math.floor(amount));
    if (amount <= 0) return false;
    from.gold -= amount;
    to.addGold(amount);
    to.updateRelation(from, 25);
    this.displayMessage(`${from.name} sent you ${fmt(amount)} gold`, MessageType.Success, to.smallID);
    return true;
  }

  sendEmoji(from: Player, to: Player | null, emoji: string): void {
    this.events.push({
      tick: this.ticks,
      type: MessageType.Chat,
      text: `${from.name}: ${emoji}`,
      from: from.smallID,
      to: to ? to.smallID : undefined,
      emoji,
    });
  }

  // ---------- combat callbacks ----------
  onAttackStarted(a: AttackExecution): void {
    if (!a.target) return;
    if (a.target.isHuman()) {
      this.events.push({
        tick: this.ticks,
        type: MessageType.AttackIncoming,
        text: `${a.owner.name} attacks you with ${fmtTroops(a.troops())} troops`,
        to: a.target.smallID,
        from: a.owner.smallID,
        attackId: a.id,
      });
    }
    if (a.owner.isHuman()) {
      this.events.push({
        tick: this.ticks,
        type: MessageType.AttackOutgoing,
        text: `Attacking ${a.target.name} with ${fmtTroops(a.troops())} troops`,
        to: a.owner.smallID,
        from: a.target.smallID,
        attackId: a.id,
      });
    }
  }

  /** victim is annexed by attacker: remaining tiles & structures transfer */
  conquerPlayer(attacker: Player, victim: Player): void {
    for (const t of [...victim.tiles]) this.conquer(attacker, t);
    this.handleDeath(victim, attacker);
  }

  private handleDeath(p: Player, killer: Player | null): void {
    if (p.diedAt >= 0) return;
    p.diedAt = this.ticks;
    for (const t of [...p.tiles]) this.relinquish(t);
    for (const u of [...p.units]) {
      if (u.isStructure() && killer) this.transferUnit(u, killer);
      else this.removeUnit(u);
    }
    for (const a of [...p.alliances]) this.removeAlliance(a);
    for (const r of [...p.incomingAllianceRequests, ...p.outgoingAllianceRequests]) {
      r.status = "expired";
      this.removeRequest(r);
    }
    for (const a of [...p.incomingAttacks]) a.returnUnusedTroops();
    for (const a of [...p.outgoingAttacks]) a.deleteAttack();
    if (killer) {
      killer.stats.playersKilled++;
      const loot = Math.floor(p.gold);
      p.gold = 0;
      let bonus = 0;
      let troops = 0;
      if (p.type === PlayerType.Nation || p.type === PlayerType.Bot) {
        const held = Math.max(1, p.peakLandArea);
        bonus = this.config.nationTakeoverGold(held);
        troops = this.config.nationTakeoverTroops(held);
        if (troops > 0) killer.addTroops(troops);
      }
      killer.addGold(loot + bonus);
      if (p.type !== PlayerType.Bot || killer.isHuman()) {
        const pay = loot + bonus;
        const extra = pay > 0 || troops > 0 ? `: +${fmt(pay)} gold, +${fmtTroops(troops)} troops` : "";
        this.displayMessage(`${killer.name} conquered ${p.name}${extra}`, MessageType.Info);
        if (killer === this.human && (bonus > 0 || troops > 0) && p.spawnTile >= 0) this.onGoldFloat?.(p.spawnTile, loot + bonus, killer, troops);
      }
    }
    this.onPlayerDied?.(p, killer);
  }

  // ---------- fallout ----------
  addFallout(tile: TileRef): void {
    this.map.setFallout(tile, true);
    this.falloutExpiry.set(tile, this.ticks + this.config.falloutDuration());
  }
  private expireFallout(): void {
    for (const [t, exp] of this.falloutExpiry) {
      if (exp <= this.ticks) {
        this.map.setFallout(t, false);
        this.falloutExpiry.delete(t);
      }
    }
  }

  // ---------- messaging ----------
  displayMessage(text: string, type: MessageType = MessageType.Info, to?: PlayerID, extra?: Partial<GameEvent>): void {
    if (to !== undefined && this.human && to !== this.human.smallID) return; // only the human needs UI events
    this.events.push({ tick: this.ticks, type, text, to, ...extra });
  }

  // ---------- win ----------
  landPercent(p: Player): number {
    return this.map.landArea > 0 ? Math.min(100, (p.landArea / this.map.landArea) * 100) : 0;
  }
  private checkWin(): void {
    const need = this.config.winPercent();
    let leader: Player | null = null;
    let best = 0;
    for (const p of this.alivePlayers()) {
      const pct = this.landPercent(p);
      if (pct > best) {
        best = pct;
        leader = p;
      }
      if (pct >= need) {
        this.winner = p;
        this.displayMessage(`${p.name} has conquered ${need}% of the world!`, MessageType.Success);
        return;
      }
    }
    const cap = this.config.settings.maxTimerMinutes;
    if (cap && this.elapsedSeconds() >= cap * 60 && leader) {
      this.winner = leader;
      this.displayMessage(`${leader.name} leads on time (${best.toFixed(1)}%)`, MessageType.Success);
    }
  }
}

export function unitLabel(t: UnitType): string {
  switch (t) {
    case UnitType.City:
      return "City";
    case UnitType.Factory:
      return "Factory";
    case UnitType.DefensePost:
      return "Defense Post";
    case UnitType.Port:
      return "Dock";
    case UnitType.MissileSilo:
      return "Missile Silo";
    case UnitType.SAMLauncher:
      return "SAM Launcher";
    case UnitType.Radar:
      return "Radar";
    case UnitType.Warship:
      return "Warship";
    case UnitType.TransportShip:
      return "Transport";
    case UnitType.TradeShip:
      return "Trade Ship";
    case UnitType.Train:
      return "Train";
    case UnitType.AtomBomb:
      return "Atom Bomb";
    case UnitType.HydrogenBomb:
      return "Hydrogen Bomb";
    case UnitType.MIRV:
      return "MIRV";
    case UnitType.MIRVWarhead:
      return "MIRV Warhead";
    case UnitType.Shell:
      return "Shell";
    case UnitType.SAMMissile:
      return "SAM Missile";
  }
}

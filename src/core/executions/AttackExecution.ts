import { frontArrival, frontResistance, invasionResistance } from "../frontGeometry";
import { FlatBinaryHeap } from "../BinaryHeap";
import type { Game, Execution } from "../Game";
import type { GameMap } from "../GameMap";
import type { Player } from "../Player";
import { PseudoRandom } from "../PseudoRandom";
import { MessageType, PlayerType, TerrainType, type TileRef } from "../types";

let nextAttackId = 1;

/**
 * Tile-by-tile conquest of a target (player or terra nullius), ported from the
 * OpenFront/FrontWars rules: a priority queue of frontier tiles, each tick
 * conquers tiles until the tick budget is spent.
 */
export class AttackExecution implements Execution {
  id = nextAttackId++;
  private active = true;
  private toConquer = new FlatBinaryHeap(16384);
  private random: PseudoRandom;
  private game!: Game;
  private map!: GameMap;
  private ownerSmallID: number;
  private targetSmallID: number;
  private nbuf: TileRef[] = [0, 0, 0, 0, 0, 0, 0, 0];
  private nbuf2: TileRef[] = [0, 0, 0, 0, 0, 0, 0, 0];
  /** tiles on the attack front (for borderSize) */
  private border = new Set<TileRef>();
  private troops_ = 0;
  private retreated_ = false;
  private retreatAt = -1;
  private started = false;
  /** target-side tile where the army crosses */
  private focus: TileRef = -1;
  private readyAt = 0;
  private conquestCredit = 0;
  private arrivals = new Map<TileRef, number>();
  private resistance = new Map<TileRef, number>();
  private queuedPriority = new Map<TileRef, number>();
  countryId = 0;
  readonly activeDuringSpawnPhase = false;

  constructor(
    private startTroops: number | null,
    readonly owner: Player,
    /** null = terra nullius */
    readonly target: Player | null,
    readonly sourceTile: TileRef | null = null,
    /** false when troops were already removed from the owner (boat landings) */
    private removeTroops = true,
    /**
     * Boat / naval landing: the source tile was just conquered. Flood the
     * connected target from that beachhead (OpenFront TransportShipExecution).
     * Do not clip to a country or require a pre-existing land border.
     */
    private fromLanding = false,
  ) {
    this.random = new PseudoRandom(this.id * 7919 + 123);
    this.ownerSmallID = owner.smallID;
    this.targetSmallID = target ? target.smallID : 0;
  }

  troops(): number {
    return this.troops_;
  }
  setTroops(n: number): void {
    if(n>this.troops_)this.conquestCredit=Math.min(1,this.conquestCredit);
    this.troops_ = n;
  }
  borderSize(): number {
    return this.border.size;
  }
  /** target tiles currently on the front (about to be conquered) */
  frontTiles(): ReadonlySet<TileRef> {
    return this.border;
  }

  /** last tile taken this attack — used as a fallback if the front is empty */
  private labelTile: TileRef = -1;

  /** where the army crossed — fallback if the front has not formed yet. */
  entryTile(): TileRef {
    if (this.focus >= 0) return this.focus;
    if (this.sourceTile !== null) return this.sourceTile;
    return this.labelTile;
  }

  /**
   * Tile on the fighting edge (centroid of the current front).
   */
  frontAnchor(): TileRef {
    const pos = this.clusteredPositions();
    if (pos.length) return pos[0];
    return this.labelTile;
  }

  /**
   * Representative tile in the middle of the attack front — the troop number sits here.
   */
  clusteredPositions(): TileRef[] {
    const map = this.map;
    const tiles = this.border;
    if (!map || tiles.size === 0) {
      const t = this.labelTile >= 0 ? this.labelTile : this.entryTile();
      return t >= 0 ? [t] : [];
    }
    const w = map.width;
    const step = tiles.size > 400 ? Math.ceil(tiles.size / 400) : 1;
    let i = 0;
    let refX = -1;
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    const samples: TileRef[] = [];
    for (const t of tiles) {
      if (i++ % step !== 0) continue;
      let x = map.x(t);
      const y = map.y(t);
      if (refX < 0) refX = x;
      else {
        let dx = x - refX;
        if (dx > w / 2) x -= w;
        else if (dx < -w / 2) x += w;
      }
      sumX += x;
      sumY += y;
      count++;
      samples.push(t);
    }
    if (count === 0) return [];
    const cx = sumX / count;
    const cy = sumY / count;
    let best = samples[0];
    let bestDist = Infinity;
    for (const t of samples) {
      let dx = map.x(t) - cx;
      if (dx > w / 2) dx -= w;
      else if (dx < -w / 2) dx += w;
      const dy = map.y(t) - cy;
      const d = dx * dx + dy * dy;
      if (d < bestDist) {
        bestDist = d;
        best = t;
      }
    }
    return [best];
  }
  isActive(): boolean {
    return this.active;
  }
  retreated(): boolean {
    return this.retreated_;
  }
  /** order the attack to retreat (survivors return after a short delay) */
  orderRetreat(): void {
    if (this.retreated_) return;
    this.retreated_ = true;
    this.retreatAt = this.game ? this.game.ticks + this.game.config.retreatDelayTicks() : 0;
  }

  /** attack finished or the target died — leftover troops go home, no retreat malus */
  returnUnusedTroops(): void {
    if (!this.active) return;
    this.retreat();
  }

  init(game: Game): void {
    this.game = game;
    this.id = game.nextAttackId++;
    this.random = new PseudoRandom(game.random.nextInt(1, 0x7fffffff));
    this.map = game.map;
    if (this.target === this.owner) {
      this.active = false;
      return;
    }
    if (this.target && !this.target.alive) {
      if (!this.removeTroops) this.owner.addTroops(this.startTroops ?? 0);
      this.active = false;
      return;
    }
    if (this.target && this.owner.isFriendly(this.target)) {
      if (!this.removeTroops) this.owner.addTroops(this.startTroops ?? 0);
      game.displayMessage(`Cannot attack ${this.target.name}: you are allied`, MessageType.Warn, this.owner.smallID);
      this.active = false;
      return;
    }
    if (this.target && this.removeTroops && game.ticks - this.target.spawnedAt < game.config.spawnImmunityTicks()) {
      this.active = false;
      return;
    }
    this.startTroops ??= game.config.attackAmount(this.owner.type, this.owner.troops, this.owner.attackRatio);
    if (this.removeTroops) {
      this.startTroops = Math.min(this.owner.troops, this.startTroops);
      this.startTroops = this.owner.removeTroops(Math.floor(this.startTroops));
    }
    this.troops_ = Math.floor(this.startTroops);
    if (this.troops_ < 1) {
      this.active = false;
      return;
    }

    if (this.target && this.removeTroops && !this.fromLanding) {
      // A land invasion attacks the opponent along every shared frontier.
      // A click identifies the opponent; it is not a radial expansion origin.
      this.focus = game.borderContact(this.owner, this.targetSmallID);
      this.countryId = 0;
      this.refreshToConquer();
    } else if (this.sourceTile !== null) {
      this.seedFromSource(this.sourceTile);
      if (this.focus < 0) {
        this.owner.addTroops(this.troops_);
        this.active = false;
        return;
      }
    } else {
      this.focus = game.borderContact(this.owner, this.targetSmallID);
      this.countryId = !this.target && this.focus >= 0 ? this.map.country[this.focus] || 0 : 0;
      this.refreshToConquer();
    }
    if (this.toConquer.size() === 0) {
      this.owner.addTroops(this.troops_);
      this.active = false;
      return;
    }

    this.readyAt = this.target && this.removeTroops ? game.ticks + game.config.attackMarchTicks() : game.ticks;
    if (this.target) game.onBorderAssault?.(this.focus, this.owner.color);

    // cancel out opposing attacks
    if (this.target) {
      for (const incoming of [...this.owner.incomingAttacks]) {
        if (incoming.owner === this.target && incoming.isActive()) {
          if (incoming.troops() > this.troops_) {
            incoming.setTroops(incoming.troops() - this.troops_);
            this.active = false;
            return;
          } else {
            this.troops_ -= incoming.troops();
            incoming.deleteAttack();
          }
        }
      }
    }
    // extra clicks on the same target dump troops into the existing land attack
    if (this.removeTroops) {
      for (const outgoing of this.owner.outgoingAttacks) {
        if (outgoing !== this && outgoing.target === this.target && outgoing.removeTroops && outgoing.countryId === this.countryId && !outgoing.retreated() && outgoing.isActive()) {
          outgoing.setTroops(outgoing.troops() + this.troops_);
          outgoing.refreshToConquer();
          this.troops_ = 0;
          this.active = false;
          return;
        }
      }
    }

    this.owner.outgoingAttacks.push(this);
    if (this.target) {
      this.target.incomingAttacks.push(this);
      this.target.updateRelation(this.owner, game.config.relationChangeOnAttack());
      if (this.owner.type !== PlayerType.Bot || this.target.type !== PlayerType.Bot) {
        this.target.embargoes.add(this.owner.smallID);
      }
      game.onAttackStarted(this);
    }
    this.started = true;
  }

  /**
   * Start the flood from a specific tile. Boat landings have already taken that
   * tile, so OpenFront only enqueues its target-owned neighbours — looking up
   * `attackContact` would search an existing land border and abort overseas.
   */
  private seedFromSource(src: TileRef): void {
    const ours = this.map.owner[src] === this.ownerSmallID;
    const targetOwned = this.map.owner[src] === this.targetSmallID;
    if (this.fromLanding || (!this.removeTroops && ours)) {
      this.focus = src;
      this.labelTile = src;
      this.countryId = this.fromLanding || this.target ? 0 : this.map.country[src] || 0;
      if (targetOwned) this.tryEnqueue(src, 0);
      else { this.arrivals.set(src, 0); this.addNeighbors(src); }
      return;
    }
    if (!this.target && this.removeTroops) {
      // The click selects a neutral gameplay region, not a single crossing.
      this.countryId = this.map.country[src] || 0;
      this.focus = this.game.borderContact(this.owner, 0, this.countryId);
      if (this.focus >= 0) this.refreshToConquer();
      return;
    }
    this.focus = targetOwned ? src : this.game.attackContact(this.owner, src, this.targetSmallID);
    if (this.focus < 0) return;
    this.countryId = this.target ? 0 : this.map.country[this.focus] || 0;
    if (this.map.owner[this.focus] === this.targetSmallID) this.tryEnqueue(this.focus, 0);
  }

  /** Seed shared borders for normal land invasions and their reinforcements. */
  private refreshToConquer(): void {
    this.toConquer.clear();
    this.border.clear();
    this.queuedPriority.clear();
    this.arrivals.clear();
    for (const tile of this.owner.borderTiles) this.arrivals.set(tile, 0);
    for (const tile of this.owner.borderTiles) this.addNeighbors(tile);
  }

  private tryEnqueue(tile: TileRef, seed?: number): void {
    const map = this.map;
    if (!map.isLand(tile) || map.owner[tile] !== this.targetSmallID) return;
    if (this.countryId !== 0 && map.country[tile] !== this.countryId) return;
    let priority = seed;
    if (priority === undefined) {
      let horizontal = Infinity, vertical = Infinity, support = 0;
      const n = map.neighbors4(tile, this.nbuf2);
      for (let i = 0; i < n; i++) {
        const nb = this.nbuf2[i];
        if (map.owner[nb] !== this.ownerSmallID) continue;
        support++;
        const arrival = this.arrivals.get(nb) ?? Infinity;
        if (map.y(nb) === map.y(tile)) horizontal = Math.min(horizontal, arrival);
        else vertical = Math.min(vertical, arrival);
      }
      let ground = this.resistance.get(tile);
      if (ground === undefined) {
        ground = frontResistance(map.x(tile), map.y(tile), map.width, map.height, this.game.config.settings.seed)
          * (0.8 + this.random.next() * 0.4);
        this.resistance.set(tile, ground);
      }
      const terrain = map.terrain[tile];
      const terrainCost = terrain === TerrainType.Mountain ? 2 : terrain === TerrainType.Highland ? 1.5 : 1;
      const defended = this.targetSmallID !== 0 && this.game.defenseCover[tile] === this.targetSmallID;
      // OpenFront's local terrain/support/random competition adapted to spherical
      // travel. Coherent variation prevents radial rings; perpendicular arrivals
      // prevent the four-neighbor Manhattan diamond without crossing water.
      const cost = this.target
        ? invasionResistance(terrainCost, support, ground, defended)
        : ground * terrainCost * Math.max(0.45, 1.15 - support * 0.15);
      priority = frontArrival(horizontal, vertical, Math.max(0.01, map.tileArea(tile))*cost,
        map.width/(2*map.height)*cost);
    }
    if (!Number.isFinite(priority) || priority >= (this.queuedPriority.get(tile) ?? Infinity) - 1e-8) return;
    this.border.add(tile);
    this.queuedPriority.set(tile, priority);
    this.toConquer.enqueue(tile, priority);
  }

  private addNeighbors(tile: TileRef): void {
    const n = this.map.neighbors4(tile, this.nbuf);
    for (let i = 0; i < n; i++) this.tryEnqueue(this.nbuf[i]);
  }

  /** removes the attack from the world without returning troops */
  deleteAttack(): void {
    this.active = false;
    this.detach();
    this.arrivals.clear();
    this.resistance.clear();
    this.queuedPriority.clear();
    this.toConquer.clear();
    this.border.clear();
  }

  private detach(): void {
    const i = this.owner.outgoingAttacks.indexOf(this);
    if (i >= 0) this.owner.outgoingAttacks.splice(i, 1);
    if (this.target) {
      const j = this.target.incomingAttacks.indexOf(this);
      if (j >= 0) this.target.incomingAttacks.splice(j, 1);
    }
  }

  private retreat(malusPercent = 0): void {
    const deaths = Math.floor(this.troops_ * (malusPercent / 100));
    const survivors = this.troops_ - deaths;
    if (deaths > 0) {
      this.game.displayMessage(`Retreat: lost ${fmtTroops(deaths)} troops`, MessageType.Warn, this.owner.smallID);
    }
    this.owner.addTroops(survivors);
    this.owner.stats.troopsLost += deaths;
    this.deleteAttack();
  }

  /** Unique frontier cells weighted by their exposed edge's surface length.
   * East/west expansion exposes a north/south edge; north/south expansion
   * exposes a longitude edge that shrinks toward the poles.
   */
  private surfaceFrontLength(): number {
    const map = this.map;
    let length = 0;
    for (const tile of this.border) {
      if (map.owner[tile] !== this.targetSmallID || !map.isLand(tile)) continue;
      let edge = 0;
      const n = map.neighbors4(tile, this.nbuf2);
      for (let i = 0; i < n; i++) {
        const nb = this.nbuf2[i];
        if (map.owner[nb] !== this.ownerSmallID) continue;
        edge = Math.max(edge, map.y(nb) === map.y(tile) ? map.width / (2 * map.height) : map.tileArea(tile));
      }
      length += edge;
    }
    return length;
  }

  tick(): void {
    if (!this.active) return;
    if (!this.started) {
      this.active = false;
      return;
    }
    let troopCount = this.troops_;
    const target = this.target;

    if (this.retreated_) {
      if (this.retreatAt >= 0 && this.game.ticks < this.retreatAt) return;
      this.retreat(target ? this.game.config.retreatMalusPercent() : 0);
      return;
    }
    if (this.game.ticks < this.readyAt) return;
    if (target && !target.alive) {
      this.retreat();
      return;
    }
    if (target && this.owner.isFriendly(target)) {
      this.retreat();
      return;
    }
    if (!this.owner.alive) {
      this.deleteAttack();
      return;
    }

    const map = this.map;
    const config = this.game.config;
    const cover = this.game.defenseCover;
    const borderSize = this.surfaceFrontLength() + this.random.nextInt(0, 5) / Math.sqrt(config.tileScale);
    // Globe pacing: enemy territory advances at half the upstream rate.
    // Keep casualty formulas unchanged and retain fractions for expensive tiles.
    this.conquestCredit += target ? 0.5 : 1;
    let tickBudget = this.conquestCredit;
    let examined = 0;
    let conqueredAny = false;
    const landTiles = target ? target.numTiles : this.owner.numTiles;
    const attackerInfo = { type: this.owner.type, numTiles: this.owner.landArea };
    const defenderInfo = target
      ? {
          type: target.type,
          numTiles: target.landArea,
          troops: target.troops,
          isTraitor: target.isTraitor(this.game.ticks),
        }
      : null;
    const falloutGlobal = map.numFalloutTiles > 0 ? map.numFalloutTiles / map.numLandTiles : 0;

    while (tickBudget > 0 && examined++ < 4096) {
      if (troopCount < 1) {
        this.troops_ = 0;
        this.deleteAttack();
        return;
      }
      if (this.toConquer.size() === 0) {
        // OpenFront: the connected flood is done. Do not re-seed every empire
        // border — that made the globe jump to every coastline at once.
        this.troops_ = Math.max(0, troopCount);
        this.retreat();
        return;
      }
      const tile = this.toConquer.peek();
      const priority = this.toConquer.peekPriority();
      if (priority !== this.queuedPriority.get(tile)) {
        this.toConquer.dequeue();
        continue;
      }

      let onBorder = false;
      const n = map.neighbors4(tile, this.nbuf);
      for (let i = 0; i < n; i++) {
        if (map.owner[this.nbuf[i]] === this.ownerSmallID) {
          onBorder = true;
          break;
        }
      }
      if (map.owner[tile] !== this.targetSmallID || !onBorder || !map.isLand(tile)) {
        this.toConquer.dequeue();
        this.border.delete(tile);
        this.queuedPriority.delete(tile);
        continue;
      }
      const terrain = map.terrain[tile];
      const defenderHasDefensePost = target !== null && cover[tile] === this.targetSmallID;
      const fallout = map.fallout[tile] !== 0;
      attackerInfo.numTiles = this.owner.landArea;
      if (defenderInfo && target) {
        defenderInfo.numTiles = target.landArea;
        defenderInfo.troops = target.troops;
      }
      const result = config.attackLogic({
        terrain, attackTroops: troopCount, attacker: attackerInfo,
        defender: defenderInfo, defenderHasDefensePost,
        falloutRatio: fallout ? falloutGlobal : null,
        borderSize: config.supportedAttackFront(borderSize, troopCount), landTiles,
        elapsedTicks: Math.max(0, this.game.ticks-config.spawnPhaseTicks()),
      });
      const area = map.tileArea(tile);
      const cost = result.attackerTroopLoss * area;
      const time = result.tickFraction * area;
      if (troopCount < cost) {
        this.troops_ = troopCount;
        this.retreat();
        return;
      }
      if (tickBudget < time) break;
      tickBudget -= time;
      this.toConquer.dequeue();
      this.border.delete(tile);
      this.queuedPriority.delete(tile);
      troopCount -= cost;
      this.owner.stats.troopsLost += cost;
      if (target) {
        const killed = target.removeTroops(result.defenderTroopLoss * area);
        this.owner.stats.troopsKilled += killed;
        target.stats.troopsLost += killed;
      }
      this.game.conquer(this.owner, tile);
      this.arrivals.set(tile, priority);
      this.addNeighbors(tile);
      this.labelTile = tile;
      this.owner.stats.tilesConquered++;
      conqueredAny = true;
    }
    // Retain unspent time if a tile is expensive or the CPU work guard yields.
    this.conquestCredit = tickBudget;
    this.troops_ = Math.max(0, troopCount);
    if (conqueredAny && target) this.handleDeadDefender();
  }

  private handleDeadDefender(): void {
    const target = this.target!;
    if (!target.alive) return;
    if (target.numTiles >= this.game.config.annexTilesThreshold()) return;
    if (target.numTiles > Math.max(1, target.peakTiles * 0.05)) return;
    for (const tile of target.tiles) if (!this.game.touches(this.owner, tile)) return;
    this.game.conquerPlayer(this.owner, target);
  }
}

export function fmt(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + "K";
  return Math.floor(n).toString();
}

/** OpenFront/FrontWars troop UI: internal headcount is 10× the number on screen. */
export function fmtTroops(n: number): string {
  return fmt(n / 10);
}

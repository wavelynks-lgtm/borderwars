import {DEFAULT_COSMETICS,type Cosmetics} from "../customization/cosmetics";
import type { AttackExecution } from "./executions/AttackExecution";
import type { Unit } from "./Unit";
import { PlayerType, Relation, STRUCTURES, UnitType, type PlayerID, type TileRef } from "./types";

export interface Alliance {
  id: number;
  a: Player;
  b: Player;
  createdAt: number;
  expiresAt: number;
}

export interface AllianceRequest {
  id: number;
  requestor: Player;
  recipient: Player;
  createdAt: number;
  status: "pending" | "accepted" | "rejected" | "expired";
}

export class Player {
  // identity
  readonly smallID: PlayerID;
  readonly name: string;
  readonly type: PlayerType;
  readonly color: string; // css hex
  readonly countryId: number; // 0 = none
  /** flag/emoji shown next to the name */
  readonly flag: string;
  cosmetics:Cosmetics={...DEFAULT_COSMETICS};

  // population
  troops = 0;
  workers = 0;
  gold = 0;
  /** desired share of population that are troops */
  targetTroopRatio = 0.6;
  attackRatio = 0.2;

  // territory
  landArea = 0;
  readonly tiles = new Set<TileRef>();
  readonly borderTiles = new Set<TileRef>();
  spawnTile: TileRef = -1;
  hasSpawned = false;
  spawnedAt = -1;
  /** most land this player ever held (for takeover rewards after tiles are gone) */
  peakTiles = 0;
  peakLandArea = 0;
  /** last player who took one of our tiles */
  lastAttackedBy: Player | null = null;
  /** true while the player has territory */
  get alive(): boolean {
    return this.hasSpawned && this.tiles.size > 0;
  }
  diedAt = -1;

  // units
  readonly units: Unit[] = [];

  // diplomacy
  readonly relations = new Map<PlayerID, number>(); // -100..100
  readonly alliances: Alliance[] = [];
  readonly incomingAllianceRequests: AllianceRequest[] = [];
  readonly outgoingAllianceRequests: AllianceRequest[] = [];
  /** tick until which we're considered a traitor */
  traitorUntil = -1;
  /** last tick we sent an alliance request per player */
  readonly lastAllianceRequestAt = new Map<PlayerID, number>();
  readonly embargoes = new Set<PlayerID>();
  readonly embargoUntil = new Map<PlayerID, number>();
  /** target marked by the player for quick-attack UI */
  targetPlayer: PlayerID = 0;
  /** who last nuked us (AI grudges) */
  lastNukedBy: Player | null = null;

  // combat
  readonly outgoingAttacks: AttackExecution[] = [];
  readonly incomingAttacks: AttackExecution[] = [];

  /** cached factory-rail gold bonus; refreshed every few ticks */
  linkedFactories = 0;
  linkedFactTick = -100;

  // stats
  stats = { tilesConquered: 0, troopsLost: 0, troopsKilled: 0, playersKilled: 0, goldEarned: 0, nukesLaunched: 0, mirvsLaunched: 0 };

  constructor(smallID: PlayerID, name: string, type: PlayerType, color: string, countryId = 0, flag = "") {
    this.smallID = smallID;
    this.name = name;
    this.type = type;
    this.color = color;
    this.countryId = countryId;
    this.flag = flag;
  }

  get numTiles(): number {
    return this.tiles.size;
  }
  get population(): number {
    return this.troops + this.workers;
  }
  get cityLevels(): number {
    let n = 0;
    for (const u of this.units) if (u.type === UnitType.City && u.active && !u.constructing) n += u.level;
    return n;
  }

  isBot(): boolean {
    return this.type === PlayerType.Bot;
  }
  isHuman(): boolean {
    return this.type === PlayerType.Human;
  }
  isTraitor(tick: number): boolean {
    return this.traitorUntil > tick;
  }

  addTroops(n: number): void {
    this.troops = Math.max(0, this.troops + n);
  }
  /** removes up to n troops, returns amount actually removed */
  removeTroops(n: number): number {
    const r = Math.min(this.troops, Math.max(0, n));
    this.troops -= r;
    return r;
  }
  addGold(n: number): void {
    this.gold += n;
    if (n > 0) this.stats.goldEarned += n;
  }
  removeGold(n: number): boolean {
    if (this.gold < n) return false;
    this.gold -= n;
    return true;
  }

  unitsOf(type: UnitType): Unit[] {
    return this.units.filter((u) => u.type === type && u.active);
  }
  unitCount(type: UnitType): number {
    let n = 0;
    for (const u of this.units) if (u.type === type && u.active) n++;
    return n;
  }
  /** stacked buildings count as their level (City ×2 → 2) */
  unitLevels(type: UnitType): number {
    let n = 0;
    for (const u of this.units) if (u.type === type && u.active) n += u.level;
    return n;
  }
  hasStructures(): boolean {
    return this.units.some((u) => u.active && STRUCTURES.has(u.type));
  }

  // --- relations ---
  relationValue(other: Player): number {
    return this.relations.get(other.smallID) ?? 0;
  }
  relation(other: Player): Relation {
    const v = this.relationValue(other);
    if (v <= -50) return Relation.Hostile;
    if (v < 0) return Relation.Distrustful;
    if (v < 50) return Relation.Neutral;
    return Relation.Friendly;
  }
  updateRelation(other: Player, delta: number): void {
    const v = Math.max(-100, Math.min(100, this.relationValue(other) + delta));
    this.relations.set(other.smallID, v);
  }
  decayRelations(): void {
    for (const [id, v] of this.relations) {
      if (v === 0) continue;
      const nv = v > 0 ? Math.max(0, v - 0.25) : Math.min(0, v + 0.25);
      this.relations.set(id, nv);
    }
  }

  // --- alliances ---
  allianceWith(other: Player): Alliance | null {
    if (other === this) return null;
    for (const a of this.alliances) if (a.a === other || a.b === other) return a;
    return null;
  }
  isAlliedWith(other: Player): boolean {
    return this.allianceWith(other) !== null;
  }
  /** allied → cannot attack */
  isFriendly(other: Player): boolean {
    return other === this || this.isAlliedWith(other);
  }
  allies(): Player[] {
    return this.alliances.map((a) => (a.a === this ? a.b : a.a));
  }

  toString(): string {
    return `${this.name}#${this.smallID}`;
  }
}

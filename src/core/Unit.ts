import type { Player } from "./Player";
import { STRUCTURES, UnitType, type TileRef } from "./types";

let nextUnitId = 1;

export class Unit {
  readonly id: number;
  level = 1;
  active = true;
  /** structures: last time the unit fired / launched (cooldowns) */
  cooldownUntil = 0;
  /** structures: still being built (no effect until `readyAt`) */
  constructing = false;
  readyAt = 0;
  /** movable units */
  path: TileRef[] = [];
  pathIndex = 0;
  /** fractional position along the path segment 0..1 */
  segT = 0;
  /** transport: troops aboard; nuke: unused */
  troops = 0;
  health = 0;
  targetTile: TileRef = -1;
  /** nukes: warhead type; trade ships: destination port; warships: unit being engaged */
  targetUnit: Unit | null = null;
  /** exact lat/lon based position for movement smoothness, in tile coords (x may be fractional) */
  fx = 0;
  fy = 0;
  /** world units above the globe surface (nukes follow a ballistic arc) */
  alt = 0;
  /** peak of that arc, used to draw the full trajectory */
  altPeak = 0;
  /** altitude at launch (warheads start already high after a MIRV split) */
  altStart = 1.2;
  /** 0 at launch, 1 at impact — used to draw the trail from the silo up to the rocket */
  flightT = 0;
  createdAt = 0;
  /** transport ship: where it embarked from (for retreat), trade ship: origin port */
  originTile: TileRef = -1;
  /** movement facing in radians (trains / ships) */
  heading = 0;
  /** train carriages fill after the first city/port pickup */
  loaded = false;
  /** SAM intercepts remaining before reload (OpenFront: level N → N shots) */
  samAmmo = 1;
  /** warship veterancy 0–3 */
  veterancy = 0;
  transportKills = 0;
  tradeCaptures = 0;
  /** warship: water tile to patrol around (overrides home) */
  patrolTile: TileRef = -1;
  /** another SAM is already flying at this nuke */
  targetedBySam = false;
  /** tick when a marked structure is actually removed; -1 = not marked */
  deleteAt = -1;
  /** transport: player ordered a retreat */
  retreatOrdered = false;

  constructor(
    readonly type: UnitType,
    public owner: Player,
    public tile: TileRef,
    id?: number,
  ) {
    this.id = id ?? -(nextUnitId++);
    this.fx = -1;
    this.fy = -1;
  }

  isStructure(): boolean {
    return STRUCTURES.has(this.type);
  }
  isMovable(): boolean {
    return !this.isStructure();
  }
  delete(): void {
    this.active = false;
    const i = this.owner.units.indexOf(this);
    if (i >= 0) this.owner.units.splice(i, 1);
  }

  /** +1 veterancy from sinking a warship; 10 transports per level. */
  recordKill(type: UnitType): void {
    if (this.type !== UnitType.Warship) return;
    if (type === UnitType.Warship) this.gainVeterancy();
    else if (type === UnitType.TransportShip) {
      this.transportKills++;
      if (this.transportKills >= 10) {
        this.transportKills = 0;
        this.gainVeterancy();
      }
    }
  }
  recordTradeCapture(): void {
    if (this.type !== UnitType.Warship) return;
    this.tradeCaptures++;
    if (this.tradeCaptures >= 25) {
      this.tradeCaptures = 0;
      this.gainVeterancy();
    }
  }
  private gainVeterancy(): void {
    if (this.veterancy >= 3) return;
    this.veterancy++;
    this.level = this.veterancy + 1;
    this.health = Math.max(this.health, 1000 + Math.floor((1000 * this.veterancy * 20) / 100));
  }
}

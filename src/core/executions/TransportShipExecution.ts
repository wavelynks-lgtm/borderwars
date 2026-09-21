import type { Execution, Game } from "../Game";
import type { GameMap } from "../GameMap";
import type { Player } from "../Player";
import type { Unit } from "../Unit";
import { moveAlongPath } from "../movement";
import { MessageType, UnitType, type TileRef } from "../types";
import { AttackExecution, fmtTroops } from "./AttackExecution";

const nearBuf: TileRef[] = [0, 0, 0, 0];

function adjacentTo(map: GameMap, a: TileRef, b: TileRef): boolean {
  if (a < 0 || b < 0) return false;
  const n = map.neighbors4(a, nearBuf);
  for (let i = 0; i < n; i++) if (nearBuf[i] === b) return true;
  return false;
}

/** A boat carrying troops across water; on landing it starts a regular attack from the landing tile. */
export class TransportShipExecution implements Execution {
  private active = true;
  private game!: Game;
  private unit: Unit | null = null;
  private returning = false;

  constructor(
    readonly owner: Player,
    readonly src: TileRef,
    readonly dst: TileRef,
    private troops: number,
    private path: TileRef[],
  ) {}

  init(game: Game): void {
    this.game = game;
    if (!this.owner.alive || game.map.owner[this.src] !== this.owner.smallID ||
      this.owner.unitCount(UnitType.TransportShip) >= game.config.boatMaxNumber()) {
      this.active = false;
      return;
    }
    this.troops = Math.floor(Math.min(this.troops, this.owner.troops));
    if (this.troops < 1 || this.path.length < 2) {
      this.active = false;
      return;
    }
    this.owner.removeTroops(this.troops);
    const u = game.addUnit(UnitType.TransportShip, this.owner, this.src);
    u.troops = this.troops;
    u.path = this.path;
    u.pathIndex = 1;
    u.originTile = this.src;
    u.targetTile = this.dst;
    u.health = 1;
    this.unit = u;
    if (this.owner.isHuman()) game.displayMessage(`Boat launched with ${fmtTroops(this.troops)} troops`, MessageType.Info, this.owner.smallID);
  }

  /** turn the boat around (troops return where they embarked) */
  retreat(): void {
    if (!this.unit || this.returning) return;
    this.returning = true;
    const u = this.unit;
    const done = u.path.slice(0, u.pathIndex).reverse();
    u.path = done.length ? done : [this.src];
    u.pathIndex = 0;
  }

  unitRef(): Unit | null {
    return this.unit;
  }

  tick(): void {
    const u = this.unit;
    if (!u || !u.active) {
      this.active = false;
      return;
    }
    if (!this.owner.alive) {
      this.game.removeUnit(u);
      this.active = false;
      return;
    }
    if (u.retreatOrdered && !this.returning) this.retreat();
    const map = this.game.map;
    const arrived = moveAlongPath(u, this.game.config.boatSpeed(), map);
    // Land as soon as the hull is on water next to the beach — don't wait for
    // the path's last land waypoint, which used to park a 1px boat on the coast.
    const atBeach = arrived || (!this.returning && map.isWater(u.tile) && adjacentTo(map, u.tile, this.dst));
    if (!atBeach) return;

    const dst = this.dst;
    const targetOwner = map.isLand(dst) ? this.game.ownerAt(dst) : null;
    const friendly = targetOwner === this.owner || (targetOwner !== null && this.owner.isFriendly(targetOwner));
    if (this.returning || friendly) {
      const keep = Math.floor(u.troops * (1 - this.game.config.retreatMalusPercent() / 100));
      const deaths = u.troops - keep;
      if (deaths > 0 && this.owner.isHuman()) {
        this.game.displayMessage(
          this.returning ? `Boat retreat: lost ${fmtTroops(deaths)} troops` : `Friendly landing: lost ${fmtTroops(deaths)} troops`,
          MessageType.Warn,
          this.owner.smallID,
        );
      }
      this.owner.addTroops(keep);
      this.game.removeUnit(u);
      this.active = false;
      return;
    }
    if (!map.isLand(dst)) {
      this.owner.addTroops(u.troops);
    } else {
      const troops = u.troops;
      this.game.conquer(this.owner, dst);
      this.game.addExecution(new AttackExecution(troops, this.owner, targetOwner, dst, false, true));
      if (this.owner.isHuman()) {
        this.game.displayMessage(
          `Troops landed (${fmtTroops(troops)})`,
          MessageType.Info,
          this.owner.smallID,
        );
      }
    }
    this.game.removeUnit(u);
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }
}

import type { Execution, Game } from "../Game";
import type { Unit } from "../Unit";
import { WaterPathfinder } from "../WaterPathfinder";
import { moveAlongPath } from "../movement";
import { MessageType, UnitType, type TileRef } from "../types";
import { ShellExecution } from "./ShellExecution";

/** Patrols around a home / ordered water tile; shells warships and boats; captures trade ships. */
export class WarshipExecution implements Execution {
  private active = true;
  private game!: Game;
  private pf!: WaterPathfinder;
  private home: TileRef;
  private idleUntil = 0;

  constructor(readonly unit: Unit) {
    this.home = unit.tile;
    unit.patrolTile = unit.tile;
  }

  init(game: Game): void {
    this.game = game;
    this.pf = game.waterPathfinder;
    this.unit.health = game.config.warshipHealthFor(this.unit.veterancy);
  }

  private patrolOrigin(): TileRef {
    return this.unit.patrolTile >= 0 ? this.unit.patrolTile : this.home;
  }

  private pickPatrolTarget(): void {
    const map = this.game.map;
    const origin = this.patrolOrigin();
    const range = this.game.config.warshipPatrolRange();
    for (let i = 0; i < 20; i++) {
      const x = map.x(origin) + this.game.random.nextInt(-range, range);
      const y = map.y(origin) + this.game.random.nextInt(-range, range);
      const t = map.refWrapped(x, y);
      if (t < 0 || !map.isWater(t)) continue;
      const path = this.pf.findPath(this.unit.tile, t, 4000);
      if (path) {
        this.unit.path = path;
        this.unit.pathIndex = 1;
        return;
      }
    }
    this.idleUntil = this.game.ticks + 20;
  }

  private findTarget(): Unit | null {
    const cfg = this.game.config;
    const range = cfg.warshipTargetRange();
    let best: Unit | null = null;
    let bestD = Infinity;
    for (const o of this.game.units) {
      if (!o.active || o === this.unit) continue;
      if (o.type !== UnitType.TransportShip && o.type !== UnitType.TradeShip && o.type !== UnitType.Warship) continue;
      if (o.type === UnitType.TradeShip && o.health === 2) continue;
      if (o.owner === this.unit.owner || this.unit.owner.isFriendly(o.owner)) continue;
      if (o.type === UnitType.TradeShip && o.targetUnit && o.targetUnit.owner === this.unit.owner) continue;
      const d = this.game.map.distSq(o.tile, this.unit.tile);
      if (d < bestD && d <= range * range) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  private captureTrade(t: Unit): void {
    const game = this.game;
    const captor = this.unit.owner;
    game.displayMessage(`Your trade ship was captured by ${captor.name}`, MessageType.Warn, t.owner.smallID);
    if (captor.isHuman()) game.displayMessage(`Warship captured a trade ship of ${t.owner.name}`, MessageType.Info, captor.smallID);
    t.owner.updateRelation(captor, -20);
    game.transferUnit(t, captor);
    const port = game.nearestPort(captor, t.tile);
    if (port) {
      t.targetUnit = port;
      const path = this.pf.findPath(t.tile, port.tile, 30000);
      if (path) {
        t.path = path;
        t.pathIndex = 1;
      }
    }
    this.unit.recordTradeCapture();
  }

  tick(): void {
    const u = this.unit;
    if (!u.active) {
      this.active = false;
      return;
    }
    if (!u.owner.alive) {
      this.game.removeUnit(u);
      this.active = false;
      return;
    }
    const game = this.game;
    const cfg = game.config;
    const map = game.map;
    const maxHp = cfg.warshipHealthFor(u.veterancy);
    if (u.health < maxHp) {
      const nearPort = game.nearestPort(u.owner, u.tile);
      if (nearPort && map.dist(u.tile, nearPort.tile) <= map.tiles(5)) u.health = Math.min(maxHp, u.health + 1);
    }

    if (game.ticks % 5 === 0) {
      const target = this.findTarget();
      if (target !== u.targetUnit) {
        u.targetUnit = target;
        if (target) {
          const path = this.pf.findPath(u.tile, target.tile, 3000);
          if (path) {
            u.path = path;
            u.pathIndex = 1;
          }
        }
      }
    }
    const target = u.targetUnit;
    if (target && (!target.active || map.distSq(target.tile, u.tile) > cfg.warshipTargetRange() ** 2 * 1.5)) {
      u.targetUnit = null;
    }

    if (u.targetUnit) {
      const t = u.targetUnit;
      const d2 = map.distSq(t.tile, u.tile);
      if (t.type === UnitType.TradeShip && d2 <= map.tiles(4) ** 2) {
        this.captureTrade(t);
        u.targetUnit = null;
        return;
      }
      if (d2 <= map.tiles(12) ** 2) {
        if (u.cooldownUntil <= game.ticks && t.type !== UnitType.TradeShip) {
          u.cooldownUntil = game.ticks + cfg.warshipFireCooldown();
          game.addExecution(new ShellExecution(u.tile, u.owner, u, t));
        }
        return;
      }
      if (game.ticks % 10 === 0) {
        const path = this.pf.findPath(u.tile, t.tile, 3000);
        if (path) {
          u.path = path;
          u.pathIndex = 1;
        }
      }
      moveAlongPath(u, cfg.warshipSpeed(), map);
      return;
    }

    if (u.pathIndex >= u.path.length) {
      if (game.ticks >= this.idleUntil) this.pickPatrolTarget();
      return;
    }
    moveAlongPath(u, cfg.warshipSpeed() * 0.6, map);
  }

  isActive(): boolean {
    return this.active;
  }
}

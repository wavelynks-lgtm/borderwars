import type { Execution, Game } from "../Game";
import type { Unit } from "../Unit";
import { moveAlongPath } from "../movement";
import { MessageType, UnitType } from "../types";
import { fmt } from "./AttackExecution";

/** Each dock periodically sends a trade ship to another reachable dock; gold on arrival for both sides. */
export class PortExecution implements Execution {
  private active = true;
  private game!: Game;
  private nextSpawn = 0;
  private skiffs: Unit[] = [];

  constructor(readonly port: Unit) {}

  init(game: Game): void {
    this.game = game;
    this.scheduleNext();
  }

  private scheduleNext(): void {
    const base = this.game.config.tradeShipSpawnRate() / Math.max(1, this.port.level);
    this.nextSpawn = this.game.ticks + Math.floor(base * (0.7 + this.game.random.next() * 0.6));
  }

  tick(): void {
    const port = this.port;
    if (!port.active) {
      this.active = false;
      for (const s of this.skiffs) if (s.active) this.game.removeUnit(s);
      return;
    }
    const game = this.game;
    if (!port.constructing) this.maintainSkiffs();
    if (game.ticks < this.nextSpawn) return;
    this.scheduleNext();
    if (port.constructing) return;
    const owner = port.owner;
    const ports: Unit[] = [];
    for (const u of game.units) {
      if (u.type !== UnitType.Port || !u.active || u.constructing || u === port) continue;
      if (u.owner === owner) {
        if (game.random.bool(0.5)) continue;
      } else {
        if (u.owner.embargoes.has(owner.smallID) || owner.embargoes.has(u.owner.smallID)) continue;
        if (!u.owner.alive) continue;
      }
      ports.push(u);
    }
    if (ports.length === 0) return;
    ports.sort((a, b) => game.map.distSq(b.tile, port.tile) - game.map.distSq(a.tile, port.tile));
    const dest = ports[game.random.nextInt(0, Math.min(ports.length - 1, 3))];
    const path = game.waterPathfinder.findPath(port.tile, dest.tile, 30000);
    if (!path) return;
    const ship = game.addUnit(UnitType.TradeShip, owner, port.tile);
    ship.path = path;
    ship.pathIndex = 1;
    ship.targetUnit = dest;
    ship.originTile = port.tile;
    ship.health = 1;
    game.addExecution(new TradeShipExecution(ship));
  }

  /** two tiny harbor boats that potter around the dock */
  private maintainSkiffs(): void {
    const port = this.port;
    const game = this.game;
    this.skiffs = this.skiffs.filter((s) => s.active);
    const want = Math.min(3, 1 + port.level);
    while (this.skiffs.length < want) {
      const dest = this.nearbyWater();
      if (dest < 0) return;
      const path = game.waterPathfinder.findPath(port.tile, dest, 4000);
      if (!path || path.length < 2) return;
      const boat = game.addUnit(UnitType.TradeShip, port.owner, port.tile);
      boat.path = path;
      boat.pathIndex = 1;
      boat.targetUnit = port;
      boat.originTile = port.tile;
      boat.health = 2;
      game.addExecution(new HarborBoatExecution(boat, port, () => this.nearbyWater()));
      this.skiffs.push(boat);
    }
  }

  private nearbyWater(): number {
    const map = this.game.map;
    const port = this.port;
    const R = Math.max(6, Math.round(this.game.config.tiles(8)));
    for (let i = 0; i < 24; i++) {
      const x = map.x(port.tile) + this.game.random.nextInt(-R, R);
      const y = map.y(port.tile) + this.game.random.nextInt(-R, R);
      const t = map.refWrapped(x, y);
      if (t < 0 || t === port.tile || !map.isWater(t)) continue;
      return t;
    }
    return -1;
  }

  isActive(): boolean {
    return this.active;
  }
}

/** Local skiff that loops water tiles next to its dock. */
class HarborBoatExecution implements Execution {
  private active = true;
  private game!: Game;

  constructor(
    readonly ship: Unit,
    readonly port: Unit,
    private pickWater: () => number,
  ) {}

  init(game: Game): void {
    this.game = game;
  }

  tick(): void {
    const s = this.ship;
    if (!s.active || !this.port.active) {
      if (s.active) this.game.removeUnit(s);
      this.active = false;
      return;
    }
    const arrived = moveAlongPath(s, this.game.config.tradeShipSpeed() * 0.55, this.game.map);
    if (!arrived) return;
    const dest = this.pickWater();
    if (dest < 0) return;
    const path = this.game.waterPathfinder.findPath(s.tile, dest, 4000);
    if (!path || path.length < 2) return;
    s.path = path;
    s.pathIndex = 1;
  }

  isActive(): boolean {
    return this.active;
  }
}

export class TradeShipExecution implements Execution {
  private active = true;
  private game!: Game;
  constructor(readonly ship: Unit) {}
  init(game: Game): void {
    this.game = game;
  }
  tick(): void {
    const s = this.ship;
    if (!s.active) {
      this.active = false;
      return;
    }
    const dest = s.targetUnit;
    if (!dest || !dest.active) {
      this.game.removeUnit(s);
      this.active = false;
      return;
    }
    const arrived = moveAlongPath(s, this.game.config.tradeShipSpeed(), this.game.map);
    if (!arrived) return;
    const dist = this.game.map.dist(s.originTile, dest.tile);
    const gold = this.game.config.tradeShipGold(dist, dest.level);
    const srcOwner = s.owner;
    const dstOwner = dest.owner;
    srcOwner.addGold(gold);
    if (dstOwner !== srcOwner) dstOwner.addGold(gold);
    if (srcOwner.isHuman()) this.game.displayMessage(`Trade ship arrived at ${dstOwner.name}: +${fmt(gold)} gold`, MessageType.Success, srcOwner.smallID);
    else if (dstOwner.isHuman()) this.game.displayMessage(`Trade ship from ${srcOwner.name} arrived: +${fmt(gold)} gold`, MessageType.Success, dstOwner.smallID);
    if (srcOwner !== dstOwner) {
      srcOwner.updateRelation(dstOwner, 3);
      dstOwner.updateRelation(srcOwner, 3);
    }
    this.game.removeUnit(s);
    this.active = false;
  }
  isActive(): boolean {
    return this.active;
  }
}

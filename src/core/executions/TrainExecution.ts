import type { Execution, Game } from "../Game";
import type { Station } from "../RailNetwork";
import { TRADE_STATION_TYPES } from "../RailNetwork";
import type { Unit } from "../Unit";
import { SurfacePath } from "../surfacePath";
import { UnitType } from "../types";

/**
 * One train: an engine plus carriages riding a concatenated rail path.
 * Gold is paid at every City/Port stop (relationship + stop count, then the
 * match gold multiplier). Ride length and station level do not change the
 * payout. Factories are waypoints only.
 */
export class TrainExecution implements Execution {
  private active = true;
  private game!: Game;
  private engine!: Unit;
  private cars: Unit[] = [];
  private track!: SurfacePath;
  private distance = 0;
  private stopDistances: number[] = [];
  private stopsVisited = 0;
  private nextStop = 1; // index into `route` (0 is the origin factory)
  private spacing = 2;

  constructor(
    readonly origin: Station,
    readonly dest: Station,
    readonly route: Station[],
    readonly tiles: number[],
  ) {}

  init(game: Game): void {
    this.game = game;
    const owner = this.origin.owner;
    const start = this.origin.tile;
    const engine = game.addUnit(UnitType.Train, owner, start);
    engine.path = this.tiles;
    engine.pathIndex = 0;
    engine.targetUnit = this.dest.unit;
    engine.originTile = start;
    engine.fx = game.map.x(start) + 0.5;
    engine.fy = game.map.y(start) + 0.5;
    this.engine = engine;
    const n = game.config.trainCars();
    this.spacing = 2;
    this.track = new SurfacePath(game.map, [start, ...this.tiles]);
    let lastStop = 0;
    this.stopDistances = this.route.map(stop => {
      const index = this.track.tiles.indexOf(stop.tile, lastStop);
      if (index < 0) return Infinity;
      lastStop = index;
      return this.track.distances[index];
    });
    const spawnCar = (role: number): Unit => {
      const car = game.addUnit(UnitType.Train, owner, start);
      car.targetUnit = engine;
      car.originTile = start;
      car.fx = engine.fx;
      car.fy = engine.fy;
      car.troops = role; // 0 engine, 1 tail engine, 2 carriage
      return car;
    };
    for (let i = 0; i < n; i++) this.cars.push(spawnCar(2));
    this.cars.push(spawnCar(1));
  }

  isActive(): boolean {
    return this.active;
  }

  tick(): void {
    if (!this.active) return;
    const game = this.game;
    const engine = this.engine;
    if (!engine.active || !this.origin.active || !this.dest.active) {
      this.die();
      return;
    }
    this.distance = Math.min(this.track.length, this.distance + game.config.trainSpeed());
    const arrived = this.distance >= this.track.length;
    for (const [i, unit] of [engine, ...this.cars].entries()) {
      if (!unit.active) continue;
      const p = this.track.sample(this.distance - (i === 0 ? 0 : i * this.spacing + 2));
      const prevX = unit.fx, prevY = unit.fy;
      unit.fx = p.x;
      unit.fy = p.y;
      unit.tile = game.map.ref(Math.floor(p.x), Math.floor(p.y));
      if (i === 0) unit.pathIndex = p.index;
      this.faceFrom(unit, prevX, prevY);
    }
    // pay at every City/Port the engine reaches (route[1..])
    while (this.nextStop < this.route.length) {
      const stop = this.route[this.nextStop];
      if (!stop.active) {
        this.nextStop++;
        continue;
      }
      if (this.distance < this.stopDistances[this.nextStop]) break;
      this.pay(stop);
      this.nextStop++;
    }
    if (arrived) this.die();
  }

  private pay(stop: Station): void {
    if (!TRADE_STATION_TYPES.has(stop.type)) return;
    if (!stop.tradeAvailable(this.engine.owner)) return;
    const owner = this.engine.owner;
    const other = stop.owner;
    const rel = other === owner ? "self" : owner.isAlliedWith(other) ? "ally" : "other";
    const gold = this.game.config.trainGold(rel, this.stopsVisited);
    this.stopsVisited++;
    owner.addGold(gold);
    if (other !== owner && other.alive) other.addGold(gold);
    const me = this.game.human;
    if (me && (owner === me || other === me)) this.game.onGoldFloat?.(stop.tile, gold, me);
    if (!this.engine.loaded) {
      this.engine.loaded = true;
      for (const car of this.cars) {
        if (car.troops === 2) car.loaded = true;
      }
    }
  }

  private face(u: Unit): void {
    const path = u.path;
    const i = Math.min(u.pathIndex, path.length - 1);
    if (i < 0 || path.length === 0) return;
    const map = this.game.map;
    const tx = map.x(path[i]) + 0.5;
    const ty = map.y(path[i]) + 0.5;
    this.faceFrom(u, tx, ty, true);
  }

  private faceFrom(u: Unit, x: number, y: number, toward = false): void {
    const W = this.game.map.width;
    let dx = toward ? x - u.fx : u.fx - x;
    let dy = toward ? y - u.fy : u.fy - y;
    if (dx > W / 2) dx -= W;
    else if (dx < -W / 2) dx += W;
    if (dx * dx + dy * dy < 1e-6) return;
    u.heading = Math.atan2(dx, -dy);
  }

  private die(): void {
    this.active = false;
    this.game.removeUnit(this.engine);
    for (const c of this.cars) this.game.removeUnit(c);
  }
}

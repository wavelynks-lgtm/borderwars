import type { Execution, Game } from "../Game";
import type { Unit } from "../Unit";
import { UnitType } from "../types";
import { TrainExecution } from "./TrainExecution";

/** A finished Factory periodically dispatches trains onto the rail network. */
export class FactoryExecution implements Execution {
  private active = true;
  private game!: Game;
  /** relink rails even during spawn (dev instant-build) */
  activeDuringSpawnPhase = true;

  constructor(readonly factory: Unit) {}

  init(game: Game): void {
    this.game = game;
  }

  isActive(): boolean {
    return this.active;
  }

  tick(): void {
    const u = this.factory;
    if (!u.active) {
      this.active = false;
      return;
    }
    if (u.constructing) return;
    const game = this.game;
    let station = game.rail.stationOf(u);
    if (!station) {
      game.rail.onStructureCompleted(u);
      station = game.rail.stationOf(u);
    }
    if (!station || station.rails.size === 0) return;
    if (game.inSpawnPhase()) return;
    if (game.ticks < u.cooldownUntil) return;
    const dests = game.rail.tradeDestinations(station, u.owner);
    if (dests.length === 0) return;
    const factories = u.owner.unitCount(UnitType.Factory);
    const rate = game.config.trainSpawnRate(factories, game.trainCount());
    let spawned = false;
    for (let i = 0; i < u.level; i++) {
      if (!game.random.chance(rate)) continue;
      const dest = dests[game.random.nextInt(0, dests.length - 1)];
      const hops = game.rail.stationPath(station, dest);
      if (!hops || hops.length < 2) continue;
      const tiles: number[] = [station.tile];
      for (let h = 0; h < hops.length - 1; h++) {
        const rail = hops[h].railTo(hops[h + 1]);
        if (!rail) {
          tiles.length = 0;
          break;
        }
        tiles.push(...rail.tilesFrom(hops[h]));
      }
      if (tiles.length < 2) continue;
      game.addExecution(new TrainExecution(station, dest, hops, tiles));
      spawned = true;
    }
    if (spawned) u.cooldownUntil = game.ticks + 10;
  }
}

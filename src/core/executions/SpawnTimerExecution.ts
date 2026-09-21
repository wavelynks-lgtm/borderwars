import type { Execution, Game } from "../Game";
import { PlayerType } from "../types";

/** Spawns bots at random moments during the spawn phase so the world fills up visibly. */
export class SpawnTimerExecution implements Execution {
  readonly activeDuringSpawnPhase = true;
  private game!: Game;
  private active = true;
  private queue: number[] = [];

  init(game: Game): void {
    this.game = game;
    const bots = game.allPlayers().filter((p) => p.type === PlayerType.Bot);
    game.random.shuffle(bots);
    const total = game.config.spawnPhaseTicks();
    this.queue = bots.map((p) => p.smallID);
    this.perTick = Math.max(1, Math.ceil(this.queue.length / Math.max(1, total - 10)));
  }
  private perTick = 1;

  tick(): void {
    if (!this.game.inSpawnPhase() || this.queue.length === 0) {
      this.active = false;
      return;
    }
    if (this.game.ticks < 3) return;
    for (let i = 0; i < this.perTick && this.queue.length; i++) {
      const p = this.game.player(this.queue.shift()!);
      if (!p || p.hasSpawned) continue;
      const t = this.game.randomSpawnTile(p);
      if (t >= 0) this.game.spawnPlayer(p, t);
    }
  }
  isActive(): boolean {
    return this.active;
  }
}

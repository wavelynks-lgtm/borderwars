import type { Execution, Game } from "../Game";
import { PlayerType } from "../types";

/** AI claim random land throughout the spawn countdown so the globe fills in visibly. */
export class SpawnTimerExecution implements Execution {
  readonly activeDuringSpawnPhase = true;
  private game!: Game;
  private active = true;
  private queue: number[] = [];
  private perTick = 1;

  init(game: Game): void {
    this.game = game;
    const ai = game.allPlayers().filter((p) => p.type !== PlayerType.Human && !p.hasSpawned);
    game.random.shuffle(ai);
    const total = game.config.spawnPhaseTicks();
    this.queue = ai.map((p) => p.smallID);
    this.perTick = Math.max(1, Math.ceil(this.queue.length / Math.max(1, total - 4)));
  }

  tick(): void {
    if (!this.game.inSpawnPhase() || this.queue.length === 0) {
      this.active = false;
      return;
    }
    if (this.game.ticks < 1) return;
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

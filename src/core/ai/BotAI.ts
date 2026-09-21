import type { Execution, Game } from "../Game";
import type { Player } from "../Player";
import { PseudoRandom } from "../PseudoRandom";
import { AttackExecution } from "../executions/AttackExecution";
import { PlayerType } from "../types";

/** Grey filler tribes: expand into neutral land, retaliate when attacked, occasionally squabble. */
export class BotAI implements Execution {
  readonly activeDuringSpawnPhase = false;
  private game!: Game;
  private random!: PseudoRandom;
  private attackRate = 60;
  private attackTick = 0;
  private active = true;

  constructor(readonly player: Player) {}

  init(game: Game): void {
    this.game = game;
    this.random = new PseudoRandom(game.config.settings.seed * 31 + this.player.smallID * 7);
    this.attackRate = Math.round(this.random.nextInt(40, 80) * game.config.aiCadence());
    this.attackTick = this.random.nextInt(0, this.attackRate - 1);
  }

  tick(): void {
    const p = this.player;
    const game = this.game;
    if (game.devFreezeAi) return;
    if (!p.hasSpawned) return;
    if (!p.alive) {
      this.active = false;
      return;
    }
    if (game.ticks % this.attackRate !== this.attackTick) return;

    for (const req of [...p.incomingAllianceRequests]) {
      if (req.status !== "pending") continue;
      if (req.requestor.type === PlayerType.Human) game.acceptAlliance(req);
      else game.rejectAlliance(req);
    }

    const { players: neighbors, neutral } = game.neighbors(p);
    if (p.outgoingAttacks.some((a) => a.isActive() && a.target === null)) return;
    if (neutral) {
      game.addExecution(new AttackExecution(null, p, null, game.borderContact(p, 0)));
      return;
    }
    const enemies = neighbors.filter((n) => !p.isFriendly(n));
    if (enemies.length === 0) return;

    // only fight back if someone is already attacking us — don't eat a neighbor
    // who is just claiming empty land beside us
    let attacker: Player | null = null;
    let biggest = 0;
    for (const a of p.incomingAttacks) {
      if (!a.isActive() || a.target !== p) continue;
      if (a.troops() > biggest && enemies.includes(a.owner)) {
        biggest = a.troops();
        attacker = a.owner;
      }
    }
    if (attacker) {
      game.addExecution(new AttackExecution(p.troops / 5, p, attacker, game.borderContact(p, attacker.smallID)));
    }
  }

  isActive(): boolean {
    return this.active;
  }
}

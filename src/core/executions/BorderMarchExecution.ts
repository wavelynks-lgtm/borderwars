import type { BorderWalker, Execution, Game } from "../Game";
import { moveAlongPath } from "../movement";
import type { Player } from "../Player";
import { MessageType, type TileRef } from "../types";
import { AttackExecution, fmtTroops } from "./AttackExecution";

/** One-pixel army walking other countries' borders to a far attack. */
export class BorderMarchExecution implements Execution {
  private active = true;
  private game!: Game;
  private walker: BorderWalker | null = null;

  constructor(
    readonly owner: Player,
    readonly dst: TileRef,
    private troops: number,
    private path: TileRef[],
  ) {}

  init(game: Game): void {
    this.game = game;
    this.troops = Math.floor(Math.min(this.troops, this.owner.troops));
    if (this.troops < 1 || this.path.length < 2) {
      this.active = false;
      return;
    }
    this.owner.removeTroops(this.troops);
    const start = this.path[0];
    const w: BorderWalker = {
      owner: this.owner,
      fx: game.map.x(start) + 0.5,
      fy: game.map.y(start) + 0.5,
      heading: 0,
      path: this.path,
      pathIndex: 1,
      tile: start,
    };
    this.walker = w;
    game.borderWalkers.push(w);
    if (this.owner.isHuman()) {
      game.displayMessage(`Troops marching (${fmtTroops(this.troops)})`, MessageType.Info, this.owner.smallID);
    }
  }

  tick(): void {
    const w = this.walker;
    if (!w) {
      this.active = false;
      return;
    }
    if (!this.owner.alive) {
      this.owner.addTroops(this.troops);
      this.drop();
      return;
    }
    const arrived = moveAlongPath(w, this.game.config.boatSpeed(), this.game.map);
    if (!arrived) return;

    const dst = this.dst;
    const target = this.game.ownerAt(dst);
    if (target === this.owner || (target !== null && this.owner.isFriendly(target))) {
      this.owner.addTroops(this.troops);
      this.drop();
      return;
    }
    if (!this.game.map.isLand(dst)) {
      this.owner.addTroops(this.troops);
      this.drop();
      return;
    }
    this.game.conquer(this.owner, dst);
    this.game.addExecution(new AttackExecution(this.troops, this.owner, target, dst, false));
    this.drop();
  }

  private drop(): void {
    const w = this.walker;
    if (w) {
      const i = this.game.borderWalkers.indexOf(w);
      if (i >= 0) this.game.borderWalkers.splice(i, 1);
      this.walker = null;
    }
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }
}

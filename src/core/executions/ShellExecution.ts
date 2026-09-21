import type { Execution, Game } from "../Game";
import type { Player } from "../Player";
import type { Unit } from "../Unit";
import { stepToward } from "../movement";
import { MessageType, UnitType, type TileRef } from "../types";

/** Warship projectile: 3 tiles/tick, d6 damage, 50-tick hang time if the gun dies. */
export class ShellExecution implements Execution {
  private active = true;
  private game!: Game;
  private shell: Unit | null = null;
  private destroyAt = -1;

  constructor(
    private spawn: TileRef,
    private owner: Player,
    private firer: Unit,
    private target: Unit,
  ) {}

  init(game: Game): void {
    this.game = game;
    const u = game.addUnit(UnitType.Shell, this.owner, this.spawn);
    u.targetUnit = this.target;
    u.alt = 1.4;
    this.shell = u;
  }

  tick(): void {
    const s = this.shell;
    if (!s || !s.active) {
      this.active = false;
      return;
    }
    if (this.destroyAt < 0 && !this.firer.active) this.destroyAt = this.game.ticks + this.game.config.shellLifetime();
    if (this.destroyAt >= 0 && this.game.ticks >= this.destroyAt) {
      this.game.removeUnit(s);
      this.active = false;
      return;
    }
    const t = this.target;
    if (!t.active || this.owner.isFriendly(t.owner)) {
      this.game.removeUnit(s);
      this.active = false;
      return;
    }
    const arrived = stepToward(s, t.tile, this.game.config.shellSpeed(), this.game.map);
    s.fx = t.fx >= 0 && arrived ? t.fx : s.fx;
    s.fy = t.fy >= 0 && arrived ? t.fy : s.fy;
    if (!arrived) return;

    const dmg = this.game.config.shellDamage(this.firer.veterancy, this.game.random.nextInt(1, 6));
    t.health -= dmg;
    if (t.health <= 0) {
      const was = t.type;
      if (was === UnitType.Warship) {
        this.game.displayMessage(`Your warship was sunk by ${this.owner.name}`, MessageType.Warn, t.owner.smallID);
      } else {
        const what = was === UnitType.TradeShip ? "trade ship" : `transport (${Math.floor(t.troops)} troops)`;
        this.game.displayMessage(`Your ${what} was sunk by ${this.owner.name}`, MessageType.Warn, t.owner.smallID);
        t.owner.updateRelation(this.owner, -30);
      }
      this.game.removeUnit(t);
      if (this.firer.active && this.firer.type === UnitType.Warship) this.firer.recordKill(was);
    }
    this.game.removeUnit(s);
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }
}

import type { Execution, Game } from "../Game";
import type { Player } from "../Player";
import type { Unit } from "../Unit";
import { stepToward } from "../movement";
import { MessageType, UnitType, type TileRef } from "../types";

const INTERCEPTABLE = new Set([UnitType.AtomBomb, UnitType.HydrogenBomb, UnitType.MIRVWarhead]);

/** Homing SAM shot. Hits Atom / Hydrogen / MIRV warheads; the MIRV bus is immune. */
export class SAMMissileExecution implements Execution {
  private active = true;
  private game!: Game;
  private missile: Unit | null = null;

  constructor(
    private spawn: TileRef,
    private owner: Player,
    private sam: Unit,
    private target: Unit,
  ) {}

  init(game: Game): void {
    this.game = game;
    const u = game.addUnit(UnitType.SAMMissile, this.owner, this.spawn);
    u.targetUnit = this.target;
    u.alt = Math.max(4, this.target.alt || 6);
    this.missile = u;
    this.target.targetedBySam = true;
  }

  tick(): void {
    const m = this.missile;
    if (!m || !m.active) {
      this.clearTarget();
      this.active = false;
      return;
    }
    const t = this.target;
    if (!t.active || !this.sam.active || this.owner.isFriendly(t.owner) || !INTERCEPTABLE.has(t.type)) {
      this.clearTarget();
      this.game.removeUnit(m);
      this.active = false;
      return;
    }
    m.alt = Math.max(2, t.alt || m.alt);
    const arrived = stepToward(m, t.tile, this.game.config.samMissileSpeed(), this.game.map);
    if (!arrived) return;

    this.game.displayMessage(`${this.owner.name}'s SAM intercepted your missile`, MessageType.Warn, t.owner.smallID);
    this.game.displayMessage(`Your SAM intercepted a missile from ${t.owner.name}`, MessageType.Success, this.owner.smallID);
    this.game.onSamIntercept?.(this.sam.tile, t.tile);
    this.game.removeUnit(t);
    this.game.removeUnit(m);
    this.active = false;
  }

  private clearTarget(): void {
    if (this.target.active) this.target.targetedBySam = false;
  }

  isActive(): boolean {
    return this.active;
  }
}

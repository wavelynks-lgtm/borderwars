import * as THREE from "three";
import type { Execution, Game } from "../Game";
import type { Player } from "../Player";
import type { Unit } from "../Unit";
import { ballisticPoint, worldToTileXY } from "../../map/ballistic";
import { MessageType, UnitType, type TileRef } from "../types";
import { fmtTroops } from "./AttackExecution";
import { SAMMissileExecution } from "./SAMMissileExecution";

const _pos = new THREE.Vector3();

/** Atom / Hydrogen / MIRV flying from a silo to its target, with SAM interception. */
export class NukeExecution implements Execution {
  private active = true;
  private game!: Game;
  private unit: Unit | null = null;
  private samChecked = new Set<Unit>();
  private flightTicks = 100;
  private elapsed = 0;
  private arcPeak = 12;
  private lat0 = 0;
  private lon0 = 0;
  private lat1 = 0;
  private lon1 = 0;
  private startAlt = 1.2;

  constructor(
    readonly owner: Player,
    readonly type: UnitType,
    readonly silo: Unit,
    readonly target: TileRef,
    /** warheads spawn in the air at the MIRV split point instead of the silo */
    readonly fromTile?: TileRef,
  ) {}

  private get silent(): boolean {
    return this.type === UnitType.MIRVWarhead;
  }

  init(game: Game): void {
    this.game = game;
    const start = this.fromTile ?? this.silo.tile;
    const map = game.map;
    const dist = Math.max(1, map.surfaceDistance(start, this.target));
    this.flightTicks = game.config.nukeFlightTicks(this.type, dist);
    this.arcPeak = game.config.nukeArcHeight(this.type, dist);
    const a = map.tileToLatLon(start);
    const b = map.tileToLatLon(this.target);
    this.lat0 = a.lat;
    this.lon0 = a.lon;
    this.lat1 = b.lat;
    this.lon1 = b.lon;
    this.startAlt = this.fromTile ? Math.max(8, this.arcPeak * 0.7) : 1.2;
    const u = game.addUnit(this.type, this.owner, start);
    u.targetTile = this.target;
    u.originTile = start;
    u.altPeak = this.arcPeak;
    u.altStart = this.startAlt;
    this.place(u, 0);
    this.unit = u;
    if (this.silent) return;
    this.silo.cooldownUntil = game.ticks + game.config.siloCooldown();
    this.owner.stats.nukesLaunched++;
    if (this.type === UnitType.MIRV) this.owner.stats.mirvsLaunched++;
    const victim = game.ownerAt(this.target);
    const label = this.type === UnitType.HydrogenBomb ? "Hydrogen Bomb" : this.type === UnitType.MIRV ? "MIRV" : "Atom Bomb";
    game.events.push({
      tick: game.ticks,
      type: MessageType.Nuke,
      text: `${this.owner.name} launched a ${label}${victim ? ` at ${victim.name}` : ""}`,
      from: this.owner.smallID,
    });
  }

  private place(u: Unit, t: number): void {
    const map = this.game.map;
    ballisticPoint(this.lat0, this.lon0, this.lat1, this.lon1, t, this.arcPeak, _pos, this.startAlt, 1.2);
    const { fx, fy, alt } = worldToTileXY(_pos, map.width, map.height);
    u.fx = fx;
    u.fy = fy;
    u.alt = alt;
    u.flightT = t;
    const x = ((Math.floor(fx) % map.width) + map.width) % map.width;
    u.tile = map.ref(x, Math.min(map.height - 1, Math.max(0, Math.floor(fy))));
  }

  tick(): void {
    const u = this.unit;
    if (!u || !u.active) {
      this.active = false;
      return;
    }
    this.elapsed++;
    const t = Math.min(1, this.elapsed / this.flightTicks);
    this.place(u, t);

    if (this.trySamIntercept(u, t)) return;

    if (this.elapsed >= this.flightTicks) {
      if (this.type === UnitType.MIRV) this.split(u);
      else this.detonate(u);
      this.game.removeUnit(u);
      this.active = false;
    }
  }

  /**
   * OpenFront: a SAM of level N intercepts N missiles, then reloads.
   * MIRV buses are immune; warheads / atom / hydrogen spawn a homing SAM missile.
   */
  private trySamIntercept(u: Unit, flightT: number): boolean {
    if (this.type === UnitType.MIRV || u.targetedBySam) return false;
    const game = this.game;
    const map = game.map;
    const ticks = game.ticks;
    const cooldown = game.config.samCooldown();
    const fx = u.fx >= 0 ? u.fx : map.x(u.tile) + 0.5;
    const fy = u.fy >= 0 ? u.fy : map.y(u.tile) + 0.5;
    for (const sam of game.units) {
      if (sam.type !== UnitType.SAMLauncher || !sam.active || sam.constructing || this.samChecked.has(sam)) continue;
      if (sam.owner === this.owner || sam.owner.isFriendly(this.owner)) continue;
      if (sam.samAmmo <= 0) {
        if (sam.cooldownUntil > ticks) continue;
        sam.samAmmo = Math.max(1, sam.level);
      }
      const range = game.effectiveSamRange(sam);
      const r2 = range * range;
      const nearNow = this.samDistSq(sam, fx, fy) <= r2;
      const coversImpact = map.surfaceDistance(sam.tile, this.target) <= range;
      if (!nearNow && !(coversImpact && flightT >= 0.25)) continue;
      this.samChecked.add(sam);
      sam.samAmmo--;
      if (sam.samAmmo <= 0) sam.cooldownUntil = ticks + cooldown;
      if (game.random.next() >= game.config.samHitChance(this.type)) continue;
      u.targetedBySam = true;
      game.addExecution(new SAMMissileExecution(sam.tile, sam.owner, sam, u));
      return false;
    }
    return false;
  }

  private samDistSq(sam: Unit, fx: number, fy: number): number {
    const map = this.game.map;
    const distance = map.surfaceDistanceXY(sam.tile, fx, fy);
    return distance * distance;
  }

  /** MIRV bus opens over the target and rains independent warheads. */
  private split(u: Unit): void {
    const game = this.game;
    const map = game.map;
    const n = game.config.mirvWarheads();
    const spread = game.config.nukeMagnitude(UnitType.MIRV).inner;
    const minSep = Math.max(1, spread / Math.sqrt(n));
    const cx = map.x(this.target);
    const cy = map.y(this.target);
    const picks: TileRef[] = [];
    if (map.isLand(this.target)) picks.push(this.target);
    for (let i = 0; i < n * 48 && picks.length < n; i++) {
      const ang = game.random.next() * Math.PI * 2;
      const r = Math.sqrt(game.random.next()) * spread;
      const t = map.refWrapped(Math.round(cx + Math.cos(ang) * r), Math.round(cy + Math.sin(ang) * r));
      if (t < 0 || !map.isLand(t)) continue;
      if (picks.some((p) => map.distSq(p, t) < minSep * minSep)) continue;
      picks.push(t);
    }
    for (const t of picks) {
      game.addExecution(new NukeExecution(this.owner, UnitType.MIRVWarhead, this.silo, t, u.tile));
    }
    if (this.owner.isHuman()) {
      game.displayMessage(`MIRV split into ${picks.length} warheads`, MessageType.Nuke, this.owner.smallID);
    }
  }

  private detonate(u: Unit): void {
    const game = this.game;
    const map = game.map;
    const { inner, outer } = game.config.nukeMagnitude(this.type);
    const cx = map.x(this.target);
    const cy = map.y(this.target);
    const tilesHit = new Map<Player, number>();
    let destroyed = 0;
    const r = outer;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > r * r) continue;
        const t = map.refWrapped(cx + dx, cy + dy);
        if (t < 0 || !map.isLand(t)) continue;
        const d = Math.sqrt(d2);
        let destroy = d <= inner;
        if (!destroy) {
          const k = (outer - d) / (outer - inner);
          destroy = game.random.next() < k * k;
        }
        if (!destroy) continue;
        const owner = game.ownerAt(t);
        if (owner) tilesHit.set(owner, (tilesHit.get(owner) ?? 0) + 1);
        if (game.config.settings.waterNukes) game.sinkTile(t);
        else {
          if (owner) game.relinquish(t);
          game.addFallout(t);
        }
        destroyed++;
      }
    }
    for (const other of [...game.units]) {
      if (other === u || !other.active) continue;
      if (map.distSq(other.tile, this.target) <= outer * outer) {
        game.removeUnit(other);
      }
    }
    for (const [p, n] of tilesHit) {
      const deaths = Math.min(p.troops, Math.floor(game.config.nukeDeathFactor(p.troops, p.numTiles + n) * n));
      p.removeTroops(deaths);
      p.stats.troopsLost += deaths;
      this.owner.stats.troopsKilled += deaths;
      if (p !== this.owner) {
        p.lastNukedBy = this.owner;
        p.updateRelation(this.owner, -100);
        if (p.isAlliedWith(this.owner) && n > 20) game.breakAlliance(this.owner, p);
        game.displayMessage(
          `${this.owner.name}'s nuke hit you: ${n} tiles lost, ${fmtTroops(deaths)} casualties`,
          MessageType.Error,
          p.smallID,
        );
      }
      for (const q of game.allPlayers()) if (q !== p && q !== this.owner) q.updateRelation(this.owner, -8);
    }
    if (this.owner.isHuman() && !this.silent) {
      game.displayMessage(`Nuke detonated: ${destroyed} tiles opened for claiming`, MessageType.Nuke, this.owner.smallID);
    }
    game.onNukeDetonated?.(this.target, this.type);
  }

  isActive(): boolean {
    return this.active;
  }
}

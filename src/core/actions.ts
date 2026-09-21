import { MissileSalvoExecution } from "./executions/MissileSalvoExecution";
import type { Game } from "./Game";
import { unitLabel } from "./Game";
import type { Player } from "./Player";
import type { Unit } from "./Unit";
import { AttackExecution, fmt } from "./executions/AttackExecution";
import { BorderMarchExecution } from "./executions/BorderMarchExecution";
import { FactoryExecution } from "./executions/FactoryExecution";
import { NukeExecution } from "./executions/NukeExecution";
import { PortExecution } from "./executions/PortExecution";
import { TransportShipExecution } from "./executions/TransportShipExecution";
import { WarshipExecution } from "./executions/WarshipExecution";
import { MessageType, NUKES, STRUCTURES, UnitType, type TileRef } from "./types";

export type ActionResult = { ok: true; message?: string } | { ok: false; message: string };

/**
 * Click-to-attack: figures out whether this is a land attack on the tile's owner,
 * or a boat landing when the target isn't adjacent.
 */
export function attackTile(game: Game, player: Player, tile: TileRef, troops?: number): ActionResult {
  const map = game.map;
  if (!player.alive) return { ok: false, message: "You have no territory" };
  if (!map.isLand(tile)) return { ok: false, message: "Cannot attack water" };
  const targetId = map.owner[tile];
  if (targetId === player.smallID) return { ok: false, message: "That is your own land" };
  const target = targetId === 0 ? null : game.player(targetId);
  if (target && player.isFriendly(target)) return { ok: false, message: `You are allied with ${target.name}. Break the alliance first.` };
  if (target && game.ticks - target.spawnedAt < game.config.spawnImmunityTicks() && !game.inSpawnPhase()) {
    return { ok: false, message: `${target.name} has spawn protection` };
  }
  const amount = troops ?? game.config.attackAmount(player.type, player.troops, player.attackRatio);
  if (amount < 1) return { ok: false, message: "Not enough troops" };

  // Enemy attacks share all borders; neutral attacks share the clicked region's borders.
  const contact = game.borderContact(player, targetId, target ? 0 : map.country[tile]);
  if (contact >= 0) {
    game.addExecution(new AttackExecution(amount, player, target, target ? null : tile, true));
    return { ok: true };
  }
  if (targetId === 0) {
    const marched = sendBorderMarch(game, player, tile, amount);
    if (marched.ok) return marched;
    return sendBoat(game, player, tile, amount);
  }
  const marched = sendBorderMarch(game, player, tile, amount);
  if (marched.ok) return marched;
  // not adjacent: try a boat
  return sendBoat(game, player, tile, amount);
}

/** March a 1-pixel army along country / player borders to a far tile. */
export function sendBorderMarch(game: Game, player: Player, dst: TileRef, troops: number): ActionResult {
  const map = game.map;
  if (!map.isLand(dst) || map.isImpassable(dst)) return { ok: false, message: "Cannot march onto that tile" };
  const gate = game.borderPathfinder.nearestGate(dst, player.smallID);
  let src = -1;
  let bestD = Infinity;
  for (const t of player.borderTiles) {
    const d = map.distSq(t, gate);
    if (d < bestD) {
      bestD = d;
      src = t;
    }
  }
  if (src < 0) {
    for (const t of player.tiles) {
      src = t;
      break;
    }
  }
  if (src < 0) return { ok: false, message: "No land to march from" };
  const path = game.borderPathfinder.findPath(src, gate, player.smallID);
  if (!path || path.length < 2) return { ok: false, message: "No border route to that land" };
  game.addExecution(new BorderMarchExecution(player, gate, Math.floor(troops), path));
  return { ok: true };
}

export function sendBoat(game: Game, player: Player, dst: TileRef, troops: number): ActionResult {
  const map = game.map;
  if (!player.alive) return { ok: false, message: "You have no territory" };
  const target = game.ownerAt(dst);
  if (target && player.isFriendly(target)) return { ok: false, message: "Cannot invade friendly territory" };
  if (!map.isLand(dst)) return { ok: false, message: "Boats must land on a coast" };
  if (!map.isShore(dst)) {
    // snap to nearest shore tile of the same owner within a few tiles
    const owner = map.owner[dst];
    let best = -1;
    let bestD = Infinity;
    const cx = map.x(dst);
    const cy = map.y(dst);
    const R = map.tiles(10);
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const t = map.refWrapped(cx + dx, cy + dy);
        if (t < 0 || map.owner[t] !== owner || !map.isShore(t)) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = t;
        }
      }
    }
    if (best < 0) return { ok: false, message: "No coast near the target for a landing" };
    dst = best;
  }
  if (player.unitCount(UnitType.TransportShip) >= game.config.boatMaxNumber()) {
    return { ok: false, message: `Maximum ${game.config.boatMaxNumber()} boats at sea` };
  }
  const shore = game.shoreTiles(player);
  if (shore.length === 0) return { ok: false, message: "You have no coastline to launch a boat from" };
  // pick the closest few shore tiles and take the first with a path
  const amount = Math.floor(troops);
  if (amount < 1) return { ok: false, message: "Not enough troops" };
  shore.sort((a, b) => map.distSq(a, dst) - map.distSq(b, dst));
  let remainingSearch = 40000;
  for (let i = 0; i < Math.min(12, shore.length) && remainingSearch > 0; i++) {
    const src = shore[i];
    const path = game.waterPathfinder.findPath(src, dst, remainingSearch);
    remainingSearch -= Math.max(1, game.waterPathfinder.lastSearchWork);
    if (path) {
      game.addExecution(new TransportShipExecution(player, src, dst, amount, path));
      return { ok: true };
    }
  }
  return { ok: false, message: "No sea route to that coast" };
}

export function retreatAttack(game: Game, player: Player, attackId: number): void {
  for (const a of player.outgoingAttacks) {
    if (a.id === attackId) a.orderRetreat();
  }
}

export function retreatBoat(player: Player, unitId: number): void {
  for (const u of player.units) {
    if (u.id === unitId && u.type === UnitType.TransportShip && u.active) u.retreatOrdered = true;
  }
}

export function moveWarship(game: Game, player: Player, unit: Unit, tile: TileRef): ActionResult {
  if (!unit.active || unit.owner !== player || unit.type !== UnitType.Warship) {
    return { ok: false, message: "Not your warship" };
  }
  if (!game.map.isWater(tile)) return { ok: false, message: "Patrol must be on water" };
  unit.patrolTile = tile;
  unit.path = [];
  unit.pathIndex = 0;
  return { ok: true, message: "Warship patrol set" };
}

/**
 * build a structure / deploy a warship / launch a nuke at `tile`.
 * `prepaid` = the gold was already taken when the item was bought in the build bar.
 */
export function build(game: Game, player: Player, type: UnitType, tile: TileRef, prepaid = false, paidAmount?: number): ActionResult {
  const err = game.canBuild(player, type, tile, prepaid);
  if (err) return { ok: false, message: err };
  const existing = STRUCTURES.has(type) ? game.stackTarget(player, type, tile) : undefined;
  if (existing) {
    const price = game.isDev() ? 0 : game.config.upgradeCost(type, existing.level);
    const delta = prepaid ? (paidAmount === undefined ? 0 : price - paidAmount) : price;
    if (delta > 0 && !player.removeGold(delta)) return { ok: false, message: `Not enough gold (${fmt(delta)} more)` };
    if (delta < 0) player.gold -= delta;
    return upgradeUnit(game, player, existing, true);
  }
  const cost = prepaid ? 0 : game.config.unitCost(type, game.ownedForCost(player, type));

  if (NUKES.has(type)) {
    const silos = player.unitsOf(UnitType.MissileSilo).filter((s) => !s.constructing);
    const inRange = silos.filter((s) => game.siloCanReach(s, tile));
    let silo = inRange
      .filter((s) => s.cooldownUntil <= game.ticks)
      .sort((a, b) => game.map.distSq(a.tile, tile) - game.map.distSq(b.tile, tile))[0];
    if (!silo && game.isDev()) {
      const origin = player.spawnTile >= 0 ? player.spawnTile : tile;
      silo = game.addUnit(UnitType.MissileSilo, player, origin);
    }
    if (!silo) {
      if (!silos.length) return { ok: false, message: "Requires a Missile Silo" };
      if (!inRange.length) return { ok: false, message: "Target out of silo range" };
      return { ok: false, message: "All silos are reloading" };
    }
    if (!prepaid && !game.isDev()) player.removeGold(cost);
    // Reserve now: multiple clicks before the next tick cannot reuse one silo.
    silo.cooldownUntil = game.ticks + Math.max(1, game.config.siloCooldown());
    game.addExecution(new NukeExecution(player, type, silo, tile));
    return { ok: true, message: type === UnitType.MIRV ? "MIRV launched" : "Missile launched" };
  }

  if (!prepaid && !game.isDev()) player.removeGold(cost);
  if (type === UnitType.Warship) {
    const u = game.addUnit(UnitType.Warship, player, tile);
    game.addExecution(new WarshipExecution(u));
    return { ok: true };
  }
  if (STRUCTURES.has(type)) {
    const u = game.addUnit(type, player, tile);
    if (type === UnitType.Port) game.addExecution(new PortExecution(u));
    if (type === UnitType.Factory) game.addExecution(new FactoryExecution(u));
    return { ok: true };
  }
  return { ok: false, message: "Unknown unit" };
}

/** Reserve the full salvo price now, including the first build-bar purchase. */
export function queueMissiles(game: Game, player: Player, type: UnitType, targets: TileRef[], credit = 0): { ok: true; salvo: MissileSalvoExecution } | { ok: false; message: string } {
  if (!NUKES.has(type) || type === UnitType.MIRVWarhead || !targets.length || targets.length > 20) return {ok:false,message:"Mark between 1 and 20 missile targets"};
  const orders=[];
  for (const [i,tile] of targets.entries()) {
    const error=game.canBuild(player,type,tile,true);
    if(error)return {ok:false,message:error};
    orders.push({tile,price:game.isDev()?0:game.config.unitCost(type,game.ownedForCost(player,type)+i)});
  }
  const total=orders.reduce((n,o)=>n+o.price,0), extra=total-credit;
  if(extra>0&&!player.removeGold(extra))return {ok:false,message:`Not enough gold (${fmt(extra)} more)`};
  if(extra<0)player.gold-=extra;
  const salvo=new MissileSalvoExecution(player,type,orders);game.addExecution(salvo);
  return {ok:true,salvo};
}

export function upgradeUnit(game: Game, player: Player, unit: Unit, prepaid = false): ActionResult {
  if (unit.owner !== player || !unit.active) return { ok: false, message: "Not your structure" };
  if (unit.deleteAt >= 0) return { ok: false, message: "Cancel demolition before upgrading" };
  if (unit.constructing) return { ok: false, message: "Wait for construction to finish" };
  const max = game.config.maxLevel(unit.type);
  if (unit.level >= max) return { ok: false, message: "Already at max level" };
  const cost = game.config.upgradeCost(unit.type, unit.level);
  if (max <= 1) return { ok: false, message: "Cannot upgrade" };
  if (!prepaid && !game.isDev() && !player.removeGold(cost)) return { ok: false, message: `Not enough gold (${fmt(cost)})` };
  unit.level++;
  game.rail.onStructureCompleted(unit);
  player.linkedFactTick = -100;
  game.onConstructionComplete?.(unit);
  if (unit.type === UnitType.SAMLauncher) unit.samAmmo++;
  return { ok: true, message: `Upgraded to level ${unit.level}` };
}

export function buildableAt(game: Game, player: Player, tile: TileRef): { type: UnitType; cost: number; error: string | null }[] {
  const types = [
    UnitType.City,
    UnitType.Factory,
    UnitType.DefensePost,
    UnitType.Port,
    UnitType.MissileSilo,
    UnitType.SAMLauncher,
    UnitType.Radar,
    UnitType.Warship,
    UnitType.AtomBomb,
    UnitType.HydrogenBomb,
    UnitType.MIRV,
  ];
  return types.map((type) => ({
    type,
    cost: game.config.unitCost(type, game.ownedForCost(player, type)),
    error: game.canBuild(player, type, tile),
  }));
}

export function notify(game: Game, player: Player, r: ActionResult): void {
  if (!r.ok) game.displayMessage(r.message, MessageType.Warn, player.smallID);
  else if (r.message) game.displayMessage(r.message, MessageType.Info, player.smallID);
}

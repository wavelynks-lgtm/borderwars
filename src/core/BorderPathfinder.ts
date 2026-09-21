import { FlatBinaryHeap } from "./BinaryHeap";
import type { GameMap } from "./GameMap";
import type { PlayerID, TileRef } from "./types";

/**
 * A* along country coasts / borders (and your own land) so a far attack can
 * walk a single pixel around other countries instead of cutting through them.
 */
export class BorderPathfinder {
  private nWalk: TileRef[] = [0, 0, 0, 0];
  private nExp: TileRef[] = [0, 0, 0, 0, 0, 0, 0, 0];
  private nSnap: TileRef[] = [0, 0, 0, 0];

  constructor(readonly map: GameMap) {}

  /** Coast, country-line, or player-territory edge. */
  isBorderTile(t: TileRef): boolean {
    const map = this.map;
    if (!map.isLand(t) || map.isImpassable(t)) return false;
    const own = map.owner[t];
    const cid = map.country[t];
    const n = map.neighbors4(t, this.nWalk);
    for (let i = 0; i < n; i++) {
      const nb = this.nWalk[i];
      if (map.isWater(nb) || map.owner[nb] !== own || map.country[nb] !== cid) return true;
    }
    return false;
  }

  canWalk(t: TileRef, attacker: PlayerID, dest: TileRef): boolean {
    if (t === dest) return true;
    const map = this.map;
    if (!map.isLand(t) || map.isImpassable(t)) return false;
    if (map.owner[t] === attacker) return true;
    return this.isBorderTile(t);
  }

  /**
   * Snap a click (often inside a country) to the nearest walkable gate:
   * that owner's / country's border.
   */
  nearestGate(click: TileRef, attacker: PlayerID): TileRef {
    if (this.canWalk(click, attacker, click) && (this.map.owner[click] === attacker || this.isBorderTile(click))) {
      return click;
    }
    const map = this.map;
    const wantOwner = map.owner[click];
    const wantCountry = map.country[click];
    const seen = new Set<TileRef>([click]);
    const q: TileRef[] = [click];
    for (let qi = 0; qi < q.length && qi < 40_000; qi++) {
      const t = q[qi];
      if (this.isBorderTile(t) || map.owner[t] === attacker) return t;
      const n = map.neighbors4(t, this.nSnap);
      for (let i = 0; i < n; i++) {
        const nb = this.nSnap[i];
        if (seen.has(nb) || !map.isLand(nb) || map.isImpassable(nb)) continue;
        if (map.owner[nb] !== wantOwner) continue;
        if (wantOwner === 0 && map.country[nb] !== wantCountry) continue;
        seen.add(nb);
        q.push(nb);
      }
    }
    return click;
  }

  findPath(from: TileRef, to: TileRef, attacker: PlayerID, maxExpansions = 80_000): TileRef[] | null {
    const map = this.map;
    if (from === to) return [from, to];
    const open = new FlatBinaryHeap(2048);
    const gScore = new Map<number, number>();
    const cameFrom = new Map<number, number>();
    const closed = new Set<number>();
    gScore.set(from, 0);
    cameFrom.set(from, -1);
    open.enqueue(from, this.h(from, to));
    let expansions = 0;
    while (open.size() > 0) {
      const cur = open.dequeue();
      if (closed.has(cur)) continue;
      closed.add(cur);
      if (cur === to) return this.reconstruct(cameFrom, from, to);
      if (++expansions > maxExpansions) return null;
      const n = map.neighbors8(cur, this.nExp);
      const cx = map.x(cur);
      const cy = map.y(cur);
      for (let i = 0; i < n; i++) {
        const nb = this.nExp[i];
        if (closed.has(nb) || !this.canWalk(nb, attacker, to)) continue;
        const ortho = map.x(nb) === cx || map.y(nb) === cy;
        const g = (gScore.get(cur) ?? Infinity) + (ortho ? 1 : 1.41);
        if (g >= (gScore.get(nb) ?? Infinity)) continue;
        gScore.set(nb, g);
        cameFrom.set(nb, cur);
        open.enqueue(nb, g + this.h(nb, to));
      }
    }
    return null;
  }

  private h(a: TileRef, b: TileRef): number {
    const map = this.map;
    const W = map.width;
    let dx = Math.abs(map.x(a) - map.x(b));
    if (dx > W / 2) dx = W - dx;
    const dy = Math.abs(map.y(a) - map.y(b));
    return Math.max(dx, dy) + 0.41 * Math.min(dx, dy);
  }

  private reconstruct(cameFrom: Map<number, number>, from: TileRef, to: TileRef): TileRef[] {
    const path: TileRef[] = [to];
    let c = to;
    while (c !== from) {
      const p = cameFrom.get(c);
      if (p === undefined || p < 0) break;
      c = p;
      path.push(c);
    }
    path.reverse();
    if (path[0] !== from) path.unshift(from);
    return path;
  }
}

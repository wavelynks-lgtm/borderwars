import { FlatBinaryHeap } from "./BinaryHeap";
import type { GameMap } from "./GameMap";
import type { TileRef } from "./types";

/**
 * A* over a coarse water grid (factor F). A coarse cell is navigable if its
 * centre is water, so boats go around land / countries instead of clipping
 * through them. 4-connected. Paths are full-resolution tile refs.
 */
export class WaterPathfinder {
  /** Nodes examined by the latest search, including its fine-grid fallback. */
  lastSearchWork = 0;
  /** coarse cell size in tiles: ~4 reference tiles regardless of map resolution */
  readonly F: number;
  readonly cw: number;
  readonly ch: number;
  private water: Uint8Array;
  private gScore: Float32Array;
  private cameFrom: Int32Array;
  private closed: Uint8Array;
  private stamp = 1;
  private stampArr: Uint32Array;

  constructor(readonly map: GameMap) {
    this.F = Math.max(1, Math.round(4 * map.scale));
    this.cw = Math.ceil(map.width / this.F);
    this.ch = Math.ceil(map.height / this.F);
    this.water = new Uint8Array(this.cw * this.ch);
    // A coarse cell is sea only if its centre is water. Marking a cell wet
    // because *any* tile is ocean let boats cut straight through countries.
    for (let cy = 0; cy < this.ch; cy++) {
      for (let cx = 0; cx < this.cw; cx++) {
        const t = this.cellCenterIndex(cx, cy);
        if (map.isWater(t)) this.water[cy * this.cw + cx] = 1;
      }
    }
    const n = this.cw * this.ch;
    this.gScore = new Float32Array(n);
    this.cameFrom = new Int32Array(n);
    this.closed = new Uint8Array(n);
    this.stampArr = new Uint32Array(n);
  }

  private cell(t: TileRef): number {
    const x = (this.map.x(t) / this.F) | 0;
    const y = (this.map.y(t) / this.F) | 0;
    return y * this.cw + x;
  }
  private cellOrigin(c: number): { cx: number; cy: number; x0: number; y0: number; mx: number; my: number } {
    const cx = c % this.cw;
    const cy = (c / this.cw) | 0;
    return this.cellOriginXY(cx, cy);
  }
  private cellOriginXY(cx: number, cy: number): { cx: number; cy: number; x0: number; y0: number; mx: number; my: number } {
    const x0 = cx * this.F;
    const y0 = cy * this.F;
    const mx = Math.min(this.map.width - 1, x0 + (this.F >> 1));
    const my = Math.min(this.map.height - 1, y0 + (this.F >> 1));
    return { cx, cy, x0, y0, mx, my };
  }
  private cellCenterIndex(cx: number, cy: number): TileRef {
    const { mx, my } = this.cellOriginXY(cx, cy);
    return this.map.ref(mx, my);
  }
  private cellCenter(c: number): TileRef {
    const { x0, y0, mx, my } = this.cellOrigin(c);
    const prefer = this.map.ref(mx, my);
    if (this.map.isWater(prefer)) return prefer;
    let best = prefer;
    let bestD = Infinity;
    const x1 = Math.min(this.map.width, x0 + this.F);
    const y1 = Math.min(this.map.height, y0 + this.F);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const t = this.map.ref(x, y);
        if (!this.map.isWater(t)) continue;
        const d = (x - mx) * (x - mx) + (y - my) * (y - my);
        if (d < bestD) {
          bestD = d;
          best = t;
        }
      }
    }
    return best;
  }
  isWaterCell(c: number): boolean {
    return this.water[c] === 1;
  }
  /** a newly flooded tile becomes navigable for boats */
  markWater(t: TileRef): void {
    const cell = this.cell(t);
    const { cx, cy } = this.cellOrigin(cell);
    this.water[cell] = this.map.isWater(this.cellCenterIndex(cx, cy)) ? 1 : 0;
  }
  private h(a: number, b: number): number {
    let dx = Math.abs((a % this.cw) - (b % this.cw));
    if (dx > this.cw / 2) dx = this.cw - dx;
    const dy = Math.abs(((a / this.cw) | 0) - ((b / this.cw) | 0));
    return dx + dy;
  }

  /** find a water path between two tiles (both may be shore/land: their cells are allowed) */
  findPath(from: TileRef, to: TileRef, maxExpansions = 60000): TileRef[] | null {
    this.lastSearchWork = 0;
    if (!this.map.isPassable(from) || !this.map.isPassable(to)) return null;
    const fineBudget = Math.min(12000, Math.floor(maxExpansions / 3));
    return this.findCoarsePath(from, to, maxExpansions - fineBudget) ?? this.findFinePath(from, to, fineBudget);
  }

  /** Bounded fallback for coves and straits smaller than one coarse cell. */
  private findFinePath(from: TileRef, to: TileRef, budget: number): TileRef[] | null {
    const map = this.map;
    const open = new FlatBinaryHeap();
    const score = new Map<TileRef, number>([[from, 0]]);
    const parent = new Map<TileRef, TileRef>();
    const closed = new Set<TileRef>();
    const buf: TileRef[] = [];
    const heuristic = (t: TileRef) => {
      const dx = Math.abs(map.x(t) - map.x(to));
      return Math.min(dx, map.width - dx) + Math.abs(map.y(t) - map.y(to));
    };
    open.enqueue(from, heuristic(from));
    while (open.size() && closed.size < budget) {
      const t = open.dequeue();
      if (closed.has(t)) continue;
      if (t === to) {
        const path = [to];
        let cur = to;
        while (cur !== from) { cur = parent.get(cur)!; path.push(cur); }
        return path.reverse();
      }
      closed.add(t);
      this.lastSearchWork++;
      const n = map.neighbors4(t, buf);
      for (let i = 0; i < n; i++) {
        const nb = buf[i];
        if (closed.has(nb) || (!map.isWater(nb) && nb !== to)) continue;
        const cost = score.get(t)! + 1;
        if (cost >= (score.get(nb) ?? Infinity)) continue;
        score.set(nb, cost); parent.set(nb, t);
        open.enqueue(nb, cost + heuristic(nb));
      }
    }
    return null;
  }

  private findCoarsePath(from: TileRef, to: TileRef, maxExpansions: number): TileRef[] | null {
    const start = this.cell(from);
    const goal = this.cell(to);
    if (!this.map.isPassable(from) || !this.map.isPassable(to)) return null;
    if (start === goal) return this.clearSegment(from, to, from, to) ? [from, to] : null;
    this.stamp++;
    const st = this.stamp;
    const open = new FlatBinaryHeap(1024);
    this.stampArr[start] = st;
    this.gScore[start] = 0;
    this.cameFrom[start] = -1;
    this.closed[start] = 0;
    open.enqueue(start, this.h(start, goal));
    let expansions = 0;
    const cw = this.cw;
    const ch = this.ch;
    while (open.size() > 0) {
      const cur = open.dequeue();
      if (this.stampArr[cur] === st && this.closed[cur]) continue;
      this.closed[cur] = 1;
      if (cur === goal) return this.reconstruct(cur, from, to);
      if (++expansions > maxExpansions) return null;
      this.lastSearchWork++;
      const cx = cur % cw;
      const cy = (cur / cw) | 0;
      // 4-connected so a diagonal step cannot clip a peninsula / country.
      const dirs = [1, 0, -1, 0, 0, 1, 0, -1];
      for (let i = 0; i < 8; i += 2) {
        const dx = dirs[i];
        const dy = dirs[i + 1];
        const ny = cy + dy;
        if (ny < 0 || ny >= ch) continue;
        let nx = cx + dx;
        if (nx < 0) nx += cw;
        else if (nx >= cw) nx -= cw;
        const nb = ny * cw + nx;
        if (!this.water[nb] && nb !== goal) continue;
        const a = cur === start ? from : this.cellCenter(cur);
        const b = nb === goal ? to : this.cellCenter(nb);
        if (!this.clearSegment(a, b, from, to)) continue;
        const g = this.gScore[cur] + 1;
        if (this.stampArr[nb] !== st) {
          this.stampArr[nb] = st;
          this.closed[nb] = 0;
          this.gScore[nb] = Infinity;
        } else if (this.closed[nb]) continue;
        if (g < this.gScore[nb]) {
          this.gScore[nb] = g;
          this.cameFrom[nb] = cur;
          open.enqueue(nb, g + this.h(nb, goal));
        }
      }
    }
    return null;
  }

  /** Supercover check: no thin land strip or diagonal corner may be crossed. */
  private clearSegment(a: TileRef, b: TileRef, from: TileRef, to: TileRef): boolean {
    const map = this.map;
    const x = map.x(a), y = map.y(a);
    let dx = map.x(b) - x;
    if (dx > map.width / 2) dx -= map.width;
    if (dx < -map.width / 2) dx += map.width;
    const dy = map.y(b) - y;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 2));
    const allowed = (t: TileRef) => t >= 0 && (map.isWater(t) || t === from || t === to);
    let px = x, py = y;
    for (let i = 1; i <= steps; i++) {
      const nx = Math.round(x + dx * i / steps), ny = Math.round(y + dy * i / steps);
      if (!allowed(map.refWrapped(nx, ny))) return false;
      if (nx !== px && ny !== py &&
        (!allowed(map.refWrapped(nx, py)) || !allowed(map.refWrapped(px, ny)))) return false;
      px = nx; py = ny;
    }
    return true;
  }

  private reconstruct(goal: number, from: TileRef, to: TileRef): TileRef[] {
    const cells: number[] = [];
    let c = goal;
    while (c !== -1) {
      cells.push(c);
      c = this.cameFrom[c];
    }
    cells.reverse();
    const path: TileRef[] = [from];
    for (let i = 1; i < cells.length - 1; i++) path.push(this.cellCenter(cells[i]));
    path.push(to);
    return path;
  }
}

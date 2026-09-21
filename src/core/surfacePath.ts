import type { GameMap } from "./GameMap";

/** Distance in equatorial pixel units; interpolation preserves every rail corner. */
export class SurfacePath {
  readonly distances: number[] = [0];
  readonly length: number;
  constructor(readonly map: GameMap, readonly tiles: number[]) {
    for (let i = 1; i < tiles.length; i++) {
      const a = tiles[i-1], b = tiles[i];
      let dx = map.x(b)-map.x(a);
      if (dx > map.width/2) dx -= map.width;
      if (dx < -map.width/2) dx += map.width;
      const row = (map.y(a)+map.y(b)+1)/2;
      const cos = Math.sin(Math.PI*row/map.height);
      const dy = (map.y(b)-map.y(a))*map.width/(2*map.height);
      this.distances.push(this.distances[i-1]+Math.hypot(dx*cos,dy));
    }
    this.length = this.distances.at(-1) ?? 0;
  }
  sample(distance: number): { x: number; y: number; index: number } {
    distance = Math.max(0, Math.min(this.length, distance));
    let lo = 0, hi = this.tiles.length-1;
    while (lo < hi) {
      const mid = Math.ceil((lo+hi)/2);
      if (this.distances[mid] <= distance) lo = mid; else hi = mid-1;
    }
    const a = this.tiles[lo], b = this.tiles[Math.min(lo+1,this.tiles.length-1)];
    const length = (this.distances[lo+1] ?? this.length)-this.distances[lo];
    const t = length > 0 ? (distance-this.distances[lo])/length : 0;
    let dx = this.map.x(b)-this.map.x(a);
    if (dx > this.map.width/2) dx -= this.map.width;
    if (dx < -this.map.width/2) dx += this.map.width;
    return { x: (this.map.x(a)+0.5+dx*t+this.map.width)%this.map.width, y: this.map.y(a)+0.5+(this.map.y(b)-this.map.y(a))*t, index: lo };
  }
}

import type { GameMap } from "./GameMap";
import type { TileRef } from "./types";

export interface PathMover {
  fx: number;
  fy: number;
  heading: number;
  path: TileRef[];
  pathIndex: number;
  tile: TileRef;
}

/**
 * Advance a unit along its path by `speed` equatorial pixel units. Handles x wrap-around.
 * Returns true when the final waypoint is reached.
 */
export function moveAlongPath(u: PathMover, speed: number, map: GameMap): boolean {
  const W = map.width;
  let remaining = speed;
  while (remaining > 0) {
    if (u.pathIndex >= u.path.length) return true;
    const target = u.path[u.pathIndex];
    const tx = map.x(target) + 0.5;
    const ty = map.y(target) + 0.5;
    let dx = tx - u.fx;
    if (dx > W / 2) dx -= W;
    else if (dx < -W / 2) dx += W;
    const dy = ty - u.fy;
    const latitudeScale = Math.max(1e-6, Math.sin(Math.PI * (u.fy + ty) / (2 * map.height)));
    const northScale = map.width / (2 * map.height);
    const d = Math.hypot(dx * latitudeScale, dy * northScale);
    if (d <= remaining) {
      u.fx = tx;
      u.fy = ty;
      remaining -= d;
      u.pathIndex++;
      if (u.pathIndex >= u.path.length) {
        u.tile = target;
        return true;
      }
    } else {
      if (dx * dx + dy * dy > 1e-8) u.heading = Math.atan2(dx * latitudeScale, -dy * northScale);
      u.fx += (dx / d) * remaining;
      u.fy += (dy / d) * remaining;
      remaining = 0;
    }
    if (u.fx < 0) u.fx += W;
    else if (u.fx >= W) u.fx -= W;
  }
  u.tile = map.ref(Math.min(W - 1, Math.max(0, Math.floor(u.fx))), Math.min(map.height - 1, Math.max(0, Math.floor(u.fy))));
  return false;
}

/** straight-line path in tile space between two tiles (shortest way around the globe) */
export function straightPath(map: GameMap, from: number, to: number, step = 8): number[] {
  const W = map.width;
  const x0 = map.x(from);
  const y0 = map.y(from);
  let x1 = map.x(to);
  const y1 = map.y(to);
  let dx = x1 - x0;
  if (dx > W / 2) dx -= W;
  else if (dx < -W / 2) dx += W;
  const dy = y1 - y0;
  const d = Math.sqrt(dx * dx + dy * dy);
  const n = Math.max(1, Math.ceil(d / step));
  const path: number[] = [];
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    let x = Math.round(x0 + dx * k);
    x = ((x % W) + W) % W;
    const y = Math.max(0, Math.min(map.height - 1, Math.round(y0 + dy * k)));
    path.push(map.ref(x, y));
  }
  return path;
}

/**
 * Step `speed` tiles toward `to` in wrapped tile space (air / shells / SAM).
 * Returns true when the remaining distance is within one tile.
 */
export function stepToward(u: PathMover, to: TileRef, speed: number, map: GameMap): boolean {
  const W = map.width;
  const tx = map.x(to) + 0.5;
  const ty = map.y(to) + 0.5;
  let dx = tx - u.fx;
  if (dx > W / 2) dx -= W;
  else if (dx < -W / 2) dx += W;
  const dy = ty - u.fy;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d <= Math.max(1, speed) || d < 1.25) {
    u.fx = tx;
    u.fy = ty;
    u.tile = to;
    return true;
  }
  u.heading = Math.atan2(dx, -dy);
  u.fx += (dx / d) * speed;
  u.fy += (dy / d) * speed;
  if (u.fx < 0) u.fx += W;
  else if (u.fx >= W) u.fx -= W;
  u.tile = map.ref(Math.min(W - 1, Math.max(0, Math.floor(u.fx))), Math.min(map.height - 1, Math.max(0, Math.floor(u.fy))));
  return false;
}

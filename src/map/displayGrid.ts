/** Latitude bands with approximately equal east/west and north/south surface spacing.
 * The CPU picker and GLSL sampler share this definition. The native simulation
 * raster stays untouched; this is a display grid, not a new map topology.
 */
export function displayColumns(width: number, height: number, row: number): number {
  return Math.max(1, Math.round(2 * height * Math.sin(Math.PI * (row + 0.5) / height)));
}

export function displayTile(width: number, height: number, tile: number): number {
  const row = Math.floor(tile / width);
  const columns = displayColumns(width, height, row);
  const col = Math.floor(((tile % width) + 0.5) / width * columns);
  return row * width + Math.min(width - 1, Math.floor((col + 0.5) / columns * width));
}

export function displayTileAtUV(width: number, height: number, u: number, v: number): number {
  const row = Math.max(0, Math.min(height - 1, Math.floor(v * height)));
  const columns = displayColumns(width, height, row);
  const col = Math.floor(((u % 1 + 1) % 1) * columns);
  return row * width + Math.min(width - 1, Math.floor((col + 0.5) / columns * width));
}

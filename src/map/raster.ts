import type { Feature, MultiPolygon, Polygon, Position } from "geojson";

export type CountryFeature = Feature<Polygon | MultiPolygon, { name: string }>;

export function polygonsOf(f: CountryFeature): Position[][][] {
  return f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
}

/** Reusable scratch buffers for the scanline rasterizer. */
export class Rasterizer {
  private rowBuf: Float64Array[];
  private counts: Int32Array;
  constructor(
    private W: number,
    private H: number,
  ) {
    this.rowBuf = new Array(H);
    this.counts = new Int32Array(H);
  }

  /**
   * Scanline even-odd rasterization of one feature into `target` with value `id`.
   * All rings of the feature are processed together so holes work.
   */
  rasterize(f: CountryFeature, id: number, target: Uint16Array): void {
    const { W, H, rowBuf, counts } = this;
    const sx = W / 360;
    const sy = H / 180;
    let minRow = H;
    let maxRow = -1;

    const addEdge = (x0: number, y0: number, x1: number, y1: number) => {
          if (y0 === y1) return;
          if (y0 > y1) {
            const tx = x0;
            x0 = x1;
            x1 = tx;
            const ty = y0;
            y0 = y1;
            y1 = ty;
          }
          // scanlines at row centres r+0.5 with y0 <= r+0.5 < y1
          const rStart = Math.max(0, Math.ceil(y0 - 0.5));
          const rEnd = Math.min(H - 1, Math.ceil(y1 - 0.5) - 1);
          if (rEnd < rStart) return;
          const slope = (x1 - x0) / (y1 - y0);
          for (let r = rStart; r <= rEnd; r++) {
            const x = x0 + (r + 0.5 - y0) * slope;
            let buf = rowBuf[r];
            const c = counts[r];
            if (buf === undefined || c >= buf.length) {
              const nb = new Float64Array(buf ? buf.length * 2 : 16);
              if (buf) nb.set(buf);
              rowBuf[r] = nb;
              buf = nb;
            }
            buf[c] = x;
            counts[r] = c + 1;
            if (r < minRow) minRow = r;
            if (r > maxRow) maxRow = r;
          }
    };

    for (const poly of polygonsOf(f)) {
      for (const ring of poly) {
        const n = ring.length;
        const cuts: number[] = [];
        for (let i = 0; i < n; i++) {
          const a = ring[i];
          const b = ring[(i + 1) % n];
          const lonA = a[0];
          const lonB = b[0];
          const y0 = (90 - a[1]) * sy;
          const y1 = (90 - b[1]) * sy;
          if (Math.abs(lonB - lonA) > 180) {
            // edge wraps around the antimeridian: split it in two at x = 0 / x = W
            const toEast = lonB < lonA; // travelling eastwards past +180
            const lb = toEast ? lonB + 360 : lonB - 360; // unwrapped end longitude
            const frac = ((toEast ? 180 : -180) - lonA) / (lb - lonA); // where lon hits ±180
            const ym = y0 + (y1 - y0) * frac;
            if (!Number.isFinite(ym)) continue;
            cuts.push(ym);
            if (toEast) {
              addEdge((lonA + 180) * sx, y0, W, ym);
              addEdge(0, ym, (lonB + 180) * sx, y1);
            } else {
              addEdge((lonA + 180) * sx, y0, 0, ym);
              addEdge(W, ym, (lonB + 180) * sx, y1);
            }
          } else {
            addEdge((lonA + 180) * sx, y0, (lonB + 180) * sx, y1);
          }
        }
        // close the pieces of a ring that was cut by the antimeridian
        if (cuts.length >= 2) {
          cuts.sort((a, b) => a - b);
          for (let i = 0; i + 1 < cuts.length; i += 2) {
            addEdge(0, cuts[i], 0, cuts[i + 1]);
            addEdge(W, cuts[i], W, cuts[i + 1]);
          }
        }
      }
    }

    for (let r = minRow; r <= maxRow; r++) {
      const c = counts[r];
      counts[r] = 0;
      if (c < 2) continue;
      const buf = rowBuf[r].subarray(0, c);
      buf.sort();
      const base = r * W;
      for (let i = 0; i + 1 < c; i += 2) {
        const xs = Math.max(0, Math.ceil(buf[i] - 0.5));
        const xe = Math.min(W - 1, Math.ceil(buf[i + 1] - 0.5) - 1);
        for (let x = xs; x <= xe; x++) target[base + x] = id;
      }
    }
  }
}

export function ringArea(ring: Position[]): number {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

/** Centroid (lat/lon) of the largest outer ring of a feature. */
export function largestRingCentroid(f: CountryFeature): { lat: number; lon: number } {
  let best: Position[] | null = null;
  let bestA = -1;
  for (const poly of polygonsOf(f)) {
    const a = ringArea(poly[0]);
    if (a > bestA) {
      bestA = a;
      best = poly[0];
    }
  }
  if (!best) return { lat: 0, lon: 0 };
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0, n = best.length; i < n; i++) {
    const p = best[i];
    const q = best[(i + 1) % n];
    const cross = p[0] * q[1] - q[0] * p[1];
    a += cross;
    cx += (p[0] + q[0]) * cross;
    cy += (p[1] + q[1]) * cross;
  }
  if (Math.abs(a) < 1e-9) return { lon: best[0][0], lat: best[0][1] };
  a *= 0.5;
  return { lon: cx / (6 * a), lat: cy / (6 * a) };
}

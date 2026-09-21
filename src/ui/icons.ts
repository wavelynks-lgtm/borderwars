import iconAtlasUrl from "../assets/sprites/icon-atlas.png?url";
import { STRUCTURES, UnitType } from "../core/types";

/**
 * HUD uses OpenFront SVGs. Globe structures are OpenFront plates
 * (owner-colored circle / pentagon / hex / octagon / square / triangle
 * plus a white glyph). Ships are owner-colored silhouettes of those glyphs.
 */
export interface PixelIcon {
  rows: string[];
  colors: Record<string, string>;
}

const W = "#ffffff";

/** white-on-transparent glyphs, drawn on the colored plate */
export const PIXEL_ICONS: Record<UnitType, PixelIcon> = {
  [UnitType.City]: {
    rows: ["........", "..##....", ".#++#.#.", "#++++#+#", "##++####", ".#ww#.#.", ".######.", "........"],
    colors: { "#": W, "+": "#dfe6ee", w: W },
  },
  [UnitType.Factory]: {
    rows: ["........", ".##..##.", ".#+##+#.", ".######.", ".#ssss#.", ".#s##s#.", ".######.", "........"],
    colors: { "#": W, "+": "#dfe6ee", s: "#c8d0d8" },
  },
  [UnitType.DefensePost]: {
    rows: ["........", ".######.", "#++++++#", "#+wwww+#", "#++++++#", ".#++++#.", "..####..", "........"],
    colors: { "#": W, "+": "#dfe6ee", w: W },
  },
  [UnitType.Port]: {
    rows: ["........", "...ww...", "..#++#..", ".##++##.", "########", "...##...", "..#..#..", ".#....#."],
    colors: { "#": W, "+": "#dfe6ee", w: W },
  },
  [UnitType.MissileSilo]: {
    rows: ["...##...", "..#++#..", "..#+w#..", "..####..", "..#rr#..", ".##rr##.", "#+.##.+#", "........"],
    colors: { "#": W, "+": "#dfe6ee", r: W, w: W },
  },
  [UnitType.SAMLauncher]: {
    rows: ["........", ".##..##.", ".#+..+#.", "..#++#..", "...##...", ".######.", "#++++++#", "########"],
    colors: { "#": W, "+": "#dfe6ee" },
  },
  [UnitType.Radar]: {
    rows: ["........", "....#c..", "..##c#..", ".#..c#..", ".#.###..", "..#+#...", ".######.", "........"],
    colors: { "#": W, "+": "#dfe6ee", c: W },
  },
  [UnitType.Warship]: {
    rows: ["........", "....#...", "...###..", "..#+#+..", ".#######", "#+++++++", ".#######", "..#####."],
    colors: { "#": "#1a140e", "+": W },
  },
  [UnitType.TransportShip]: {
    rows: ["........", ".w.w.w..", ".######.", "#++++++#", "########", ".######.", "..####..", "........"],
    colors: { "#": "#1a140e", "+": W, w: W },
  },
  [UnitType.TradeShip]: {
    rows: ["........", "...##...", "...#+...", "...##...", "....+#..", ".######.", "########", ".######."],
    colors: { "#": "#1a140e", "+": W },
  },
  [UnitType.Train]: {
    rows: ["........", "..##.ww.", ".#++#.#.", ".#++###.", "#######.", ".#+++#..", ".#oo#oo.", "........"],
    colors: { "#": "#3d3a38", "+": "#d4a017", o: "#1a1a1a", w: W },
  },
  [UnitType.AtomBomb]: {
    rows: ["...##...", "..#++#..", ".#++++#.", ".#+##+#.", ".#++++#.", "..#++#..", ".##.##.#", "#..##..#"],
    colors: { "#": "#ff5a5f", "+": "#ffb0b3" },
  },
  [UnitType.HydrogenBomb]: {
    rows: ["..####..", ".#++++#.", "#++++++#", ".##++##.", "...++...", "...++...", "..#++#..", ".######."],
    colors: { "#": "#ff2d95", "+": "#ffb3da" },
  },
  [UnitType.MIRV]: {
    rows: ["...##...", "..#++#..", "...##...", "..#rr#..", ".#+.##+.", "#+.##.+#", ".##yy##.", "...yy..."],
    colors: { "#": "#ff7a18", "+": "#ffd0a0", r: "#ff5a5f", y: "#ffb347" },
  },
  [UnitType.MIRVWarhead]: {
    rows: ["........", "...##...", "..#++#..", "...##...", "..#rr#..", "...rr...", "...yy...", "........"],
    colors: { "#": "#ff5a5f", "+": "#ffb0b3", r: "#ff3b30", y: "#ffb347" },
  },
  [UnitType.Shell]: {
    rows: ["........", "........", "...##...", "..#++#..", "...##...", "........", "........", "........"],
    colors: { "#": "#c8a84a", "+": "#ffe566" },
  },
  [UnitType.SAMMissile]: {
    rows: ["...##...", "..#++#..", "..#++#..", "...##...", "...rr...", "...rr...", "........", "........"],
    colors: { "#": "#2c313c", "+": "#7ec8ff", r: "#ff7a18" },
  },
};

export const ICON_SIZE = 8;
/** canvas size for structure plates (smooth OpenFront shapes, not voxels). */
export const STRUCTURE_CELLS = 64;

const INK = "#140e0a";

type ShapeKind = "circle" | "triangle" | "square" | "pentagon" | "hexagon" | "octagon";

export function structureShape(type: UnitType): { kind: ShapeKind; scale: number; iconFill: number } {
  switch (type) {
    case UnitType.Port:
      return { kind: "pentagon", scale: 1.08, iconFill: 0.85 };
    case UnitType.Factory:
      return { kind: "hexagon", scale: 1.08, iconFill: 0.85 };
    case UnitType.DefensePost:
      return { kind: "octagon", scale: 1, iconFill: 0.8 };
    case UnitType.SAMLauncher:
      return { kind: "square", scale: 1.4, iconFill: 1 };
    case UnitType.MissileSilo:
      return { kind: "triangle", scale: 1.55, iconFill: 0.85 };
    default:
      return { kind: "circle", scale: 1, iconFill: 0.85 };
  }
}

function drawRegularPolygon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, n: number, rot: number): void {
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawStructureShape(ctx: CanvasRenderingContext2D, kind: ShapeKind, cx: number, cy: number, r: number): void {
  switch (kind) {
    case "circle":
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.closePath();
      break;
    case "triangle":
      drawRegularPolygon(ctx, cx, cy, r, 3, -Math.PI / 2);
      break;
    case "square":
      drawRegularPolygon(ctx, cx, cy, r, 4, Math.PI / 4);
      break;
    case "pentagon":
      drawRegularPolygon(ctx, cx, cy, r, 5, -Math.PI / 2);
      break;
    case "hexagon":
      drawRegularPolygon(ctx, cx, cy, r, 6, 0);
      break;
    case "octagon":
      drawRegularPolygon(ctx, cx, cy, r, 8, Math.PI / 8);
      break;
  }
}

const whiteGlyphs = new Map<UnitType, HTMLCanvasElement>();
const glyphWaiters: Array<() => void> = [];
let glyphsReady = false;

export function hudGlyphsReady(): boolean {
  return glyphsReady;
}

export function whenHudGlyphsReady(cb: () => void): void {
  if (glyphsReady) cb();
  else glyphWaiters.push(cb);
}

function whiteMask(img: CanvasImageSource, size = 64): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = "destination-in";
  g.drawImage(img, 4, 4, size - 8, size - 8);
  return c;
}

function stampGlyph(ctx: CanvasRenderingContext2D, type: UnitType, cx: number, cy: number, size: number): void {
  const ready = whiteGlyphs.get(type);
  if (ready) {
    ctx.drawImage(ready, cx - size / 2, cy - size / 2, size, size);
    return;
  }
  const icon = PIXEL_ICONS[type];
  if (!icon) return;
  const scale = Math.max(1, Math.floor(size / (ICON_SIZE + 2)));
  paintIcon(ctx, icon, cx - (ICON_SIZE * scale) / 2, cy - (ICON_SIZE * scale) / 2, scale, {}, null);
}

/** OpenFront structure mark: owner-colored plate + white glyph. */
export function paintStructureMark(
  ctx: CanvasRenderingContext2D,
  type: UnitType,
  ownerColor: string,
  cells: number,
  px: number,
  opts: { level?: number; ghost?: "valid" | "invalid" | null; constructing?: boolean } = {},
): void {
  const s = cells * px;
  const cx = s / 2;
  const cy = s / 2;
  const { kind, scale, iconFill } = structureShape(type);
  const fill = opts.constructing ? "#c6c6c6" : opts.ghost === "invalid" ? "#ff5a5f" : ownerColor;
  const plate = opts.constructing ? "#c6c6c6" : shade(fill, -0.35);
  const border = shade(fill, -0.9);
  const R = s * 0.45;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  if (opts.ghost) {
    ctx.globalAlpha = 0.88;
    ctx.setLineDash([5, 4]);
  }
  drawStructureShape(ctx, kind, cx, cy, R);
  ctx.fillStyle = plate;
  ctx.fill();
  ctx.lineWidth = s * 0.06 / scale;
  ctx.strokeStyle = opts.constructing ? "#7f7f7f" : border;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.save();
  drawStructureShape(ctx, kind, cx, cy, R - ctx.lineWidth / 2);
  ctx.clip();
  stampGlyph(ctx, type, cx, cy, s * iconFill / scale);
  ctx.restore();
  const level = opts.level ?? 1;
  if (level > 1) {
    ctx.font = `700 ${Math.max(10, Math.floor(s * 0.16))}px "Pixelify Sans", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3;
    ctx.strokeStyle = INK;
    ctx.fillStyle = "#fff";
    const label = `x${level}`;
    ctx.strokeText(label, cx, cy + R * 0.72);
    ctx.fillText(label, cx, cy + R * 0.72);
  }
  ctx.restore();
}

/** Colorize a white-on-transparent glyph into an owner-tinted ship sprite. */
export function paintOwnerGlyph(ctx: CanvasRenderingContext2D, type: UnitType, ownerColor: string, size: number): void {
  const tmp = document.createElement("canvas");
  tmp.width = size;
  tmp.height = size;
  const g = tmp.getContext("2d")!;
  stampGlyph(g, type, size / 2, size / 2, size * 0.9);
  const img = g.getImageData(0, 0, size, size);
  const d = img.data;
  const parse = (c: string) => {
    const m = c.startsWith("#")
      ? [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]
      : (c.match(/\d+/g) ?? ["128", "128", "128"]).slice(0, 3).map(Number);
    return m as number[];
  };
  const O = parse(shade(ownerColor, 0));
  const H = parse(shade(ownerColor, 0.45));
  const L = parse(shade(ownerColor, -0.45));
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 16) {
      d[i + 3] = 0;
      continue;
    }
    const lum = (d[i] + d[i + 1] + d[i + 2]) / (3 * 255);
    const src = lum > 0.72 ? H : lum > 0.35 ? O : L;
    d[i] = src[0];
    d[i + 1] = src[1];
    d[i + 2] = src[2];
  }
  g.putImageData(img, 0, 0);
  ctx.drawImage(tmp, 0, 0);
}

/** 5×5 / 7×7 hulls facing up; `#` hull, `+` cabin, `w` sail/wake */
export const SHIP_PIXELS: Record<"trade" | "transport" | "warship" | "skiff", string[]> = {
  trade: ["..#..", ".#+#.", "#####", ".#.#."],
  skiff: ["..#..", ".###.", ".#.#."],
  transport: ["..w..", ".###.", "#+++#", "#####", ".#.#."],
  warship: ["...#...", "..###..", ".##+##.", "#######", "##.#.##", ".#####.", "..#.#.."],
};

export function paintShipPixels(
  ctx: CanvasRenderingContext2D,
  kind: keyof typeof SHIP_PIXELS,
  ownerColor: string,
  px: number,
  loaded = false,
): { cells: number } {
  const rows = SHIP_PIXELS[kind];
  const cells = rows[0].length;
  const ink = "#140e0a";
  const cabin = loaded ? "#ffe566" : shade(ownerColor, 0.35);
  const pal: Record<string, string> = { "#": ownerColor, "+": cabin, w: "#f4f0e6" };
  const solid = (r: number, c: number) => r >= 0 && c >= 0 && r < rows.length && c < rows[r].length && rows[r][c] !== ".";
  ctx.fillStyle = ink;
  for (let r = -1; r <= rows.length; r++) {
    for (let c = -1; c <= cells; c++) {
      if (solid(r, c)) continue;
      if (solid(r - 1, c) || solid(r + 1, c) || solid(r, c - 1) || solid(r, c + 1)) {
        ctx.fillRect(c * px, r * px, px, px);
      }
    }
  }
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const ch = rows[r][c];
      if (ch === ".") continue;
      ctx.fillStyle = pal[ch] ?? ownerColor;
      ctx.fillRect(c * px, r * px, px, px);
    }
  }
  return { cells };
}

/** Paint a pixel icon into a 2D context at (x, y), each pixel `scale` px wide. */
export function paintIcon(
  ctx: CanvasRenderingContext2D,
  icon: PixelIcon,
  x: number,
  y: number,
  scale: number,
  overrides: Record<string, string> = {},
  outline: string | null = "rgba(0,0,0,0.85)",
): void {
  const rows = icon.rows;
  const w = rows[0]?.length ?? ICON_SIZE;
  const solid = (r: number, c: number) => r >= 0 && c >= 0 && r < rows.length && c < rows[r].length && rows[r][c] !== ".";
  if (outline) {
    ctx.fillStyle = outline;
    for (let r = -1; r <= rows.length; r++) {
      for (let c = -1; c <= w; c++) {
        if (solid(r, c)) continue;
        if (solid(r - 1, c) || solid(r + 1, c) || solid(r, c - 1) || solid(r, c + 1)) {
          ctx.fillRect(x + c * scale, y + r * scale, scale, scale);
        }
      }
    }
  }
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      const ch = row[c];
      if (ch === ".") continue;
      ctx.fillStyle = overrides[ch] ?? icon.colors[ch] ?? "#fff";
      ctx.fillRect(x + c * scale, y + r * scale, scale, scale);
    }
  }
}

const urlCache = new Map<string, string>();

/** Icon as a data URL (for <img>), rendered crisp at `scale` px per pixel. */
export function iconUrl(type: UnitType, scale = 3, overrides: Record<string, string> = {}): string {
  const key = `${type}|${scale}|${JSON.stringify(overrides)}|mark`;
  let u = urlCache.get(key);
  if (!u) {
    const cells = STRUCTURES.has(type) ? STRUCTURE_CELLS : ICON_SIZE + 2;
    const s = cells * scale;
    const c = document.createElement("canvas");
    c.width = s;
    c.height = s;
    const ctx = c.getContext("2d")!;
    if (STRUCTURES.has(type)) {
      paintStructureMark(ctx, type, overrides["#"] ?? "#6b7380", cells, scale);
    } else {
      paintIcon(ctx, PIXEL_ICONS[type], scale, scale, scale, overrides);
    }
    u = c.toDataURL();
    urlCache.set(key, u);
  }
  return u;
}

/** OpenFront SVGs (CC BY-SA) used on the HUD, build bar, player panel, and globe plates. */
const HUD_SVG = import.meta.glob("../assets/hud-icons/*.svg", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

function hudUrl(name: string): string {
  return HUD_SVG[`../assets/hud-icons/${name}.svg`] ?? "";
}

export const HUD_UNIT_ICON: Partial<Record<UnitType, string>> = {
  [UnitType.City]: hudUrl("city"),
  [UnitType.Factory]: hudUrl("factory"),
  [UnitType.DefensePost]: hudUrl("defense"),
  [UnitType.Port]: hudUrl("port"),
  [UnitType.MissileSilo]: hudUrl("silo"),
  [UnitType.SAMLauncher]: hudUrl("sam"),
  [UnitType.Radar]: hudUrl("radar"),
  [UnitType.Warship]: hudUrl("warship"),
  [UnitType.TransportShip]: hudUrl("boat"),
  [UnitType.TradeShip]: hudUrl("trade"),
  [UnitType.AtomBomb]: hudUrl("atom"),
  [UnitType.HydrogenBomb]: hudUrl("hydrogen"),
  [UnitType.MIRV]: hudUrl("mirv"),
};

function preloadHudGlyphs(): void {
  if (typeof Image === "undefined") {
    glyphsReady = true;
    return;
  }
  const atlasTypes = [UnitType.City, UnitType.Port, UnitType.Factory, UnitType.DefensePost, UnitType.SAMLauncher, UnitType.MissileSilo];
  const entries = (Object.entries(HUD_UNIT_ICON) as [UnitType, string][]).filter(([type]) => !atlasTypes.includes(type));
  if (entries.length === 0) {
    glyphsReady = true;
    return;
  }
  let left = entries.length + 1;
  const done = () => {
    left--;
    if (left > 0) return;
    glyphsReady = true;
    for (const cb of glyphWaiters.splice(0)) cb();
  };
  const atlas = new Image();
  atlas.onload = () => {
    const cell = atlas.width / atlasTypes.length;
    atlasTypes.forEach((type, i) => {
      const canvas = document.createElement("canvas");
      canvas.width = cell; canvas.height = atlas.height;
      canvas.getContext("2d")!.drawImage(atlas, i * cell, 0, cell, atlas.height, 0, 0, cell, atlas.height);
      whiteGlyphs.set(type, canvas);
    });
    done();
  };
  atlas.onerror = done;
  atlas.src = iconAtlasUrl;
  for (const [type, src] of entries) {
    if (!src) {
      done();
      continue;
    }
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      whiteGlyphs.set(type, whiteMask(img));
      done();
    };
    img.onerror = () => done();
    img.src = src;
  }
}
preloadHudGlyphs();

export function namedIcon(name: string, px = 16): HTMLImageElement {
  const img = document.createElement("img");
  img.src = hudUrl(name);
  img.width = px;
  img.height = px;
  img.className = "hud-icon";
  img.alt = name;
  img.draggable = false;
  return img;
}

export function iconImg(type: UnitType, px = 28, overrides: Record<string, string> = {}): HTMLImageElement {
  const src = HUD_UNIT_ICON[type];
  if (src) {
    const img = document.createElement("img");
    img.src = src;
    img.width = px;
    img.height = px;
    img.className = "hud-icon";
    img.alt = type;
    img.draggable = false;
    return img;
  }
  const img = document.createElement("img");
  img.src = iconUrl(type, 4, overrides);
  img.width = px;
  img.height = px;
  img.className = "px-icon";
  img.alt = type;
  img.draggable = false;
  return img;
}

/** lighten/darken a css hex or rgb() colour */
export function shade(color: string, amount: number): string {
  const m = color.startsWith("#")
    ? [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)]
    : (color.match(/\d+/g) ?? ["128", "128", "128"]).slice(0, 3).map(Number);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount))));
  return `rgb(${f(m[0])},${f(m[1])},${f(m[2])})`;
}

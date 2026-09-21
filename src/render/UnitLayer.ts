import { StructureOverview } from "./StructureOverview";
import * as THREE from "three";
import { RailLayer } from "./RailLayer";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { Game } from "../core/Game";
import type { Player } from "../core/Player";
import { Unit } from "../core/Unit";
import { NUKES, STRUCTURES, UnitType } from "../core/types";
import { GLOBE_RADIUS, latLonToVec3 } from "../map/geo";
import { BALLISTIC_SAMPLES, sampleBallisticArc } from "../map/ballistic";
import { PIXEL_ICONS, STRUCTURE_CELLS, paintIcon, paintStructureMark, structureShape, shade, whenHudGlyphsReady } from "../ui/icons";
import type { GlobeRenderer } from "./GlobeRenderer";

interface FatArc {
  geo: LineGeometry;
  dark: Line2;
  bright: Line2;
  outline: LineMaterial;
  core: LineMaterial;
}

const SHIPS: ReadonlySet<UnitType> = new Set([UnitType.Warship, UnitType.TransportShip, UnitType.TradeShip]);

/** tiny pixel rocket, nose-up. `+` body, `#` outline, `w` highlight, `f` fin, `o`/`y` exhaust. */
const ROCKET: string[] = [
  "...#...",
  "..#+#..",
  "..#+#..",
  "..w#w..",
  ".#+++#.",
  ".#+++#.",
  ".#####.",
  "#.#.#.#",
  "..#.#..",
  "...o...",
  "...y...",
];

function rocketPalette(type: UnitType): Record<string, string> {
  if (type === UnitType.HydrogenBomb) return { "#": "#4a2038", "+": "#ff7ab8", w: "#ffe0f0", o: "#ff6b4a", y: "#ffe566" };
  if (type === UnitType.MIRV || type === UnitType.MIRVWarhead) return { "#": "#4a2a10", "+": "#ff8a2a", w: "#ffd0a0", o: "#ff5a5f", y: "#ffe566" };
  return { "#": "#2c313c", "+": "#e8ecf2", w: "#ffffff", o: "#ff7a18", y: "#ffe566" };
}

/** CanvasTexture for a camera-facing sprite. Matches the build-bar <img> (left = left, roof = up). */
function spriteTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.flipY = true;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** 1 canvas pixel = 1 map tile. No X-flip — these sit on a surface plane, not a sprite. */
function pixelTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.flipY = true;
  return tex;
}

function makeRocket(type: UnitType): THREE.Texture {
  const px = 5;
  const rows = ROCKET;
  const cw = rows[0].length;
  const ch = rows.length;
  const cells = Math.max(cw, ch) + 2;
  const s = cells * px;
  const c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, s, s);
  const pal = rocketPalette(type);
  const ox = Math.floor((cells - cw) / 2);
  const oy = Math.floor((cells - ch) / 2);
  for (let r = 0; r < ch; r++) {
    for (let col = 0; col < cw; col++) {
      const pix = rows[r][col];
      if (pix === ".") continue;
      ctx.fillStyle = pal[pix] ?? "#fff";
      ctx.fillRect((ox + col) * px, (oy + r) * px, px, px);
    }
  }
  return spriteTexture(c);
}

/** Warship: a little shaded circle of map pixels. `#` hull, `+` highlight. */
const WARSHIP_CIRCLE = ["###", "#+#", "###"];

function paintPixelRows(ctx: CanvasRenderingContext2D, rows: string[], ownerColor: string, px = 1): void {
  const hi = shade(ownerColor, 0.42);
  const pal: Record<string, string> = { "#": ownerColor, "+": hi, w: "#f4f0e6" };
  const ink = "#140e0a";
  const h = rows.length;
  const w = rows[0].length;
  const solid = (r: number, c: number) => r >= 0 && c >= 0 && r < h && c < w && rows[r][c] !== ".";
  for (let r = -1; r <= h; r++) {
    for (let c = -1; c <= w; c++) {
      if (solid(r, c)) continue;
      if (solid(r - 1, c) || solid(r + 1, c) || solid(r, c - 1) || solid(r, c + 1)) {
        ctx.fillStyle = ink;
        ctx.fillRect(c * px, r * px, px, px);
      }
    }
  }
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const ch = rows[r][c];
      if (ch === ".") continue;
      ctx.fillStyle = pal[ch] ?? ownerColor;
      ctx.fillRect(c * px, r * px, px, px);
    }
  }
}

function canvasFromRows(rows: string[], ownerColor: string): HTMLCanvasElement {
  const n = rows.length;
  const c = document.createElement("canvas");
  c.width = n;
  c.height = n;
  paintPixelRows(c.getContext("2d")!, rows, ownerColor, 1);
  return c;
}

/** OpenFront plate (structures) or a tiny pixel hull (ships). */
function makeSprite(type: UnitType, ownerColor: string, ghost: "valid" | "invalid" | null = null, level = 1, _skiff = false, constructing = false): THREE.Texture {
  const px = STRUCTURES.has(type) ? 2 : 5;
  if (SHIPS.has(type)) {
    const rows = type === UnitType.Warship ? WARSHIP_CIRCLE : ["#"];
    const n = rows.length;
    const c = document.createElement("canvas");
    c.width = (n + 2) * px;
    c.height = (n + 2) * px;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.translate(px, px);
    paintPixelRows(ctx, rows, ownerColor, px);
    return spriteTexture(c);
  }
  const cells = STRUCTURES.has(type) ? STRUCTURE_CELLS : 13;
  const s = cells * px;
  const c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, s, s);
  const icon = PIXEL_ICONS[type];
  if (ghost && NUKES.has(type)) {
    const pal = rocketPalette(type);
    const cw = ROCKET[0].length;
    const ch = ROCKET.length;
    const ox = Math.floor((cells - cw) / 2);
    const oy = Math.floor((cells - ch) / 2);
    for (let r = 0; r < ch; r++) {
      for (let col = 0; col < cw; col++) {
        const pix = ROCKET[r][col];
        if (pix === ".") continue;
        ctx.fillStyle = pal[pix] ?? "#fff";
        ctx.fillRect((ox + col) * px, (oy + r) * px, px, px);
      }
    }
  } else if (type === UnitType.Train) {
    paintIcon(ctx, icon, 2 * px, 2 * px, px, { "+": ownerColor }, "rgba(0,0,0,0.9)");
  } else if (STRUCTURES.has(type)) {
    paintStructureMark(ctx, type, ownerColor, cells, px, { level, ghost, constructing });
  } else {
    paintIcon(ctx, icon, 2 * px, 2 * px, px, { "#": ownerColor, "+": shade(ownerColor, 0.45) }, "rgba(0,0,0,0.6)");
  }
  const tex = spriteTexture(c);
  if (STRUCTURES.has(type)) {
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
  }
  return tex;
}

const TRAIN_PNG = import.meta.glob("../assets/sprites/*.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

function trainPngUrl(file: string): string {
  const hit = Object.entries(TRAIN_PNG).find(([k]) => k.endsWith(file));
  return hit?.[1] ?? "";
}

const trainBmp: Record<"engine" | "carriage" | "loaded" | "transport" | "trade" | "warship", HTMLImageElement | null> = { engine: null, carriage: null, loaded: null, transport: null, trade: null, warship: null };
const trainReadyWait: Array<() => void> = [];
let trainSpritesReady = false;

export function whenTrainSpritesReady(cb: () => void): void {
  if (trainSpritesReady) cb();
  else trainReadyWait.push(cb);
}

function preloadTrainSprites(): void {
  if (typeof Image === "undefined") {
    trainSpritesReady = true;
    return;
  }
  const jobs: Array<[keyof typeof trainBmp, string]> = [
    ["engine", "trainEngine.png"],
    ["carriage", "trainCarriage.png"],
    ["loaded", "trainCarriageLoaded.png"],
    ["transport", "transportship.png"],
    ["trade", "tradeship.png"],
    ["warship", "warship.png"],
  ];
  let left = jobs.length;
  const done = () => {
    left--;
    if (left > 0) return;
    trainSpritesReady = true;
    for (const cb of trainReadyWait.splice(0)) cb();
  };
  for (const [kind, file] of jobs) {
    const src = trainPngUrl(file);
    if (!src) {
      done();
      continue;
    }
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      trainBmp[kind] = img;
      done();
    };
    img.onerror = () => done();
    img.src = src;
  }
}
preloadTrainSprites();

/** OpenFront 5×5 train: plus engine, 3×3 carriage. 180 gray = owner, 70 gray = border, black = empty. */
function paintTrainPixels(ctx: CanvasRenderingContext2D, ownerColor: string, role: number, loaded: boolean, px: number): void {
  const territory = ownerColor;
  const border = shade(ownerColor, -0.55);
  const cargo = loaded ? "#d4a017" : border;
  const img = role === 2 ? (loaded ? trainBmp.loaded : trainBmp.carriage) : trainBmp.engine;
  if (img) {
    const tmp = document.createElement("canvas");
    tmp.width = 5;
    tmp.height = 5;
    const g = tmp.getContext("2d")!;
    g.drawImage(img, 0, 0);
    try {
      const data = g.getImageData(0, 0, 5, 5);
      const d = data.data;
      const parse = (c: string) => {
        const m = c.startsWith("#")
          ? [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]
          : (c.match(/\d+/g) ?? ["128", "128", "128"]).slice(0, 3).map(Number);
        return m as number[];
      };
      const T = parse(territory);
      const B = parse(border);
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 16 || d[i] + d[i + 1] + d[i + 2] < 24) {
          d[i + 3] = 0;
          continue;
        }
        const src = d[i] >= 150 ? T : d[i] >= 90 ? T : B;
        d[i] = src[0];
        d[i + 1] = src[1];
        d[i + 2] = src[2];
        d[i + 3] = 255;
      }
      g.putImageData(data, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tmp, 0, 0, 5 * px, 5 * px);
      return;
    } catch {
      /* fall through to the baked plus / square */
    }
  }
  const rows = role === 2 ? [".....", ".###.", ".#+#.", ".###.", "....."] : [".....", "..#..", ".###.", "..#..", "....."];
  const pal: Record<string, string> = { "#": role === 2 ? territory : border, "+": cargo };
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const ch = rows[r][c];
      if (ch === ".") continue;
      ctx.fillStyle = pal[ch] ?? territory;
      ctx.fillRect(c * px, r * px, px, px);
    }
  }
}

function makeStructurePixels(type: UnitType, ownerColor: string, level = 1, constructing = false, ghost: "valid" | "invalid" | null = null): THREE.Texture {
  const px = 2;
  const cells = STRUCTURE_CELLS;
  const s = cells * px;
  const c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, s, s);
  // Plane +Y points up; CanvasTexture already converts the canvas Y direction.
  paintStructureMark(ctx, type, ownerColor, cells, px, { level, ghost, constructing });
  const tex = pixelTexture(c);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

function makeTrainSprite(ownerColor: string, role: number, loaded: boolean): THREE.Texture {
  const px = 4;
  const s = 5 * px;
  const c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, s, s);
  paintTrainPixels(ctx, ownerColor, role, loaded, px);
  return spriteTexture(c);
}

/** OpenFront silhouettes, recolored to the owner's territory and border palette. */
function makeShipPixels(type: UnitType, ownerColor: string, _skiff = false): THREE.Texture {
  const img = type === UnitType.Warship ? trainBmp.warship : type === UnitType.TradeShip ? trainBmp.trade : trainBmp.transport;
  const c = document.createElement("canvas");
  c.width = c.height = type === UnitType.Warship ? 11 : 5;
  const ctx = c.getContext("2d")!;
  if (img) {
    ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(0, 0, c.width, c.height);
    const palette = document.createElement("canvas").getContext("2d")!;
    const rgb = (color: string) => { palette.clearRect(0,0,1,1); palette.fillStyle = color; palette.fillRect(0,0,1,1); return palette.getImageData(0,0,1,1).data; };
    const body = rgb(ownerColor), border = rgb(shade(ownerColor, -0.55));
    const d = pixels.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i+3] < 16 || d[i]+d[i+1]+d[i+2] < 24) { d[i+3] = 0; continue; }
      const color = d[i] >= 150 || (d[i] >= 90 && d[i] < 115) ? body : border;
      d[i] = color[0]; d[i+1] = color[1]; d[i+2] = color[2];
    }
    ctx.putImageData(pixels, 0, 0);
  } else {
    ctx.fillStyle = ownerColor;
    ctx.fillRect(1,1,c.width-2,c.height-2);
  }
  return pixelTexture(c);
}

function makeTrainPixels(ownerColor: string, role: number, loaded: boolean): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 5;
  c.height = 5;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 5, 5);
  paintTrainPixels(ctx, ownerColor, role, loaded, 1);
  return pixelTexture(c);
}

function makePip(color: string, city = false, level = 1): THREE.Texture {
  const px = 4;
  const cells = 8;
  const s = cells * px;
  const c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  const ctx = c.getContext("2d")!;
  const cx = 3.5;
  const cy = 3.5;
  const r = city ? 3.3 : 2.7;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > r + 0.55) continue;
      ctx.fillStyle = d > r ? "#000" : color;
      ctx.fillRect(x * px, y * px, px, px);
    }
  }
  if (level > 1) {
    ctx.fillStyle = "#000";
    ctx.fillRect(4 * px, 0, 4 * px, 4 * px);
    ctx.fillStyle = "#ffe566";
    ctx.fillRect(5 * px, 1 * px, 2 * px, 2 * px);
  }
  return spriteTexture(c);
}

function dashedRingTexture(color: string, dashes: number): THREE.Texture {
  const s = 128;
  const c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  const ctx = c.getContext("2d")!;
  ctx.strokeStyle = color;
  ctx.lineWidth = 9;
  ctx.setLineDash([(Math.PI * (s - 12)) / dashes / 2, (Math.PI * (s - 12)) / dashes / 2]);
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s / 2 - 6, 0, Math.PI * 2);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface Effect {
  mesh: THREE.Mesh;
  born: number;
  life: number;
  from: number;
  to: number;
  fade: boolean;
}

/** Sprites for structures and missiles; ships/trains are map-pixel meshes. */
export class UnitLayer {
  private rails: RailLayer;
  private sprites = new Map<Unit, THREE.Sprite>();
  private pixels = new Map<Unit, THREE.Mesh>();
  private materials = new Map<string, THREE.SpriteMaterial>();
  private pixelMats = new Map<string, THREE.MeshBasicMaterial>();
  private pixelGeo = new THREE.PlaneGeometry(1, 1);
  private walkMeshes: THREE.Mesh[] = [];
  private walkMats = new Map<string, THREE.MeshBasicMaterial>();
  private effects: Effect[] = [];
  private tmp = new THREE.Vector3();
  private camN = new THREE.Vector3();
  private overview: StructureOverview | null = null;
  private lastUnitTick = -1;
  private lastViewportHeight = -1;
  private lastViewportWidth = -1;
  private lastCamQuaternion = new THREE.Quaternion();
  private lastCamX = Infinity;
  private lastCamY = 0;
  private lastCamZ = 0;
  private structDirty = true;
  private stacks = new Map<number, Unit[]>();
  private ndc = new THREE.Vector3();
  private east = new THREE.Vector3();
  private north = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private viewVel = new THREE.Vector3();
  private tail = new THREE.Vector3();
  private rangeMat = new THREE.Matrix4();
  private ghost: THREE.Sprite | null = null;
  private ghostDecal: THREE.Mesh | null = null;
  private ghostType: UnitType | null = null;
  private ghostRange: THREE.Mesh | null = null;
  private ghostRangeFill: THREE.Mesh | null = null;
  private ghostKey = "";
  private targetRings = new Map<Unit, THREE.Mesh>();
  private ringTex = dashedRingTexture("#ff3b30", 6);
  private ringTexOuter = dashedRingTexture("#ff3b30", 2);
  private trails = new Map<Unit, FatArc>();
  private rocketPrev = new Map<Unit, THREE.Vector3>();
  private aimArc: FatArc | null = null;
  private arcBuf = new Float32Array(BALLISTIC_SAMPLES * 3);
  private trailBuf = new Float32Array(BALLISTIC_SAMPLES * 3);
  private lineRes = new THREE.Vector2();
  private lastLineW = 0;
  private lastLineH = 0;
  /** world units per tile (at the equator; tiles are square in the y direction everywhere) */
  readonly tileWorld: number;

  constructor(
    private globe: GlobeRenderer,
    private game: Game,
  ) {
    this.rails = new RailLayer(globe, game);
    this.tileWorld = (2 * Math.PI * GLOBE_RADIUS) / game.map.width;
    game.onUnitAdded = (u) => this.add(u);
    game.onUnitRemoved = (u) => this.remove(u);
    game.onConstructionComplete = () => {
      this.structDirty = true;
    };
    game.onNukeDetonated = (tile, type) => this.explosion(tile, type);
    game.onSamIntercept = (samTile, missileTile) => {
      this.ping(samTile, "#7ec8ff", 20);
      this.ping(missileTile, "#ffe566", 8);
    };
    for (const u of game.units) this.add(u);
    whenHudGlyphsReady(() => this.rebuildLooks());
    whenTrainSpritesReady(() => this.rebuildLooks());
  }

  /** Cache each player's initial building/vehicle textures before revealing the world. */
  async warmAssets(yieldWork: () => Promise<void>): Promise<void> {
    let representative: THREE.Material | null = null;
    for (const player of this.game.allPlayers()) {
      for (const type of [...STRUCTURES, ...SHIPS, UnitType.Train]) {
        const unit = new Unit(type, player, 0);
        for (const constructing of unit.isStructure() ? [false, true] : [false]) {
          unit.constructing = constructing;
          const material = this.pixelMaterial(unit);
          if (material.map) this.globe.renderer.initTexture(material.map);
          representative = material;
        }
      }
      await yieldWork();
    }
    if (representative) {
      const mesh = new THREE.Mesh(this.pixelGeo, representative);
      this.globe.unitGroup.add(mesh);
      try { await this.globe.renderer.compileAsync(this.globe.scene, this.globe.camera); }
      finally { this.globe.unitGroup.remove(mesh); }
    }
  }

  private rebuildLooks(): void {
    for (const m of [...this.materials.values(), ...this.pixelMats.values()]) { m.map?.dispose(); m.dispose(); }
    this.materials.clear();
    this.pixelMats.clear();
    for (const [u, s] of this.sprites) {
      if (!u.active) continue;
      if (u.isStructure() || SHIPS.has(u.type)) s.material = this.material(u, false);
    }
    for (const [u, mesh] of this.pixels) {
      if (!u.active) continue;
      const mat = this.pixelMaterial(u);
      this.bindPixelMap(mesh, mat, u.type);
    }
    this.structDirty = true;
  }

  private material(u: Unit, pip: boolean): THREE.SpriteMaterial {
    const train = u.type === UnitType.Train;
    const ship = SHIPS.has(u.type);
    const skiff = ship && u.type === UnitType.TradeShip && u.health === 2;
    const key = train
      ? `train|${u.owner.color}|${u.troops}|${u.loaded ? "g" : ""}`
      : ship
        ? `ship|${u.type}|${u.owner.color}|${skiff ? "k" : ""}`
        : `${u.type}|${u.owner.color}|${u.constructing ? "c" : ""}|${pip ? "p" : ""}|${u.level}`;
    let m = this.materials.get(key);
    if (!m) {
      const nuke = NUKES.has(u.type);
      m = new THREE.SpriteMaterial({
        map: train
          ? makeTrainSprite(u.owner.color, u.troops, u.loaded)
          : pip
            ? makePip(u.owner.color, u.type === UnitType.City, u.level)
            : makeSprite(u.type, u.owner.color, null, u.level, skiff, u.constructing),
        depthTest: !nuke,
        depthWrite: false,
        transparent: true,
        opacity: u.constructing ? 0.45 : 1,
        sizeAttenuation: true,
        rotation: 0,
      });
      this.materials.set(key, m);
    }
    return m;
  }

  private isPixelToken(u: Unit): boolean {
    return SHIPS.has(u.type) || u.type === UnitType.Train || u.isStructure();
  }

  private pixelMaterial(u: Unit): THREE.MeshBasicMaterial {
    const skiff = u.type === UnitType.TradeShip && u.health === 2;
    const key = u.isStructure()
      ? `st|${u.type}|${u.owner.color}|${u.constructing ? "c" : ""}|${u.level}`
      : u.type === UnitType.Train
        ? `train|${u.owner.color}|${u.troops}|${u.loaded ? "g" : ""}`
        : `ship|${u.type}|${u.owner.color}|${skiff ? "k" : ""}`;
    let m = this.pixelMats.get(key);
    if (!m) {
      const map = u.isStructure()
        ? makeStructurePixels(u.type, u.owner.color, u.level, u.constructing)
        : u.type === UnitType.Train
          ? makeTrainPixels(u.owner.color, u.troops, u.loaded)
          : makeShipPixels(u.type, u.owner.color, skiff);
      m = new THREE.MeshBasicMaterial({
        map,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        // Front only — DoubleSide + no depth test drew the mirrored back face on top.
        side: u.isStructure() ? THREE.FrontSide : THREE.DoubleSide,
        opacity: 1,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      this.pixelMats.set(key, m);
    }
    return m;
  }

  private bindPixelMap(mesh: THREE.Mesh, mat: THREE.MeshBasicMaterial, type: UnitType): void {
    mesh.material = mat;
    const img = mat.map?.image as HTMLCanvasElement | undefined;
    const w = img?.width ?? 5;
    const h = img?.height ?? 5;
    mesh.userData.pw = w;
    mesh.userData.ph = h;
    if (type === UnitType.Train) {
      mesh.userData.spanX = 5;
      mesh.userData.spanY = 5;
    } else if (type === UnitType.Warship) {
      mesh.userData.spanX = 11;
      mesh.userData.spanY = 11;
    } else if (STRUCTURES.has(type)) {
      const span = this.ghostSpan(type);
      mesh.userData.spanX = span;
      mesh.userData.spanY = span;
    } else {
      mesh.userData.spanX = 5;
      mesh.userData.spanY = 5;
    }
  }

  private add(u: Unit): void {
    this.structDirty = true;
    if (this.isPixelToken(u)) {
      const mesh = new THREE.Mesh(this.pixelGeo, this.pixelMaterial(u));
      this.bindPixelMap(mesh, mesh.material as THREE.MeshBasicMaterial, u.type);
      mesh.renderOrder = u.isStructure() ? 12 : u.type === UnitType.Train ? 8 : 7;
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      this.pixels.set(u, mesh);
      this.globe.unitGroup.add(mesh);
      this.placePixel(u, mesh);
      return;
    }
    const nuke = NUKES.has(u.type);
    const projectile = u.type === UnitType.Shell || u.type === UnitType.SAMMissile;
    const mat = nuke
      ? new THREE.SpriteMaterial({
          map: makeRocket(u.type),
          depthTest: false,
          depthWrite: false,
          transparent: true,
          sizeAttenuation: true,
          rotation: 0,
        })
      : this.material(u, false);
    const s = new THREE.Sprite(mat);
    s.center.set(0.5, 0.5);
    s.renderOrder = nuke || projectile ? 30 : 12;
    this.sprites.set(u, s);
    this.globe.unitGroup.add(s);
    this.place(u, s);
    this.structDirty = true;
  }

  private remove(u: Unit): void {
    this.structDirty = true;
    const p = this.pixels.get(u);
    if (p) {
      this.globe.unitGroup.remove(p);
      this.pixels.delete(u);
    }
    const s = this.sprites.get(u);
    if (s) {
      this.globe.unitGroup.remove(s);
      this.sprites.delete(u);
      this.structDirty = true;
    }
    const r = this.targetRings.get(u);
    if (r) {
      this.globe.unitGroup.remove(r);
      this.targetRings.delete(u);
    }
    const tr = this.trails.get(u);
    if (tr) {
      this.disposeFat(tr);
      this.trails.delete(u);
    }
    this.rocketPrev.delete(u);
  }

  private place(u: Unit, s: THREE.Sprite): void {
    const map = this.game.map;
    let lat: number, lon: number;
    if (u.isMovable() && u.fx >= 0) {
      lon = (u.fx / map.width) * 360 - 180;
      lat = 90 - (u.fy / map.height) * 180;
    } else {
      ({ lat, lon } = map.tileToLatLon(u.tile));
    }
    const alt = NUKES.has(u.type) || u.type === UnitType.SAMMissile ? Math.max(1.2, u.alt || 4) : u.type === UnitType.Shell ? 1.6 : 0.8;
    latLonToVec3(lat, lon, GLOBE_RADIUS + alt, this.tmp);
    s.position.copy(this.tmp);
  }

  /** Sit a ship/train on the globe: each texture pixel is one map tile, heading in the tangent plane. */
  private placePixel(u: Unit, mesh: THREE.Mesh): void {
    if (u.isStructure()) {
      const span = this.spriteTiles(u);
      mesh.userData.spanX = span;
      mesh.userData.spanY = span;
    }
    const map = this.game.map;
    const fx = u.fx >= 0 ? u.fx : map.x(u.tile) + 0.5;
    const fy = u.fy >= 0 ? u.fy : map.y(u.tile) + 0.5;
    this.sitOnGlobe(mesh, fx, fy, u.isStructure() || u.type === UnitType.Train ? 0 : u.heading, u.isStructure() || u.type === UnitType.Train);
  }

  private sitOnGlobe(mesh: THREE.Mesh, fx: number, fy: number, heading = 0, upright = false): void {
    const map = this.game.map;
    const lon = (fx / map.width) * 360 - 180;
    const lat = 90 - (fy / map.height) * 180;
    latLonToVec3(lat, lon, GLOBE_RADIUS + 0.04, this.tmp);
    mesh.position.copy(this.tmp);
    this.tmp.normalize();
    if (upright) {
      // Use the view basis, not geographic north. North reverses on the
      // far side of a visible pole and turned placed glyphs upside down.
      this.rangeMat.makeRotationFromQuaternion(this.globe.camera.quaternion);
    } else {
      this.east.set(0, 1, 0).cross(this.tmp);
      if (this.east.lengthSq() < 1e-8) this.east.set(1, 0, 0).cross(this.tmp);
      this.east.normalize();
      this.north.copy(this.tmp).cross(this.east).normalize();
      const sh = Math.sin(heading);
      const ch = Math.cos(heading);
      this.vel.copy(this.east).multiplyScalar(sh).addScaledVector(this.north, ch);
      this.viewVel.copy(this.east).multiplyScalar(ch).addScaledVector(this.north, -sh);
      this.rangeMat.makeBasis(this.viewVel, this.vel, this.tmp);
    }
    mesh.quaternion.setFromRotationMatrix(this.rangeMat);
    const spanX = (mesh.userData.spanX as number) || 1;
    const spanY = (mesh.userData.spanY as number) || 1;
    mesh.scale.set(spanX * this.tileWorld, spanY * this.tileWorld, 1);
    if (!mesh.matrixAutoUpdate) mesh.updateMatrix();
  }

  private walkMat(color: string): THREE.MeshBasicMaterial {
    let m = this.walkMats.get(color);
    if (!m) {
      const c = document.createElement("canvas");
      c.width = 1;
      c.height = 1;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      m = new THREE.MeshBasicMaterial({
        map: pixelTexture(c),
        transparent: true,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      });
      this.walkMats.set(color, m);
    }
    return m;
  }

  /** Far-attack troops: one map-grid pixel walking country borders. */
  private syncWalkers(): void {
    const list = this.game.borderWalkers;
    while (this.walkMeshes.length < list.length) {
      const mesh = new THREE.Mesh(this.pixelGeo, this.walkMat("#fff"));
      mesh.userData.spanX = 1;
      mesh.userData.spanY = 1;
      mesh.renderOrder = 9;
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      this.globe.unitGroup.add(mesh);
      this.walkMeshes.push(mesh);
    }
    for (let i = 0; i < list.length; i++) {
      const w = list[i];
      const mesh = this.walkMeshes[i];
      const mat = this.walkMat(w.owner.color);
      if (mesh.material !== mat) mesh.material = mat;
      const moved = mesh.userData.fx !== w.fx || mesh.userData.fy !== w.fy || mesh.userData.hd !== w.heading;
      if (moved) {
        mesh.userData.fx = w.fx;
        mesh.userData.fy = w.fy;
        mesh.userData.hd = w.heading;
        this.sitOnGlobe(mesh, w.fx, w.fy, w.heading);
      }
      mesh.visible = this.facingCam(mesh.position);
    }
    for (let i = list.length; i < this.walkMeshes.length; i++) this.walkMeshes[i].visible = false;
  }

  private surfaceMesh(geo: THREE.BufferGeometry, mat: THREE.Material, tile: number, alt = 1.2): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, mat);
    const pos = this.globe.tileToWorld(tile, alt);
    mesh.position.copy(pos);
    mesh.lookAt(pos.clone().multiplyScalar(2));
    mesh.renderOrder = 5;
    return mesh;
  }

  /** expanding ring where the player clicked */
  ping(tile: number, color: string, tiles = 6): void {
    const geo = new THREE.RingGeometry(0.8, 1, 40);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false });
    const mesh = this.surfaceMesh(geo, mat, tile);
    this.globe.unitGroup.add(mesh);
    this.effects.push({ mesh, born: performance.now(), life: 650, from: 0.5, to: tiles * this.tileWorld, fade: true });
  }

  /** nuke blast: flash + expanding ring */
  private explosion(tile: number, type: UnitType): void {
    const big = type === UnitType.HydrogenBomb;
    const { outer } = this.game.config.nukeMagnitude(type);
    const ring = this.surfaceMesh(
      new THREE.RingGeometry(0.75, 1, 48),
      new THREE.MeshBasicMaterial({ color: big ? 0xff5060 : 0xffb347, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false }),
      tile,
      1.5,
    );
    const flash = this.surfaceMesh(
      new THREE.CircleGeometry(1, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
      tile,
      1.4,
    );
    this.globe.unitGroup.add(ring, flash);
    const now = performance.now();
    this.effects.push({ mesh: ring, born: now, life: big ? 2200 : 1400, from: 1, to: outer * this.tileWorld, fade: true });
    this.effects.push({ mesh: flash, born: now, life: 500, from: outer * this.tileWorld * 0.6, to: outer * this.tileWorld * 0.2, fade: true });
  }

  /** world size in tiles — icons lock to the map so zoom-in makes them bigger pixels */
  private spriteTiles(u: Unit): number {
    if (u.isStructure()) return (60 / 7) * structureShape(u.type).scale;
    if (u.type === UnitType.TradeShip) return 1;
    if (u.type === UnitType.TransportShip) return 1;
    if (u.type === UnitType.Warship) return 3;
    if (u.type === UnitType.Train) return 5;
    if (u.type === UnitType.Shell) return 0.7;
    if (u.type === UnitType.SAMMissile) return 1.8;
    if (NUKES.has(u.type)) return u.type === UnitType.MIRVWarhead ? 2.6 : 3.2;
    if (u.type === UnitType.DefensePost || u.type === UnitType.Radar) return 5.2;
    if (u.type === UnitType.Port) return 6.4;
    if (u.type === UnitType.Factory) return 6.6;
    if (u.type === UnitType.MissileSilo) return 7.4;
    if (u.type === UnitType.SAMLauncher) return 6.8;
    return 6.2;
  }

  private ghostSpan(type: UnitType): number {
    if (STRUCTURES.has(type)) return (60 / 7) * structureShape(type).scale;
    if (type === UnitType.City) return 7.2;
    if (type === UnitType.DefensePost || type === UnitType.Radar) return 5.2;
    if (type === UnitType.Port) return 6.4;
    if (type === UnitType.Factory) return 6.6;
    if (type === UnitType.MissileSilo) return 7.4;
    if (type === UnitType.SAMLauncher) return 6.8;
    if (NUKES.has(type)) return type === UnitType.MIRVWarhead ? 2.6 : 3.2;
    if (type === UnitType.Warship) return 11;
    return 6.2;
  }

  /** hide clutter when zoomed out; keep landmarks, boats and missiles readable */
  private lodVisible(u: Unit, altitude: number, human: Player | null): boolean {
    const own = !!human && u.owner === human;
    if (NUKES.has(u.type) || SHIPS.has(u.type) || u.type === UnitType.Train || u.type === UnitType.Shell || u.type === UnitType.SAMMissile) return true;
    if (altitude > 160) {
      if (u.type === UnitType.DefensePost || u.type === UnitType.Radar) return own;
      return u.isStructure();
    }
    if (altitude > 80) {
      if (u.type === UnitType.DefensePost || u.type === UnitType.Radar) return own;
      return true;
    }
    return true;
  }

  /** pile structures that share a tile so each icon is visible */
  private applyStackOffset(u: Unit, s: THREE.Object3D, stack: Unit[]): void {
    const i = stack.indexOf(u);
    if (i <= 0 || stack.length < 2) return;
    this.tmp.copy(s.position).normalize();
    this.east.set(0, 1, 0).cross(this.tmp);
    if (this.east.lengthSq() < 1e-8) this.east.set(1, 0, 0).cross(this.tmp);
    this.east.normalize();
    this.north.copy(this.tmp).cross(this.east).normalize();
    const step = this.tileWorld * 2.4;
    const col = i % 2;
    const row = Math.floor(i / 2);
    s.position.addScaledVector(this.east, (col - 0.35) * step);
    s.position.addScaledVector(this.north, row * step);
    s.renderOrder = 6 + i;
    if (!s.matrixAutoUpdate) s.updateMatrix();
  }

  private ghostInner: THREE.Mesh | null = null;

  /** Bend each range vertex onto the globe, below building icons. */
  private placeRangeDisc(object: THREE.Object3D, tile: number, rangeTiles: number, _alt = 0): void {
    const mesh = object as THREE.Mesh;
    const geometry = mesh.geometry;
    const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
    const original: Float32Array = geometry.userData.discCoordinates ??= new Float32Array(positions.array);
    this.tmp.copy(this.globe.tileToWorld(tile)).normalize();
    this.east.set(0,1,0).cross(this.tmp);
    if(this.east.lengthSq()<1e-8)this.east.set(1,0,0).cross(this.tmp);
    this.east.normalize();this.north.copy(this.tmp).cross(this.east).normalize();
    const angle=rangeTiles*this.tileWorld/GLOBE_RADIUS, radius=GLOBE_RADIUS+.015;
    for(let i=0;i<positions.count;i++){
      const x=original[i*3],y=original[i*3+1],r=Math.hypot(x,y);
      this.vel.copy(this.tmp).multiplyScalar(Math.cos(angle*r));
      if(r>0)this.vel.addScaledVector(this.east,Math.sin(angle*r)*x/r).addScaledVector(this.north,Math.sin(angle*r)*y/r);
      positions.setXYZ(i,this.vel.x*radius,this.vel.y*radius,this.vel.z*radius);
    }
    positions.needsUpdate=true;geometry.computeBoundingSphere();
    mesh.position.set(0,0,0);mesh.quaternion.identity();mesh.scale.set(1,1,1);
    (mesh.material as THREE.MeshBasicMaterial).depthTest=true;
  }

  /** build-mode ghost following the cursor; tile -1 hides it */
  setGhost(
    type: UnitType | null,
    tile: number,
    valid: boolean,
    rangeTiles = 0,
    innerTiles = 0,
    rangeColor = 0xffffff,
    innerColor = 0xff453a,
    _worldPoint: THREE.Vector3 | null = null,
    ownerColor = "#fff",
  ): void {
    if (!type || tile < 0) {
      if (this.ghost) this.ghost.visible = false;
      if (this.ghostDecal) this.ghostDecal.visible = false;
      if (this.ghostRange) this.ghostRange.visible = false;
      if (this.ghostRangeFill) this.ghostRangeFill.visible = false;
      if (this.ghostInner) this.ghostInner.visible = false;
      this.ghostType = null;
      this.hideAim();
      return;
    }
    this.ghostType = type;
    if (innerTiles > 0) {
      if (!this.ghostInner) {
        this.ghostInner = new THREE.Mesh(
          new THREE.RingGeometry(0.94, 1, 64),
          new THREE.MeshBasicMaterial({ color: innerColor, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
        );
        this.ghostInner.renderOrder = 6;
        this.globe.unitGroup.add(this.ghostInner);
      }
      (this.ghostInner.material as THREE.MeshBasicMaterial).color.set(valid ? innerColor : 0xff5a5f);
      this.placeRangeDisc(this.ghostInner, tile, innerTiles);
      this.ghostInner.visible = true;
    } else if (this.ghostInner) {
      this.ghostInner.visible = false;
    }
    const key = `${type}|${valid}|${ownerColor}`;
    const decal = STRUCTURES.has(type) || SHIPS.has(type);
    if (decal) {
      if (this.ghost) this.ghost.visible = false;
      if (!this.ghostDecal) {
        this.ghostDecal = new THREE.Mesh(
          this.pixelGeo,
          new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, depthTest: false, side: THREE.FrontSide, opacity: 0.88 }),
        );
        this.ghostDecal.renderOrder = 11;
        this.ghostDecal.matrixAutoUpdate = false;
        this.ghostDecal.frustumCulled = false;
        this.globe.unitGroup.add(this.ghostDecal);
      }
      if (key !== this.ghostKey) {
        this.ghostKey = key;
        const mat = this.ghostDecal.material as THREE.MeshBasicMaterial;
        mat.map?.dispose();
        mat.map = STRUCTURES.has(type)
          ? makeStructurePixels(type, ownerColor, 1, false, valid ? "valid" : "invalid")
          : makeShipPixels(type, ownerColor);
        mat.opacity = 0.88;
        mat.needsUpdate = true;
      }
      const map = this.game.map;
      const span = this.ghostSpan(type);
      this.ghostDecal.userData.spanX = span;
      this.ghostDecal.userData.spanY = span;
      this.sitOnGlobe(this.ghostDecal, map.x(tile) + 0.5, map.y(tile) + 0.5, 0, true);
      this.ghostDecal.visible = true;
    } else {
      if (this.ghostDecal) this.ghostDecal.visible = false;
      if (!this.ghost) {
        this.ghost = new THREE.Sprite();
        this.ghost.center.set(0.5, 0.5);
        this.ghost.renderOrder = 20;
        this.globe.unitGroup.add(this.ghost);
      }
      if (key !== this.ghostKey) {
        this.ghostKey = key;
        this.ghost.material = new THREE.SpriteMaterial({ map: makeSprite(type, ownerColor, valid ? "valid" : "invalid"), depthTest: false, depthWrite: false, transparent: true, opacity: 0.88 });
      }
      this.ghost.visible = true;
      this.ghost.position.copy(this.globe.tileToWorld(tile, 0.2));
    }
    this.showRangeDisc(tile, rangeTiles, valid ? rangeColor : 0xff5a5f, innerTiles, valid ? 0.2 : 0.08);
    this.setAimArc(type, tile, valid);
  }

  private missileTargets: THREE.Mesh[] = [];
  setMissileTargets(tiles: readonly number[], type: UnitType): void {
    for(const mesh of this.missileTargets){this.globe.unitGroup.remove(mesh);mesh.geometry.dispose();(mesh.material as THREE.Material).dispose();}
    this.missileTargets=[];
    for(const tile of tiles){
      const mesh=new THREE.Mesh(new THREE.RingGeometry(.97,1,96),new THREE.MeshBasicMaterial({color:0xff805f,transparent:true,opacity:.9,depthWrite:false,depthTest:true,side:THREE.DoubleSide}));
      mesh.renderOrder=6;this.placeRangeDisc(mesh,tile,this.game.config.nukeMagnitude(type).outer);this.globe.unitGroup.add(mesh);this.missileTargets.push(mesh);
    }
  }

  /** range circle for a placed SAM / radar / defense post (no build ghost) */
  setRangeOverlay(tile: number, rangeTiles: number, color = 0x7ec8ff): void {
    if (this.ghost) this.ghost.visible = false;
    if (this.ghostDecal) this.ghostDecal.visible = false;
    if (this.ghostInner) this.ghostInner.visible = false;
    this.hideAim();
    this.showRangeDisc(tile, rangeTiles, color, 0, 0.22);
  }

  private showRangeDisc(tile: number, rangeTiles: number, color: number, innerTiles = 0, fillOpacity = 0.2): void {
    if (tile < 0 || rangeTiles <= 0) {
      if (this.ghostRange) this.ghostRange.visible = false;
      if (this.ghostRangeFill) this.ghostRangeFill.visible = false;
      return;
    }
    const innerRatio = innerTiles > 0 ? Math.min(0.95, innerTiles / rangeTiles) : 0;
    const strokeInner = Math.max(0, 1 - 1.25 / Math.max(1, rangeTiles));
    if (!this.ghostRangeFill) {
      this.ghostRangeFill = new THREE.Mesh(
        innerRatio > 0 ? new THREE.RingGeometry(innerRatio, 1, 96, 12) : new THREE.RingGeometry(0, 1, 96, 12),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: fillOpacity, side: THREE.DoubleSide, depthTest: false, depthWrite: false }),
      );
      this.ghostRangeFill.renderOrder = 5;
      this.globe.unitGroup.add(this.ghostRangeFill);
      this.ghostRangeFill.userData.innerRatio = innerRatio;
    } else if (this.ghostRangeFill.userData.innerRatio !== innerRatio) {
      this.ghostRangeFill.geometry.dispose();
      this.ghostRangeFill.geometry = innerRatio > 0 ? new THREE.RingGeometry(innerRatio, 1, 96, 12) : new THREE.RingGeometry(0, 1, 96, 12);
      this.ghostRangeFill.userData.innerRatio = innerRatio;
    }
    (this.ghostRangeFill.material as THREE.MeshBasicMaterial).color.set(color);
    (this.ghostRangeFill.material as THREE.MeshBasicMaterial).opacity = fillOpacity;
    (this.ghostRangeFill.material as THREE.MeshBasicMaterial).depthTest = false;
    this.placeRangeDisc(this.ghostRangeFill, tile, rangeTiles, 1.6);
    this.ghostRangeFill.visible = true;
    if (!this.ghostRange) {
      this.ghostRange = new THREE.Mesh(
        new THREE.RingGeometry(strokeInner, 1, 96),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthTest: false, depthWrite: false }),
      );
      this.ghostRange.renderOrder = 6;
      this.globe.unitGroup.add(this.ghostRange);
      this.ghostRange.userData.strokeInner = strokeInner;
    } else if (Math.abs((this.ghostRange.userData.strokeInner ?? 0) - strokeInner) > 0.002) {
      this.ghostRange.geometry.dispose();
      this.ghostRange.geometry = new THREE.RingGeometry(strokeInner, 1, 96);
      this.ghostRange.userData.strokeInner = strokeInner;
    }
    (this.ghostRange.material as THREE.MeshBasicMaterial).color.set(color);
    (this.ghostRange.material as THREE.MeshBasicMaterial).depthTest = false;
    this.placeRangeDisc(this.ghostRange, tile, rangeTiles, 1.75);
    this.ghostRange.visible = true;
  }

  private syncTargetRings(now: number): void {
    const human = this.game.human;
    if (!human) return;
    const seen = new Set<Unit>();
    for (const u of human.unitsOf(UnitType.TransportShip)) {
      if (!u.active || u.targetTile < 0) continue;
      seen.add(u);
      let m = this.targetRings.get(u);
      if (!m) {
        const g = new THREE.Group();
        const inner = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.ringTex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
        const outer = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.MeshBasicMaterial({ map: this.ringTexOuter, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.8 }));
        g.add(inner, outer);
        const pos = this.globe.tileToWorld(u.targetTile, 1.1);
        g.position.copy(pos);
        g.lookAt(pos.clone().multiplyScalar(2));
        g.renderOrder = 6;
        m = g as unknown as THREE.Mesh;
        this.targetRings.set(u, m);
        this.globe.unitGroup.add(g);
      }
      const r = 10 * this.tileWorld;
      m.scale.set(r, r, 1);
      m.children[0].rotation.z = now * 0.0012;
      m.children[1].rotation.z = -now * 0.0006;
    }
    for (const [u, m] of this.targetRings) {
      if (!seen.has(u)) {
        this.globe.unitGroup.remove(m);
        this.targetRings.delete(u);
      }
    }
  }

  private facingCam(pos: THREE.Vector3, minFacing = 0.08): boolean {
    const d = pos.dot(this.camN);
    if (d <= GLOBE_RADIUS * GLOBE_RADIUS / this.globe.camera.position.length()) return false;
    return d * d >= minFacing * minFacing * pos.lengthSq();
  }

  private inView(pos: THREE.Vector3, pad = 1.25, minFacing = 0.12): boolean {
    if (!this.facingCam(pos, minFacing)) return false;
    this.ndc.copy(pos).project(this.globe.camera);
    return this.ndc.z <= 1 && this.ndc.x >= -pad && this.ndc.x <= pad && this.ndc.y >= -pad && this.ndc.y <= pad;
  }

  update(): void {
    this.rails.update();
    this.syncLineRes();
    const altitude = Math.max(1, this.globe.cameraDistance() - GLOBE_RADIUS);
    const pxPerUnit = this.globe.canvas.clientHeight / 2 / (altitude * Math.tan((this.globe.camera.fov * Math.PI) / 360));
    this.camN.copy(this.globe.camera.position).normalize();
    const human = this.game.human;
    const cam = this.globe.camera;
    const camMoved =
      !cam.quaternion.equals(this.lastCamQuaternion) ||
      this.lastViewportHeight !== this.globe.canvas.clientHeight ||
      this.lastViewportWidth !== this.globe.canvas.clientWidth ||
      Math.abs(cam.position.x - this.lastCamX) > 0.04 ||
      Math.abs(cam.position.y - this.lastCamY) > 0.04 ||
      Math.abs(cam.position.z - this.lastCamZ) > 0.04;
    const unitsChanged = this.lastUnitTick !== this.game.ticks || this.structDirty;
    this.lastUnitTick = this.game.ticks;
    this.lastViewportHeight = this.globe.canvas.clientHeight;
    this.lastViewportWidth = this.globe.canvas.clientWidth;
    this.lastCamQuaternion.copy(cam.quaternion);
    const rebuild = this.structDirty;
    this.structDirty = false;
    this.lastCamX = cam.position.x;
    this.lastCamY = cam.position.y;
    this.lastCamZ = cam.position.z;

    const stacks = this.stacks;
    if (rebuild) {
      stacks.clear();
      for (const [u] of this.pixels) {
        if (!u.active || !u.isStructure()) continue;
        let list = stacks.get(u.tile);
        if (!list) stacks.set(u.tile, (list = []));
        list.push(u);
      }
      for (const list of stacks.values()) list.sort((a, b) => a.id - b.id);
    }

    // Unit state changes at simulation frequency; camera changes still update immediately.
    // Keep effects and target-ring animations running every frame below.
    if (unitsChanged || camMoved) for (const [u, mesh] of this.pixels) {
      if (!u.active) {
        this.remove(u);
        continue;
      }
      const structure = u.isStructure();
      const train = u.type === UnitType.Train;
      const src = this.pixelMaterial(u);
      if (mesh.material !== src) this.bindPixelMap(mesh, src, u.type);
      const map = this.game.map;
      const fx = u.fx >= 0 ? u.fx : map.x(u.tile) + 0.5;
      const fy = u.fy >= 0 ? u.fy : map.y(u.tile) + 0.5;
      const heading = structure || train ? 0 : u.heading;
      const moved = mesh.userData.fx !== fx || mesh.userData.fy !== fy || mesh.userData.hd !== heading;
      const needPlace = moved || rebuild || (camMoved && (structure || train));
      if (needPlace) {
        mesh.userData.fx = fx;
        mesh.userData.fy = fy;
        mesh.userData.hd = heading;
        this.placePixel(u, mesh);
        if (structure) this.applyStackOffset(u, mesh, stacks.get(u.tile) ?? [u]);
      }
      mesh.visible = (structure ? this.lodVisible(u, altitude, human) : true) && this.facingCam(mesh.position);
    }

    if (unitsChanged || camMoved) {
      this.overview ??= new StructureOverview(this.globe.unitGroup);
      this.overview.update(this.pixels, cam, this.globe.canvas.clientWidth, this.globe.canvas.clientHeight, pxPerUnit);
    }

    const touchStruct = rebuild || camMoved;
    if (unitsChanged || camMoved) for (const [u, s] of this.sprites) {
      if (!u.active) {
        this.remove(u);
        continue;
      }
      const nuke = NUKES.has(u.type) || u.type === UnitType.SAMMissile || u.type === UnitType.Shell;
      const structure = u.isStructure();
      if (!touchStruct && structure && !nuke) continue;

      if (u.isMovable() || (structure && rebuild)) this.place(u, s);
      if (structure && rebuild) this.applyStackOffset(u, s, stacks.get(u.tile) ?? [u]);
      if (nuke) this.updateTrail(u);

      if (!this.inView(s.position, nuke ? 1.35 : 1.2, nuke ? 0.02 : 0.12)) {
        s.visible = false;
        if (!nuke) this.hideTrail(u);
        continue;
      }
      if (!this.lodVisible(u, altitude, human)) {
        s.visible = false;
        if (!nuke) this.hideTrail(u);
        continue;
      }

      const pip = !nuke && structure && altitude > 70;
      if (!nuke) {
        const m = this.material(u, pip);
        if (s.material !== m) s.material = m;
      }

      let world = this.tileWorld * this.spriteTiles(u);
      let px = world * pxPerUnit;
      const minPx = nuke ? 16 : pip ? (u.type === UnitType.City ? 14 : 10) : u.type === UnitType.City ? 18 : 16;
      const maxPx = nuke ? 22 : 60;
      if (px < minPx) world = minPx / Math.max(0.001, pxPerUnit);
      px = world * pxPerUnit;
      if (px > maxPx) world = maxPx / pxPerUnit;
      s.visible = true;
      if (nuke) {
        s.scale.set(world * 0.72, world * 1.15, 1);
        this.orientRocket(u, s);
      } else {
        s.scale.set(world, world, 1);
      }
    }
    if (this.ghostDecal?.visible && camMoved) {
      this.ghostDecal.quaternion.copy(cam.quaternion);
      this.ghostDecal.updateMatrix();
    }
    if (this.ghost?.visible && this.ghostType) {
      let gw = this.tileWorld * this.ghostSpan(this.ghostType);
      const gpx = gw * pxPerUnit;
      if (gpx < 22) gw = 22 / Math.max(0.001, pxPerUnit);
      if (gw * pxPerUnit > 64) gw = 64 / pxPerUnit;
      this.ghost.scale.set(gw, gw, 1);
    }
    const now = performance.now();
    if (unitsChanged || camMoved) this.syncWalkers();
    this.syncTargetRings(now);
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      const t = (now - e.born) / e.life;
      if (t >= 1) {
        this.globe.unitGroup.remove(e.mesh);
        this.effects.splice(i, 1);
        continue;
      }
      const ease = 1 - Math.pow(1 - t, 2);
      const r = e.from + (e.to - e.from) * ease;
      e.mesh.scale.set(r, r, 1);
      if (e.fade) (e.mesh.material as THREE.MeshBasicMaterial).opacity = 0.95 * (1 - t);
    }
  }

  private hideTrail(u: Unit): void {
    const tr = this.trails.get(u);
    if (tr) {
      tr.dark.visible = false;
      tr.bright.visible = false;
    }
  }

  private syncLineRes(): void {
    this.globe.renderer.getDrawingBufferSize(this.lineRes);
    if (this.lineRes.x === this.lastLineW && this.lineRes.y === this.lastLineH) return;
    this.lastLineW = this.lineRes.x;
    this.lastLineH = this.lineRes.y;
    if (this.aimArc) {
      this.aimArc.outline.resolution.copy(this.lineRes);
      this.aimArc.core.resolution.copy(this.lineRes);
    }
    for (const arc of this.trails.values()) {
      arc.outline.resolution.copy(this.lineRes);
      arc.core.resolution.copy(this.lineRes);
    }
  }

  private makeFatArc(color: number, width: number, positions: Float32Array, order: number): FatArc {
    const geo = new LineGeometry();
    geo.setPositions(positions);
    const outline = new LineMaterial({
      color: 0x1a1208,
      linewidth: width + 4,
      worldUnits: false,
      transparent: true,
      opacity: 0.35,
      depthTest: false,
      depthWrite: false,
    });
    const core = new LineMaterial({
      color,
      linewidth: width,
      worldUnits: false,
      transparent: true,
      opacity: 0.55,
      depthTest: false,
      depthWrite: false,
    });
    outline.resolution.copy(this.lineRes);
    core.resolution.copy(this.lineRes);
    const dark = new Line2(geo, outline);
    const bright = new Line2(geo, core);
    dark.frustumCulled = false;
    bright.frustumCulled = false;
    dark.renderOrder = order;
    bright.renderOrder = order + 1;
    this.globe.unitGroup.add(dark, bright);
    return { geo, dark, bright, outline, core };
  }

  private writeFat(arc: FatArc, positions: Float32Array): void {
    const start = arc.geo.getAttribute("instanceStart") as THREE.InterleavedBufferAttribute | undefined;
    const segs = (positions.length / 3) - 1;
    if (!start || start.count !== segs) {
      arc.geo.setPositions(positions);
      return;
    }
    const array = start.data.array as Float32Array;
    for (let i = 0; i < segs; i++) {
      const i3 = i * 3;
      const j = i * 6;
      array[j] = positions[i3];
      array[j + 1] = positions[i3 + 1];
      array[j + 2] = positions[i3 + 2];
      array[j + 3] = positions[i3 + 3];
      array[j + 4] = positions[i3 + 4];
      array[j + 5] = positions[i3 + 5];
    }
    start.data.needsUpdate = true;
  }

  private disposeFat(arc: FatArc): void {
    this.globe.unitGroup.remove(arc.dark, arc.bright);
    arc.geo.dispose();
    arc.outline.dispose();
    arc.core.dispose();
  }

  private nukeColor(type: UnitType): number {
    return type === UnitType.HydrogenBomb ? 0xff6b4a : type === UnitType.MIRV || type === UnitType.MIRVWarhead ? 0xff3d9a : 0xffc14a;
  }

  private fillArc(from: number, to: number, peak: number, startAlt = 1.2): Float32Array {
    const map = this.game.map;
    const a = map.tileToLatLon(from);
    const b = map.tileToLatLon(to);
    return sampleBallisticArc(a.lat, a.lon, b.lat, b.lon, peak, this.arcBuf, startAlt, 1.2);
  }

  private hideAim(): void {
    if (this.aimArc) {
      this.aimArc.dark.visible = false;
      this.aimArc.bright.visible = false;
    }
  }

  private setAimArc(type: UnitType, tile: number, valid: boolean): void {
    if (!NUKES.has(type) || tile < 0) {
      this.hideAim();
      return;
    }
    const human = this.game.human;
    if (!human) {
      this.hideAim();
      return;
    }
    const silo = human
      .unitsOf(UnitType.MissileSilo)
      .filter((s) => s.active && !s.constructing && s.cooldownUntil <= this.game.ticks)
      .sort((a, b) => this.game.map.distSq(a.tile, tile) - this.game.map.distSq(b.tile, tile))[0];
    if (!silo) {
      this.hideAim();
      return;
    }
    const dist = this.game.map.dist(silo.tile, tile);
    const peak = this.game.config.nukeArcHeight(type, dist);
    this.fillArc(silo.tile, tile, peak, 1.2);
    if (!this.aimArc) this.aimArc = this.makeFatArc(0xffe566, 5, this.arcBuf, 29);
    else this.writeFat(this.aimArc, this.arcBuf);
    this.aimArc.core.color.set(valid ? 0xffe566 : 0xff5a5f);
    this.aimArc.dark.visible = true;
    this.aimArc.bright.visible = true;
  }

  /** point the pixel rocket's nose along its flight, in screen space */
  private orientRocket(u: Unit, s: THREE.Sprite): void {
    const prev = this.rocketPrev.get(u);
    if (!prev) {
      this.rocketPrev.set(u, s.position.clone());
      return;
    }
    this.vel.copy(s.position).sub(prev);
    if (this.vel.lengthSq() < 1e-10) return;
    this.viewVel.copy(this.vel).transformDirection(this.globe.camera.matrixWorldInverse);
    (s.material as THREE.SpriteMaterial).rotation = -Math.atan2(this.viewVel.x, this.viewVel.y);
    prev.copy(s.position);
  }

  /** trail from the silo along the flown arc, growing until impact */
  private updateTrail(u: Unit): void {
    if (u.originTile < 0 || u.targetTile < 0) return;
    const map = this.game.map;
    const a = map.tileToLatLon(u.originTile);
    const b = map.tileToLatLon(u.targetTile);
    sampleBallisticArc(a.lat, a.lon, b.lat, b.lon, u.altPeak || 12, this.trailBuf, u.altStart || 1.2, 1.2, Math.max(0.002, u.flightT));
    let arc = this.trails.get(u);
    if (!arc) {
      arc = this.makeFatArc(this.nukeColor(u.type), 6, this.trailBuf, 28);
      this.trails.set(u, arc);
    } else {
      this.writeFat(arc, this.trailBuf);
    }
    arc.dark.visible = true;
    arc.bright.visible = true;
  }
}

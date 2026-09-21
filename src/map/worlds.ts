import type { GameMap } from "../core/GameMap";
import type { WorldId } from "../core/types";
import { buildMap, detectMapSize } from "./MapBuilder";
import { buildMars, nearestColony, sampleMars } from "./mars";

export interface WorldDef {
  id: WorldId;
  name: string;
  blurb: string;
  splits: string;
}

export const WORLDS: WorldDef[] = [
  { id: "earth", name: "Earth", blurb: "Real countries. The US is split into states.", splits: "nations + US states" },
  { id: "mars", name: "Mars", blurb: "Rust colonies split across dust seas.", splits: "28 colonies" },
];

export function worldDef(id: WorldId): WorldDef {
  return WORLDS.find((w) => w.id === id) ?? WORLDS[0];
}

export interface FeaturedMatch {
  world: WorldId;
  title: string;
  tag: string;
  tags: string[];
  nations: number;
  bots: number;
  goldMultiplier: number;
  randomSpawn: boolean;
  instantBuild: boolean;
}

export const PLAYLIST: FeaturedMatch[] = [
  {
    world: "earth",
    title: "Earth",
    tag: "WORLD",
    tags: ["Random Spawn"],
    nations: 10,
    bots: 9,
    goldMultiplier: 1,
    randomSpawn: true,
    instantBuild: false,
  },
  {
    world: "mars",
    title: "Mars",
    tag: "SPLIT",
    tags: ["2× Gold"],
    nations: 24,
    bots: 36,
    goldMultiplier: 2,
    randomSpawn: false,
    instantBuild: false,
  },
  {
    world: "earth",
    title: "Earth",
    tag: "PACKED",
    tags: ["Every Country"],
    nations: 200,
    bots: 80,
    goldMultiplier: 1,
    randomSpawn: false,
    instantBuild: false,
  },
  {
    world: "mars",
    title: "Mars",
    tag: "DUST",
    tags: ["Random Spawn", "2× Gold"],
    nations: 28,
    bots: 40,
    goldMultiplier: 2,
    randomSpawn: true,
    instantBuild: false,
  },
  {
    world: "earth",
    title: "Earth",
    tag: "GOLD",
    tags: ["2× Gold"],
    nations: 32,
    bots: 50,
    goldMultiplier: 2,
    randomSpawn: false,
    instantBuild: false,
  },
  {
    world: "mars",
    title: "Mars",
    tag: "WAR",
    tags: ["Instant Build", "Random Spawn"],
    nations: 24,
    bots: 50,
    goldMultiplier: 1,
    randomSpawn: true,
    instantBuild: true,
  },
];

export const SLOT_MS = 60_000;

export function currentFeatured(now = Date.now()): {
  match: FeaturedMatch;
  slot: number;
  remainingMs: number;
} {
  const slot = Math.floor(now / SLOT_MS);
  return {
    match: PLAYLIST[((slot % PLAYLIST.length) + PLAYLIST.length) % PLAYLIST.length],
    slot,
    remainingMs: (slot + 1) * SLOT_MS - now,
  };
}

const cache = new Map<string, Promise<GameMap>>();

export function loadWorld(id: WorldId, onProgress?: (msg: string) => void): Promise<GameMap> {
  const size = detectMapSize();
  const key = `${id}:${size.width}x${size.height}`;
  let p = cache.get(key);
  if (!p) {
    p = id === "mars" ? buildMars({ ...size, onProgress }) : buildMap({ ...size, onProgress });
    p = p.catch(error => { cache.delete(key); throw error; });
    cache.set(key, p);
  }
  return p;
}

export function preloadWorlds(): void {
  const { match } = currentFeatured();
  void loadWorld(match.world).then(() => {
    const other: WorldId = match.world === "earth" ? "mars" : "earth";
    void loadWorld(other);
  });
}

export async function paintWorldPreview(canvas: HTMLCanvasElement, world: WorldId): Promise<void> {
  const w = 512;
  const h = 256;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  if (world === "mars") paintMarsPreview(ctx, w, h);
  else await paintEarthPreview(ctx, w, h);
}

async function paintEarthPreview(ctx: CanvasRenderingContext2D, w: number, h: number): Promise<void> {
  try {
    const bmp = await createImageBitmap(await (await fetch("/data/earth-water.png")).blob());
    const tmp = document.createElement("canvas");
    tmp.width = w;
    tmp.height = h;
    const tctx = tmp.getContext("2d", { willReadFrequently: true })!;
    tctx.imageSmoothingEnabled = false;
    tctx.drawImage(bmp, 0, 0, w, h);
    const img = tctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = d[i];
      if (v > 140) {
        d[i] = 0x10;
        d[i + 1] = 0x2c;
        d[i + 2] = 0x58;
      } else {
        d[i] = 0x5a;
        d[i + 1] = 0x8c;
        d[i + 2] = 0x3c;
      }
      d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    bmp.close();
  } catch {
    ctx.fillStyle = "#102c58";
    ctx.fillRect(0, 0, w, h);
  }
}

function paintMarsPreview(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const owner = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const lat = 90 - ((y + 0.5) * 180) / h;
    for (let x = 0; x < w; x++) {
      const lon = ((x + 0.5) * 360) / w - 180;
      const s = sampleMars(lat, lon);
      const i = (y * w + x) * 4;
      let r: number, g: number, b: number;
      if (s.ice) {
        owner[y * w + x] = 0;
        r = 0xe9;
        g = 0xd8;
        b = 0xd0;
      } else if (s.sea) {
        owner[y * w + x] = 0;
        r = 0x3d;
        g = 0x1c;
        b = 0x14;
      } else {
        owner[y * w + x] = nearestColony(lat, lon);
        if (s.elev >= 165) {
          r = 0xd8;
          g = 0xc0;
          b = 0xa8;
        } else if (s.elev >= 100) {
          r = 0xb0;
          g = 0x62;
          b = 0x38;
        } else {
          r = 0xc4;
          g = 0x6a;
          b = 0x32;
        }
      }
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = 255;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const id = owner[y * w + x];
      if (!id) continue;
      const right = owner[y * w + ((x + 1) % w)];
      const down = y + 1 < h ? owner[(y + 1) * w + x] : id;
      if ((right && right !== id) || (down && down !== id)) {
        const i = (y * w + x) * 4;
        d[i] = 0x2a;
        d[i + 1] = 0x14;
        d[i + 2] = 0x10;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

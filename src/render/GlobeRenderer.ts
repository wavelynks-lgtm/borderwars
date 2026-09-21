import {generatedColor} from "../map/generator";
import {PATTERNS,type Cosmetics} from "../customization/cosmetics";
import { regionBorderStrength } from "../map/regionGrouping";
import { displayTile, displayTileAtUV } from "../map/displayGrid";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { GameMap } from "../core/GameMap";
import { FLAG_FRONT_IN, FLAG_FRONT_OUT, FLAG_PREVIEW, GraphicsQuality, TerrainType } from "../core/types";
import type { RailGhostTile } from "../core/RailNetwork";
import { GLOBE_RADIUS, latLonToVec3, vec3ToLatLon } from "../map/geo";
import { atmosphereFrag, atmosphereVert, globeFrag, globeVert } from "./shaders";

export interface PickResult {
  tile: number;
  point: THREE.Vector3;
}

export class GlobeRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly globe: THREE.Mesh;
  readonly unitGroup = new THREE.Group();

  private ownerData: Uint8Array;
  private ownerTex: THREE.DataTexture;
  private terrainData!: Uint8Array;
  private terrainTex!: THREE.DataTexture;
  private metaData!: Uint8Array;
  private metaTex!: THREE.DataTexture;
  private patternData = new Uint8Array(1024*4);
  private patternTex: THREE.DataTexture;
  private paletteData = new Uint8Array(1024 * 4);
  private paletteTex: THREE.DataTexture;
  private material: THREE.ShaderMaterial;
  private raycaster = new THREE.Raycaster();
  private clock = new THREE.Clock();
  private flyFrom: THREE.Vector3 | null = null;
  private flyTo_: THREE.Vector3 | null = null;
  private flyT = 0;
  private flyDuration = 0;
  private stars: THREE.Points | null = null;
  private atmosphere: THREE.Mesh;
  private quality = GraphicsQuality.Medium;
  private qualityDpr = 1;
  private adaptDpr = 1;
  private frameEma = 0;
  private adaptWarmup = 0;
  private lastAppliedDpr = 1;
  private camQuietUntil = 0;
  private lastCamPos = new THREE.Vector3(0, 60, 320);
  private camDir = new THREE.Vector3();
  private camRight = new THREE.Vector3();
  private camUp = new THREE.Vector3();
  private lightDir = new THREE.Vector3();
  private flyA = new THREE.Vector3();
  private flyB = new THREE.Vector3();
  private flyQ = new THREE.Quaternion();
  private flyQi = new THREE.Quaternion();

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly map: GameMap,
  ) {
    // Retina at 2x + MSAA on a full-screen globe shader is the single biggest GPU cost;
    // 1.5x without MSAA is visually identical for a pixel-art world and roughly 3x cheaper.
    const dpr = window.devicePixelRatio || 1;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    const startDpr = Math.min(dpr, 1);
    this.renderer.setPixelRatio(startDpr);
    this.qualityDpr = startDpr;
    this.adaptDpr = startDpr;
    this.lastAppliedDpr = startDpr;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.sortObjects = true;
    this.renderer.setClearColor(map.world === "mars" ? 0x140806 : 0x030509, 1);
    this.camera = new THREE.PerspectiveCamera(45, 1, 3, 4500);
    this.camera.position.set(0, 60, 320);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.14;
    this.controls.minDistance = GLOBE_RADIUS + 10;
    this.controls.maxDistance = 450;
    this.controls.minPolarAngle = 0.18;
    this.controls.maxPolarAngle = Math.PI - 0.18;
    this.controls.zoomSpeed = 0.85;
    this.controls.rotateSpeed = 0.12;
    this.controls.target.set(0, 0, 0);
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: null as unknown as THREE.MOUSE };

    // textures
    const W = map.width;
    const H = map.height;
    const terrainTex = this.bakeTerrain();
    const metaTex = this.bakeMeta();
    this.ownerData = new Uint8Array(W * H * 4);
    this.frontFlags = new Uint8Array(W * H);
    this.ghostRail = new Uint8Array(W * H);
    this.terrainDirtyRows = new Uint8Array(H);
    this.ownerTex = new THREE.DataTexture(this.ownerData, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.ownerTex.magFilter = THREE.NearestFilter;
    this.ownerTex.minFilter = THREE.NearestFilter;
    this.ownerTex.generateMipmaps = false;
    this.ownerTex.wrapS = THREE.RepeatWrapping;
    this.ownerTex.needsUpdate = true;
    this.paletteTex = new THREE.DataTexture(this.paletteData, 1024, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.paletteTex.magFilter = THREE.NearestFilter;
    this.paletteTex.minFilter = THREE.NearestFilter;
    this.paletteTex.generateMipmaps = false;
    this.paletteTex.needsUpdate = true;

    this.patternTex=new THREE.DataTexture(this.patternData,1024,1,THREE.RGBAFormat);
    this.patternTex.magFilter=this.patternTex.minFilter=THREE.NearestFilter;this.patternTex.needsUpdate=true;
    this.material = new THREE.ShaderMaterial({
      vertexShader: globeVert,
      fragmentShader: globeFrag,
      toneMapped: false,
      uniforms: {
        uTerrain: { value: terrainTex },
        uOwner: { value: this.ownerTex },
        uPalette: { value: this.paletteTex },
        uPatterns: { value: this.patternTex },
        uMeta: { value: metaTex },
        uTexel: { value: new THREE.Vector2(1 / W, 1 / H) },
        uLightDir: { value: new THREE.Vector3(0.3, 0.5, 1).normalize() },
        uHoverOwner: { value: -1 },
        uHoverCountry: { value: -1 },
        uTerrainView: { value: 0 },
        uBorderStrength: { value: 0.6 },
        uRegionBorderStrength: { value: 0 },
        uTime: { value: 0 },
        uSpawnMode: { value: 0 },
        uLocalOwner: { value: 0 },
        uLod: { value: 1 },
      },
    });
    const geo = new THREE.SphereGeometry(GLOBE_RADIUS, 96, 64);
    this.globe = new THREE.Mesh(geo, this.material);
    this.globe.matrixAutoUpdate = false;
    this.globe.frustumCulled = false;
    this.globe.updateMatrix();
    this.scene.matrixAutoUpdate = false;
    this.scene.add(this.globe);

    // atmosphere
    const atm = new THREE.Mesh(
      new THREE.SphereGeometry(GLOBE_RADIUS * 1.035, 32, 20),
      new THREE.ShaderMaterial({
        vertexShader: atmosphereVert,
        fragmentShader: atmosphereFrag,
        transparent: true,
        side: THREE.BackSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uColor: {
            value:
              map.world === "mars" ? new THREE.Vector3(0.85, 0.38, 0.18) : new THREE.Vector3(0.35, 0.6, 1.0),
          },
        },
      }),
    );
    this.scene.add(atm);
    this.atmosphere = atm;
    atm.matrixAutoUpdate = false;
    atm.frustumCulled = false;
    atm.updateMatrix();
    this.unitGroup.matrixAutoUpdate = false;
    this.unitGroup.updateMatrix();
    this.scene.add(this.unitGroup);
    this.addStars();

    window.addEventListener("resize", () => this.resize());
    this.resize();
  }

  // ---------- baking ----------
  private bakeTerrain(): THREE.DataTexture {
    const map = this.map;
    const W = map.width;
    const H = map.height;
    const data = new Uint8Array(W * H * 4);
    const elev = map.elevation;
    // Shallow-water band: seed only the coastline so 8K does not BFS from every inland tile.
    const dist = new Uint8Array(W * H).fill(255);
    let frontier: number[] = [];
    const buf: number[] = [0, 0, 0, 0];
    for (let t = 0; t < W * H; t++) {
      if (!(map.isLand(t) || map.isImpassable(t))) continue;
      dist[t] = 0;
      const n = map.neighbors4(t, buf);
      for (let i = 0; i < n; i++) {
        if (map.isWater(buf[i])) {
          frontier.push(t);
          break;
        }
      }
    }
    const k = map.scale;
    const maxD = Math.round(8 * k);
    for (let d = 1; d <= maxD && frontier.length; d++) {
      const next: number[] = [];
      for (const t of frontier) {
        const n = map.neighbors4(t, buf);
        for (let i = 0; i < n; i++) {
          const nb = buf[i];
          if (dist[nb] === 255 && map.isWater(nb)) {
            dist[nb] = d;
            next.push(nb);
          }
        }
      }
      frontier = next;
    }
    // Fixed pixel-art palette: every tile gets one of a handful of flat colours.
    const PAL =
      map.world === "mars"
        ? {
            deep: [0x2a, 0x14, 0x10],
            sea: [0x3d, 0x1c, 0x14],
            coast: [0x5a, 0x28, 0x18],
            shore: [0x7a, 0x3a, 0x22],
            plains: [
              [0x9a, 0x4a, 0x24],
              [0xb4, 0x5c, 0x2a],
              [0xc8, 0x6e, 0x34],
            ],
            highland: [
              [0x8a, 0x48, 0x2c],
              [0xa4, 0x58, 0x32],
              [0xbc, 0x6a, 0x3a],
            ],
            mountain: [
              [0xc8, 0xaa, 0x88],
              [0xdc, 0xc0, 0xa0],
              [0xee, 0xd8, 0xbc],
            ],
            ice: [0xe9, 0xd8, 0xd0],
          }
        : {
            deep: [0x0b, 0x1e, 0x3f],
            sea: [0x10, 0x2c, 0x58],
            coast: [0x1a, 0x45, 0x7a],
            shore: [0x2a, 0x63, 0x9e],
            plains: [
              [0x5a, 0x8c, 0x3c],
              [0x6c, 0xa0, 0x46],
              [0x83, 0xb3, 0x52],
            ],
            highland: [
              [0x9a, 0x86, 0x4e],
              [0xb0, 0x9a, 0x5c],
              [0xc4, 0xae, 0x6e],
            ],
            mountain: [
              [0xb8, 0xb6, 0xb4],
              [0xdc, 0xdc, 0xe0],
              [0xf4, 0xf4, 0xf8],
            ],
            ice: [0xe9, 0xf0, 0xfa],
          };
    const country = map.country;
    for (let t = 0; t < W * H; t++) {
      const tt = map.terrain[t];
      const e = elev ? elev[t] : 60;
      let c: number[];
      // alpha = static country border (baked so the shader needs no neighbour lookups)
      let a = 0;
      if (tt !== TerrainType.Water && tt !== TerrainType.Impassable) {
        const cid = country[t];
        const n = map.neighbors4(t, buf);
        for (let i = 0; i < n; i++) {
          const nc = country[buf[i]];
          if (nc !== cid && nc !== 0) {
            const parent = map.countries[cid]?.parentId ?? cid;
            const neighborParent = map.countries[nc]?.parentId ?? nc;
            a = Math.max(a, parent === neighborParent ? 128 : 255);
            if (a === 255) break;
          }
        }
      }
      switch (tt) {
        case TerrainType.Water: {
          const d = dist[t];
          c = d === 255 || d > 6 * k ? PAL.deep : d > 3 * k ? PAL.sea : d > 1 * k ? PAL.coast : PAL.shore;
          break;
        }
        case TerrainType.Plains:
          c = PAL.plains[e < 25 ? 0 : e < 60 ? 1 : 2];
          break;
        case TerrainType.Highland:
          c = PAL.highland[e < 120 ? 0 : e < 160 ? 1 : 2];
          break;
        case TerrainType.Mountain:
          c = PAL.mountain[e < 200 ? 0 : e < 230 ? 1 : 2];
          break;
        default:
          c = PAL.ice;
      }
      if(map.generated)c=generatedColor(map.generated,tt,e,country[t],a>0);
      const i = t * 4;
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = a;
    }
    const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.wrapS = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    this.terrainData = data;
    this.terrainTex = tex;
    return tex;
  }

  private bakeMeta(): THREE.DataTexture {
    const map = this.map;
    const W = map.width;
    const H = map.height;
    const data = new Uint8Array(W * H * 4);
    for (let t = 0; t < W * H; t++) {
      const c = map.country[t];
      const i = t * 4;
      data[i] = c & 255;
      data[i + 1] = c >> 8;
      data[i + 2] = map.terrain[t];
      data[i + 3] = map.elevation ? map.elevation[t] : 0;
    }
    const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.wrapS = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    this.metaData = data;
    this.metaTex = tex;
    return tex;
  }

  private addStars() {
    const n = 280;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(2500 + Math.random() * 1500);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color: 0xbfc8ff, size: 2.4, sizeAttenuation: false, transparent: true, opacity: 0.75, depthWrite: false });
    this.stars = new THREE.Points(g, m);
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);
  }

  // ---------- public API ----------
  setPlayerColor(smallID: number, color: THREE.Color): void {
    const i = smallID * 4;
    this.paletteData[i] = color.r * 255;
    this.paletteData[i + 1] = color.g * 255;
    this.paletteData[i + 2] = color.b * 255;
    this.paletteData[i + 3] = 255;
    this.paletteTex.needsUpdate = true;
  }

  setPlayerPattern(smallID:number,cosmetics:Cosmetics):void {
    const i=smallID*4,c=new THREE.Color(cosmetics.secondary);this.patternData[i]=c.r*255;this.patternData[i+1]=c.g*255;this.patternData[i+2]=c.b*255;this.patternData[i+3]=PATTERNS.indexOf(cosmetics.pattern);this.patternTex.needsUpdate=true;
  }

  setHover(ownerId: number, countryId: number): void {
    this.material.uniforms.uHoverOwner.value = ownerId;
    this.material.uniforms.uHoverCountry.value = countryId;
  }
  setTerrainView(on: boolean): void {
    this.material.uniforms.uTerrainView.value = on ? 1 : 0;
  }
  setSpawnMode(on: boolean): void {
    const v = on ? 1 : 0;
    if (this.material.uniforms.uSpawnMode.value === v) return;
    this.material.uniforms.uSpawnMode.value = v;
  }
  setLocalOwner(id: number): void {
    this.material.uniforms.uLocalOwner.value = id;
  }

  setQuality(q: GraphicsQuality): void {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    const cap = q === GraphicsQuality.Low ? 0.75 : q === GraphicsQuality.High ? Math.min(dpr, 1.25) : Math.min(dpr, 1);
    this.qualityDpr = cap;
    this.adaptDpr = cap;
    this.lastAppliedDpr = cap;
    this.adaptWarmup = 0;
    this.frameEma = 0;
    this.renderer.setPixelRatio(cap);
    const gw = q === GraphicsQuality.Low ? 64 : q === GraphicsQuality.High ? 128 : 96;
    const gh = q === GraphicsQuality.Low ? 32 : q === GraphicsQuality.High ? 80 : 64;
    this.globe.geometry.dispose();
    this.globe.geometry = new THREE.SphereGeometry(GLOBE_RADIUS, gw, gh);
    this.globe.updateMatrix();
    if (this.atmosphere) {
      this.atmosphere.geometry.dispose();
      this.atmosphere.geometry = new THREE.SphereGeometry(GLOBE_RADIUS * 1.035, q === GraphicsQuality.High ? 40 : 24, q === GraphicsQuality.High ? 24 : 16);
      this.atmosphere.updateMatrix();
    }
    if (this.stars) this.stars.visible = q !== GraphicsQuality.Low;
    if (this.atmosphere) this.atmosphere.visible = q !== GraphicsQuality.Low;
    this.resize();
  }

  /** CPU-side flood: GPU rows flush in syncTerrain() */
  paintSunk(tile: number): void {
    const i = tile * 4;
    const mars = this.map.world === "mars";
    this.terrainData[i] = mars ? 0x2a : 0x0b;
    this.terrainData[i + 1] = mars ? 0x14 : 0x1e;
    this.terrainData[i + 2] = mars ? 0x10 : 0x3f;
    this.terrainData[i + 3] = 0;
    this.metaData[i + 2] = TerrainType.Water;
    const y = this.map.y(tile);
    this.terrainDirtyRows[y] = 1;
    if (!this.terrainDirty) {
      this.terrainDirty = true;
      this.terrainMinY = y;
      this.terrainMaxY = y;
    } else {
      if (y < this.terrainMinY) this.terrainMinY = y;
      if (y > this.terrainMaxY) this.terrainMaxY = y;
    }
  }

  syncTerrain(): void {
    if (!this.terrainDirty) return;
    const H = this.map.height;
    const rows = this.terrainDirtyRows;
    const minY = this.terrainMinY;
    const maxY = this.terrainMaxY;
    this.terrainDirty = false;
    let runStart = -1;
    let runEnd = -1;
    const GAP = 4;
    for (let y = minY; y <= maxY + 1; y++) {
      const on = y <= maxY && y < H && rows[y] === 1;
      if (on) {
        rows[y] = 0;
        if (runStart < 0) runStart = y;
        runEnd = y;
      } else if (runStart >= 0 && (y > maxY || y - runEnd > GAP)) {
        this.uploadTexRows(this.terrainTex, this.terrainData, runStart, runEnd);
        this.uploadTexRows(this.metaTex, this.metaData, runStart, runEnd);
        runStart = -1;
      }
    }
  }

  /**
   * Copy changed tiles of owner/fallout/flags into the GPU texture.
   * WebGL2 UNPACK_ROW_LENGTH uploads only the dirty x-span (Khronos / Mapbox
   * partial-texture pattern) and a row budget keeps 8K packed matches under the frame cap.
   */
  private uploadCursor = 0;

  syncTerritory(): void {
    const map = this.map;
    if (!map.dirty) return;
    const budget = map.width >= 8192 ? 96 : 256;
    let used = 0;
    let scanned = 0;
    let y = (this.uploadCursor ?? 0) % map.height;
    while (scanned < map.height) {
      if (!map.dirtyRows[y]) {
        y = (y + 1) % map.height;
        scanned++;
        continue;
      }
      if (used >= budget) {
        this.uploadCursor = y;
        return;
      }
      let x0 = map.dirtyRowMinX[y];
      let x1 = map.dirtyRowMaxX[y];
      let end = y;
      // Coalesce nearby spans when the extra pixels cost less than another GL call.
      while (end + 1 < map.height && scanned + end - y + 1 < map.height && used + end - y + 1 < budget && map.dirtyRows[end + 1]) {
        const lo = Math.min(x0, map.dirtyRowMinX[end + 1]);
        const hi = Math.max(x1, map.dirtyRowMaxX[end + 1]);
        if ((hi - lo + 1) * (end - y + 2) > (x1 - x0 + 1) * (end - y + 1) +
          map.dirtyRowMaxX[end + 1] - map.dirtyRowMinX[end + 1] + 1 + 128) break;
        x0 = lo; x1 = hi; end++;
      }
      this.packOwnerSpan(y, end, x0, x1);
      this.uploadTexRect(this.ownerTex, this.ownerData, x0, y, x1, end);
      for (let row = y; row <= end; row++) {
        map.dirtyRows[row] = 0;
        map.dirtyRowMinX[row] = map.width;
        map.dirtyRowMaxX[row] = -1;
      }
      used += end - y + 1;
      scanned += end - y + 1;
      y = (end + 1) % map.height;
    }
    this.uploadCursor = y;
    map.clearDirty();
  }

  private packOwnerSpan(y0: number, y1: number, x0: number, x1: number): void {
    const map = this.map;
    const W = map.width;
    const owner = map.owner;
    const fallout = map.fallout;
    const mflags = map.flags;
    const flags = this.frontFlags;
    const ghost = this.ghostRail;
    const d = this.ownerData;
    const rail = map.railType;
    for (let y = y0; y <= y1; y++) {
      const row = y * W;
      for (let x = x0, t = row + x0, i = t * 4; x <= x1; x++, t++, i += 4) {
        const o = owner[t];
        d[i] = o & 255;
        d[i + 1] = o >> 8;
        d[i + 2] = fallout[t] | mflags[t] | flags[t];
        const rt = rail[t];
        d[i + 3] = rt > 0 ? rt : ghost[t] > 0 ? ghost[t] + 16 : 0;
      }
    }
  }

  private uploadTexRows(tex: THREE.DataTexture, data: Uint8Array, y0: number, y1: number): void {
    this.uploadTexRect(tex, data, 0, y0, this.map.width - 1, y1);
  }

  private uploadTexRect(tex: THREE.DataTexture, data: Uint8Array, x0: number, y0: number, x1: number, y1: number): void {
    const gl = this.renderer.getContext();
    const props = this.renderer.properties.get(tex) as { __webglTexture?: WebGLTexture };
    if (!props.__webglTexture) {
      tex.needsUpdate = true;
      return;
    }
    const W = this.map.width;
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    this.renderer.state.bindTexture(gl.TEXTURE_2D, props.__webglTexture);
    this.renderer.state.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    this.renderer.state.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    this.renderer.state.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    this.renderer.state.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    const gl2 = gl as WebGL2RenderingContext;
    if (typeof gl2.UNPACK_ROW_LENGTH === "number" && w < W) {
      this.renderer.state.pixelStorei(gl2.UNPACK_ROW_LENGTH, W);
      this.renderer.state.pixelStorei(gl2.UNPACK_SKIP_ROWS, y0);
      this.renderer.state.pixelStorei(gl2.UNPACK_SKIP_PIXELS, x0);
      gl2.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
      this.renderer.state.pixelStorei(gl2.UNPACK_ROW_LENGTH, 0);
      this.renderer.state.pixelStorei(gl2.UNPACK_SKIP_ROWS, 0);
      this.renderer.state.pixelStorei(gl2.UNPACK_SKIP_PIXELS, 0);
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y0, W, h, gl.RGBA, gl.UNSIGNED_BYTE, data.subarray(y0 * W * 4, (y1 + 1) * W * 4));
    }
  }

  /** per-tile transient flags owned by the renderer (attack fronts, build preview) */
  private frontFlags!: Uint8Array;
  private ghostRail!: Uint8Array;
  private frontList: number[] = [];
  private previewList: number[] = [];
  private ghostList: number[] = [];
  railPreview: RailGhostTile[] = [];
  railPreviewVersion = 0;
  private previousOut: number[] = [];
  private previousIn: number[] = [];
  private terrainDirtyRows!: Uint8Array;
  private terrainDirty = false;
  private terrainMinY = 0;
  private terrainMaxY = 0;

  /** highlight the tiles currently being fought over by the local player's attacks */
  setFrontTiles(outgoing: Iterable<number>, incoming: Iterable<number>): void {
    // Mark the visible cell center so thin fronts survive polar pixel merging.
    const visible = (tiles: Iterable<number>) => [...new Set(Array.from(tiles, t => displayTile(this.map.width, this.map.height, t)))];
    const nextOut = visible(outgoing);
    const nextInc = visible(incoming);
    if (nextOut.length === this.previousOut.length && nextInc.length === this.previousIn.length &&
      nextOut.every((t, i) => t === this.previousOut[i]) && nextInc.every((t, i) => t === this.previousIn[i])) return;
    this.previousOut = nextOut;
    this.previousIn = nextInc;
    const map = this.map;
    const flags = this.frontFlags;
    const keep = new Set(nextOut);
    for (const t of nextInc) keep.add(t);
    for (const t of this.frontList) {
      if (keep.has(t)) continue;
      flags[t] &= ~(FLAG_FRONT_OUT | FLAG_FRONT_IN);
      map.markDirty(t);
    }
    this.frontList.length = 0;
    for (const t of nextOut) {
      const before = flags[t];
      flags[t] = (before & ~FLAG_FRONT_IN) | FLAG_FRONT_OUT;
      if (flags[t] !== before) map.markDirty(t);
      this.frontList.push(t);
    }
    for (const t of nextInc) {
      const before = flags[t];
      flags[t] = (before & ~FLAG_FRONT_OUT) | FLAG_FRONT_IN;
      if (flags[t] !== before) map.markDirty(t);
      this.frontList.push(t);
    }
  }

  /** tiles that a structure being placed would affect (e.g. border a Defense Post reinforces) */
  setPreviewTiles(tiles: Iterable<number>): void {
    const map = this.map;
    const flags = this.frontFlags;
    for (const t of this.previewList) {
      flags[t] &= ~FLAG_PREVIEW;
      map.markDirty(t);
    }
    this.previewList.length = 0;
    for (const t of tiles) {
      flags[t] |= FLAG_PREVIEW;
      map.markDirty(t);
      this.previewList.push(t);
    }
  }

  /** ghost dual-rails for a Factory/City/Port placement; overlapping real rails turn green */
  setRailGhost(tiles: Iterable<RailGhostTile>, overlap: Iterable<number> = []): void {
    const map = this.map;
    const list = [...tiles];
    const overlapping = [...overlap];
    const preview = [...list, ...overlapping.map(ref => ({ ref, type: map.railType[ref] }))];
    if (preview.length !== this.railPreview.length || preview.some((t, i) => t.ref !== this.railPreview[i].ref || t.type !== this.railPreview[i].type)) {
      this.railPreview = preview;
      this.railPreviewVersion++;
    }
    const flags = this.frontFlags;
    const ghost = this.ghostRail;
    for (const t of this.ghostList) {
      ghost[t] = 0;
      flags[t] &= ~FLAG_PREVIEW;
      map.markDirty(t);
    }
    this.ghostList.length = 0;
    for (const { ref, type } of list) {
      if (map.railType[ref] > 0) {
        flags[ref] |= FLAG_PREVIEW;
      } else {
        ghost[ref] = type;
      }
      map.markDirty(ref);
      this.ghostList.push(ref);
    }
    for (const t of overlapping) {
      if (map.railType[t] > 0) flags[t] |= FLAG_PREVIEW;
      map.markDirty(t);
      this.ghostList.push(t);
    }
  }

  pick(clientX: number, clientY: number): PickResult | null {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const ndc = this.pickNdc.set(((clientX - rect.left) / w) * 2 - 1, -((clientY - rect.top) / h) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const origin = this.raycaster.ray.origin;
    const dir = this.raycaster.ray.direction;
    const b = origin.dot(dir);
    const c = origin.lengthSq() - GLOBE_RADIUS * GLOBE_RADIUS;
    const disc = b * b - c;
    if (disc < 0) return null;
    let t = -b - Math.sqrt(disc);
    if (t < 0) t = -b + Math.sqrt(disc);
    if (t < 0) return null;
    this.pickHit.copy(dir).multiplyScalar(t).add(origin);
    const { lat, lon } = vec3ToLatLon(this.pickHit);
    return {
      tile: displayTileAtUV(this.map.width, this.map.height, (lon + 180) / 360, (90 - lat) / 180),
      point: this.pickHit,
    };
  }

  tileToWorld(tile: number, altitude = 0, out = new THREE.Vector3()): THREE.Vector3 {
    const { lat, lon } = this.map.tileToLatLon(tile);
    return latLonToVec3(lat, lon, GLOBE_RADIUS + altitude, out);
  }

  /** project a tile to screen; returns false if on the far side */
  projectTile(tile: number, out: { x: number; y: number; scale: number }): boolean {
    return this.projectXY(this.map.x(tile) + 0.5, this.map.y(tile) + 0.5, out);
  }

  private projTmp = new THREE.Vector3();
  private projCam = new THREE.Vector3();
  private projN = new THREE.Vector3();
  private pickNdc = new THREE.Vector2();
  private pickHit = new THREE.Vector3();

  /** project fractional map coordinates to screen; returns false if on the far side */
  projectXY(fx: number, fy: number, out: { x: number; y: number; scale: number }): boolean {
    const map = this.map;
    const lon = (fx / map.width) * 360 - 180;
    const lat = 90 - (fy / map.height) * 180;
    const p = latLonToVec3(lat, lon, GLOBE_RADIUS + 0.5, this.projTmp);
    const toCam = this.projCam.copy(this.camera.position).normalize();
    this.projN.copy(p).normalize();
    const facing = this.projN.dot(toCam);
    if (facing < GLOBE_RADIUS / this.cameraDistance()) return false;
    const v = p.project(this.camera);
    if (v.z > 1 || v.x < -1.2 || v.x > 1.2 || v.y < -1.2 || v.y > 1.2) return false;
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    out.x = ((v.x + 1) / 2) * w;
    out.y = ((1 - v.y) / 2) * h;
    out.scale = Math.min(1.6, Math.max(0.55, 260 / this.cameraDistance()));
    return true;
  }

  cameraDistance(): number {
    return this.camera.position.length();
  }

  flyTo(tile: number, durationMs = 900): void {
    const dist = Math.max(this.cameraDistance(), this.controls.minDistance + 40);
    const target = this.tileToWorld(tile).normalize().multiplyScalar(dist);
    this.flyFrom = this.camera.position.clone();
    this.flyTo_ = target;
    this.flyT = 0;
    this.flyDuration = durationMs / 1000;
  }

  zoomTo(distance: number): void {
    const dir = this.camera.position.clone().normalize();
    this.camera.position.copy(dir.multiplyScalar(distance));
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Drop drawing-buffer resolution when the frame time climbs, raise it again
   * when there's headroom — same idea as Drei's PerformanceMonitor / Codrops DPR cap.
   */
  private adaptResolution(dt: number): void {
    if (performance.now() < this.camQuietUntil) return;
    if (this.adaptWarmup < 50) {
      this.adaptWarmup++;
      return;
    }
    const sample = Math.min(0.08, Math.max(0.008, dt));
    this.frameEma = this.frameEma === 0 ? sample : this.frameEma * 0.9 + sample * 0.1;
    const fps = 1 / this.frameEma;
    let next = this.adaptDpr;
    if (fps < 40) next = Math.max(0.55, next * 0.92);
    else if (fps > 56) next = Math.min(this.qualityDpr, next * 1.04);
    this.adaptDpr = next;
    if (Math.abs(next - this.lastAppliedDpr) < 0.08) return;
    this.lastAppliedDpr = next;
    this.renderer.setPixelRatio(next);
  }

  render(): void {
    const dt = this.clock.getDelta();
    this.controls.target.set(0, 0, 0);
    this.camera.up.set(0, 1, 0);

    if (this.flyTo_ && this.flyFrom) {
      this.flyT += dt / this.flyDuration;
      const k = this.flyT >= 1 ? 1 : 1 - Math.pow(1 - this.flyT, 3);
      this.flyA.copy(this.flyFrom).normalize();
      this.flyB.copy(this.flyTo_).normalize();
      this.flyQ.setFromUnitVectors(this.flyA, this.flyB);
      this.flyQi.identity().slerp(this.flyQ, k);
      this.camera.position.copy(this.flyA).applyQuaternion(this.flyQi).multiplyScalar(this.camera.position.length());
      if (this.flyT >= 1) {
        this.flyFrom = null;
        this.flyTo_ = null;
      }
    }
    this.controls.update();

    const dist = this.cameraDistance();
    if (!Number.isFinite(dist) || dist < 1) {
      this.camDir.set(0, 0.2, 1).normalize().multiplyScalar(GLOBE_RADIUS + 80);
      this.camera.position.copy(this.camDir);
    }
    if (this.camera.position.distanceToSquared(this.lastCamPos) > 0.001) {
      this.camQuietUntil = performance.now() + 700;
      this.lastCamPos.copy(this.camera.position);
    }
    this.adaptResolution(dt);

    this.camDir.copy(this.camera.position).normalize();
    this.camUp.copy(this.camera.up);
    this.camRight.crossVectors(this.camDir, this.camUp).normalize();
    this.lightDir.copy(this.camDir).addScaledVector(this.camRight, -0.6).addScaledVector(this.camUp, 0.5).normalize();
    this.material.uniforms.uLightDir.value.copy(this.lightDir);
    this.material.uniforms.uTime.value = this.clock.elapsedTime;
    this.material.uniforms.uBorderStrength.value = 0.65;
    this.material.uniforms.uRegionBorderStrength.value = regionBorderStrength(dist - GLOBE_RADIUS);
    this.material.uniforms.uLod.value = dist > GLOBE_RADIUS + 48 ? 1 : 0;
    const alt = Math.max(1, dist - GLOBE_RADIUS);
    if (this.atmosphere) this.atmosphere.visible = this.quality !== GraphicsQuality.Low && dist < 380 && alt > 8;
    if (this.stars) this.stars.visible = this.quality !== GraphicsQuality.Low && alt > 28;

    this.renderer.render(this.scene, this.camera);
  }
}

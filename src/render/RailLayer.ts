import * as THREE from "three";
import { shade } from "../ui/icons";
import type { Game } from "../core/Game";
import type { GlobeRenderer } from "./GlobeRenderer";
import { GLOBE_RADIUS, latLonToVec3 } from "../map/geo";

/** Surface ribbons follow the same waypoints as trains, independent of the texture grid. */
export class RailLayer {
  private version = -1;
  private ownerHash = -1;
  private ownerCheckTick = -1;
  private previewVersion = -1;
  private preview: THREE.Mesh | null = null;
  private previewMaterial = new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });
  private mesh: THREE.Mesh | null = null;
  private material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  constructor(private globe: GlobeRenderer, private game: Game) {}

  update(): void {
    this.updatePreview();
    const tick = Math.floor(this.game.ticks / 10);
    if (this.version === this.game.rail.version && tick === this.ownerCheckTick) return;
    this.ownerCheckTick = tick;
    let hash = 0;
    for (const rail of this.game.rail.railroads) for (const t of rail.tiles) hash = Math.imul(hash,31) + this.game.map.owner[t] | 0;
    if (this.version === this.game.rail.version && this.ownerHash === hash) return;
    this.ownerHash = hash;
    this.version = this.game.rail.version;
    if (this.mesh) {
      this.globe.unitGroup.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    const positions: number[] = [], colors: number[] = [];
    const tile = 2 * Math.PI * GLOBE_RADIUS / this.game.map.width;
    const colorsByOwner = new Map<number, THREE.Color>();
    const railColor = (tile: number) => {
      const id = this.game.map.owner[tile];
      let color = colorsByOwner.get(id);
      if (!color) {
        const owner = this.game.player(id);
        if (owner?.isHuman()) {
          const c = new THREE.Color(owner.color);
          color = new THREE.Color(c.r*.299+c.g*.587+c.b*.114 > .65 ? "#111111" : "#ffffff");
        } else color = new THREE.Color(owner ? shade(owner.color,-.55) : "#bfbfbf");
        colorsByOwner.set(id,color);
      }
      return color;
    };
    const strip = (a: THREE.Vector3, b: THREE.Vector3, offset: number, width: number, color: THREE.Color) => {
      const normal = a.clone().add(b).normalize();
      const side = b.clone().sub(a).cross(normal).normalize();
      const pts = [a.clone().addScaledVector(side, offset-width/2), a.clone().addScaledVector(side, offset+width/2), b.clone().addScaledVector(side, offset-width/2), b.clone().addScaledVector(side, offset+width/2)];
      for (const i of [0, 2, 1, 1, 2, 3]) {
        pts[i].normalize().multiplyScalar(GLOBE_RADIUS + 0.027);
        positions.push(pts[i].x, pts[i].y, pts[i].z);
        colors.push(color.r, color.g, color.b);
      }
    };
    for (const rail of this.game.rail.railroads) {
      let tieRemaining = tile * 0.5;
      for (let i = 1; i < rail.tiles.length; i++) {
        const a = this.globe.tileToWorld(rail.tiles[i-1]);
        const b = this.globe.tileToWorld(rail.tiles[i]);
        if (a.distanceToSquared(b) < 1e-12) continue;
        const steel = railColor(rail.tiles[i]);
        const length = a.distanceTo(b);
        while (tieRemaining < length) {
          const mid = a.clone().lerp(b, tieRemaining / length);
          const side = b.clone().sub(a).cross(mid).normalize();
          strip(mid.clone().addScaledVector(side, -tile * 0.5), mid.clone().addScaledVector(side, tile * 0.5), 0, tile / 3, steel);
          tieRemaining += tile;
        }
        tieRemaining -= length;
        strip(a, b, -tile / 3, tile / 3, steel);
        strip(a, b, tile / 3, tile / 3, steel);
      }
    }
    if (!positions.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.globe.unitGroup.add(this.mesh);
  }
  private updatePreview(): void {
    if (this.previewVersion === this.globe.railPreviewVersion) return;
    this.previewVersion = this.globe.railPreviewVersion;
    if (this.preview) {
      this.globe.unitGroup.remove(this.preview);
      this.preview.geometry.dispose();
      this.preview = null;
    }
    const positions: number[] = [], map = this.game.map;
    const halfWidth = Math.PI * GLOBE_RADIUS / map.width;
    const directions: Record<number, number[][]> = {
      1: [[0,-.5],[0,.5]], 2: [[-.5,0],[.5,0]],
      3: [[0,-.5],[-.5,0]], 4: [[0,-.5],[.5,0]],
      5: [[0,.5],[-.5,0]], 6: [[0,.5],[.5,0]],
    };
    for (const { ref, type } of this.globe.railPreview) {
      const a = this.globe.tileToWorld(ref);
      for (const [dx,dy] of directions[type] ?? []) {
        const b = latLonToVec3(90-(map.y(ref)+.5+dy)/map.height*180, (map.x(ref)+.5+dx)/map.width*360-180);
        const side = b.clone().sub(a).cross(a).normalize();
        const pts = [a.clone().addScaledVector(side,-halfWidth), a.clone().addScaledVector(side,halfWidth), b.clone().addScaledVector(side,-halfWidth), b.clone().addScaledVector(side,halfWidth)];
        for (const i of [0,2,1,1,2,3]) { const p=pts[i].normalize().multiplyScalar(GLOBE_RADIUS+.06); positions.push(p.x,p.y,p.z); }
      }
    }
    if (!positions.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions,3));
    this.preview = new THREE.Mesh(geometry,this.previewMaterial);
    this.globe.unitGroup.add(this.preview);
  }

}

import type { Game } from "../core/Game";
import type { Player } from "../core/Player";
import { fmtTroops } from "../core/executions/AttackExecution";
import type { GlobeRenderer } from "./GlobeRenderer";

/** HTML name/troop labels glued to a stable owned tile on the globe. */
export class Labels {
  private els = new Map<Player, HTMLDivElement>();
  private centroids = new Map<Player, number>();
  private lastAnchor = -1e9;
  private lastTroop = new Map<Player, number>();
  private proj = { x: 0, y: 0, scale: 1 };

  constructor(
    private container: HTMLElement,
    private globe: GlobeRenderer,
    private game: Game,
  ) {}

  /** Keep the same land tile until it is lost so names do not wander with the border. */
  private refreshAnchors(): void {
    const map = this.game.map;
    const dist = this.globe.cameraDistance();
    for (const p of this.game.allPlayers()) {
      if (!p.alive) {
        this.centroids.delete(p);
        continue;
      }
      if (p.isAI() && dist > 220 && !this.game.inSpawnPhase()) continue;
      const prev = this.centroids.get(p);
      if (prev !== undefined && map.owner[prev] === p.smallID && map.isLand(prev)) continue;
      this.centroids.set(p, this.pickAnchor(p));
    }
  }

  private pickAnchor(p: Player): number {
    const map = this.game.map;
    const owned = (t: number): boolean => t >= 0 && map.owner[t] === p.smallID && map.isLand(t);
    if (owned(p.spawnTile)) return p.spawnTile;
    const home = p.countryId ? map.countries[p.countryId]?.centroid ?? -1 : -1;
    if (owned(home)) return home;
    const src = p.tiles.size > 0 ? p.tiles : p.borderTiles;
    const step = Math.max(1, Math.ceil(src.size / 48));
    let i = 0;
    let fallback = -1;
    for (const t of src) {
      if (fallback < 0) fallback = t;
      if (i++ % step !== 0) continue;
      if (owned(t)) return t;
    }
    return fallback;
  }

  update(now: number): void {
    if (now - this.lastAnchor > 400) {
      this.lastAnchor = now;
      this.refreshAnchors();
    }
    const dist = this.globe.cameraDistance();
    const map = this.game.map;
    for (const p of this.game.allPlayers()) {
      let el = this.els.get(p);
      let c = this.centroids.get(p);
      if (c !== undefined && map.owner[c] !== p.smallID) {
        c = this.pickAnchor(p);
        this.centroids.set(p, c);
      }
      if (!p.alive || c === undefined || c < 0) {
        if (el && el.style.display !== "none") el.style.display = "none";
        continue;
      }
      const share = this.game.landPercent(p) / 100;
      const minShare = Math.max(0, (dist - 110) / 340) * 0.004;
      if (!this.game.inSpawnPhase() && (share < minShare || (p.isAI() && dist > 220)) && !p.isHuman()) {
        if (el && el.style.display !== "none") el.style.display = "none";
        continue;
      }
      if (!this.globe.projectTile(c, this.proj)) {
        if (el && el.style.display !== "none") el.style.display = "none";
        continue;
      }
      if (!el) {
        el = document.createElement("div");
        el.className = "label";
        const name = document.createElement("div");
        name.className = "label-name";
        const troops = document.createElement("div");
        troops.className = "label-troops";
        el.append(name, troops);
        this.container.appendChild(el);
        this.els.set(p, el);
        (el.firstChild as HTMLElement).textContent = `${p.flag ? p.flag+" " : ""}${p.name}${p.cosmetics.badge==='supporter'?" ★":""}`;
        el.style.setProperty("--c", p.color);
      }
      if (el.style.display !== "block") el.style.display = "block";
      const size = Math.min(1.8, Math.max(0.7, 0.75 + Math.sqrt(share) * 3)) * this.proj.scale;
      el.style.transform = `translate(-50%, -50%) translate3d(${this.proj.x.toFixed(1)}px, ${this.proj.y.toFixed(1)}px, 0) scale(${size.toFixed(2)})`;
      const troopKey = p.troops | 0;
      if (this.lastTroop.get(p) !== troopKey) {
        this.lastTroop.set(p, troopKey);
        (el.lastChild as HTMLElement).textContent = fmtTroops(p.troops);
      }
      el.classList.toggle("is-human", p.isHuman());
      el.classList.toggle("is-ally", !!this.game.human && this.game.human.isAlliedWith(p));
      el.classList.toggle("is-traitor", p.isTraitor(this.game.ticks));
    }
  }
}

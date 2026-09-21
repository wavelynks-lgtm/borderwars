import { fmt, fmtTroops } from "../core/executions/AttackExecution";
import type { TileRef } from "../core/types";
import type { GlobeRenderer } from "./GlobeRenderer";

interface Pop {
  el: HTMLElement;
  tile: TileRef;
  born: number;
  life: number;
}

/** Pixel "+15K" that floats up from a train stop. */
export class GoldFloats {
  private pops: Pop[] = [];
  private proj = { x: 0, y: 0, scale: 1 };

  constructor(
    private container: HTMLElement,
    private globe: GlobeRenderer,
  ) {}

  spawn(tile: TileRef, gold: number, troops = 0): void {
    const el = document.createElement("div");
    el.className = troops > 0 ? "gold-pop claim-pop" : "gold-pop";
    const bits: string[] = [];
    if (gold > 0) bits.push(`+${fmt(gold)}`);
    if (troops > 0) bits.push(`+${fmtTroops(troops)} troops`);
    if (!bits.length) return;
    el.textContent = bits.join("  ");
    this.container.appendChild(el);
    this.pops.push({ el, tile, born: performance.now(), life: troops > 0 ? 2200 : 1400 });
  }

  update(now: number): void {
    if (!this.pops.length) return;
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      const t = (now - p.born) / p.life;
      if (t >= 1) {
        p.el.remove();
        this.pops.splice(i, 1);
        continue;
      }
      if (!this.globe.projectTile(p.tile, this.proj)) {
        p.el.style.display = "none";
        continue;
      }
      const rise = 36 * t;
      p.el.style.display = "";
      p.el.style.opacity = String(1 - t);
      p.el.style.transform = `translate(-50%, -100%) translate(${this.proj.x}px, ${this.proj.y - 18 - rise}px) scale(${Math.max(0.9, this.proj.scale)})`;
    }
  }
}

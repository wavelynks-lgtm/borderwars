import type { Game } from "../core/Game";
import { unitLabel } from "../core/Game";
import type { Unit } from "../core/Unit";
import { h } from "../ui/dom";
import { iconImg } from "../ui/icons";
import type { GlobeRenderer } from "./GlobeRenderer";

interface Entry {
  el: HTMLElement;
  bar: HTMLElement;
  time: HTMLElement;
}

/** "Building…" banner with a progress bar above each of the local player's unfinished structures. */
export class BuildLabels {
  private entries = new Map<Unit, Entry>();
  private proj = { x: 0, y: 0, scale: 1 };

  constructor(
    private container: HTMLElement,
    private globe: GlobeRenderer,
    private game: Game,
  ) {}

  update(): void {
    const game = this.game;
    const human = game.human;
    if (!human) return;
    const seen = new Set<Unit>();
    for (const u of human.units) {
      if (!u.active || !u.constructing) continue;
      seen.add(u);
      let e = this.entries.get(u);
      if (!e) {
        const bar = h("div", { class: "build-label-fill" });
        const time = h("span", { class: "build-label-time" });
        const el = h(
          "div",
          { class: "build-label" },
          h("div", { class: "build-label-row" }, iconImg(u.type, 16), h("span", {}, `Building ${unitLabel(u.type)}`), time),
          h("div", { class: "build-label-track" }, bar),
        );
        this.container.appendChild(el);
        e = { el, bar, time };
        this.entries.set(u, e);
      }
      if (!this.globe.projectTile(u.tile, this.proj) || this.proj.scale < 0.7) {
        e.el.style.display = "none";
        continue;
      }
      const total = Math.max(1, u.readyAt - u.createdAt);
      const done = Math.min(1, Math.max(0, (game.ticks - u.createdAt) / total));
      const left = Math.max(0, u.readyAt - game.ticks) / 10;
      e.bar.style.width = `${(done * 100).toFixed(1)}%`;
      e.time.textContent = `${left.toFixed(left < 10 ? 1 : 0)}s`;
      e.el.style.display = "";
      e.el.style.transform = `translate(-50%, -100%) translate(${this.proj.x}px, ${this.proj.y - 26 * this.proj.scale}px)`;
    }
    for (const [u, e] of this.entries) {
      if (!seen.has(u)) {
        e.el.remove();
        this.entries.delete(u);
      }
    }
  }
}

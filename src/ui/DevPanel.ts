import type { Game } from "../core/Game";
import { unitLabel } from "../core/Game";
import { build } from "../core/actions";
import { UnitType } from "../core/types";
import { h } from "./dom";

/**
 * Cheat panel for local testing. Gold/troops, skip spawn, freeze AI, starter kit.
 * Toggle with ` (backtick). Shift-click the globe to paint land.
 */
export class DevPanel {
  readonly root: HTMLElement;

  constructor(
    container: HTMLElement,
    private game: Game,
    private flyTo: (tile: number) => void,
    private anyTile: () => number,
    private onSpeed: (n: number) => void,
  ) {
    const btn = (label: string, title: string, fn: () => void) =>
      h("button", { class: "dev-btn", title, onClick: fn }, label);

    this.root = h(
      "div",
      { class: "dev-panel glass" },
      h("div", { class: "dev-head" }, "DEV", h("span", { class: "muted" }, "` hide · shift-click paint")),
      h(
        "div",
        { class: "dev-grid" },
        btn("+10M gold", "Shift+G", () => this.gold(10_000_000)),
        btn("+100M gold", "", () => this.gold(100_000_000)),
        btn("+100K troops", "Shift+T", () => this.troops(100_000)),
        btn("+1M troops", "", () => this.troops(1_000_000)),
        btn("Skip spawn", "Shift+N", () => this.skipSpawn()),
        btn("Freeze AI", "Stop AI attacking", () => this.toggleAi()),
        btn("Finish builds", "", () => this.finish()),
        btn("Starter kit", "City + factory + silo + SAM + radar + port", () => this.kit()),
        btn("Speed ×16", "", () => this.onSpeed(16)),
        btn("Speed ×1", "", () => this.onSpeed(1)),
      ),
    );
    container.appendChild(this.root);
  }

  private p() {
    return this.game.human!;
  }

  private gold(n: number): void {
    this.p().gold += n;
    this.game.displayMessage(`DEV +${(n / 1e6).toFixed(0)}M gold`);
  }
  private troops(n: number): void {
    this.p().addTroops(n);
    this.game.displayMessage(`DEV +${n.toLocaleString()} troops`);
  }
  private skipSpawn(): void {
    const p = this.p();
    if (!p.hasSpawned) {
      const t = this.game.randomSpawnTile(p);
      if (t >= 0) {
        this.game.spawnPlayer(p, t);
        this.flyTo(t);
      }
    }
    this.game.skipSpawnPhase();
    this.game.displayMessage("DEV spawn phase skipped");
  }
  private toggleAi(): void {
    this.game.devFreezeAi = !this.game.devFreezeAi;
    this.root.classList.toggle("ai-off", this.game.devFreezeAi);
    this.game.displayMessage(this.game.devFreezeAi ? "DEV AI frozen" : "DEV AI running");
  }
  private finish(): void {
    this.game.finishConstruction();
    this.game.displayMessage("DEV construction finished");
  }
  private kit(): void {
    const p = this.p();
    if (!p.hasSpawned) this.skipSpawn();
    const land = this.anyTile();
    if (land < 0) return;
    const types: UnitType[] = [UnitType.City, UnitType.Factory, UnitType.MissileSilo, UnitType.SAMLauncher, UnitType.Radar];
    for (const t of types) {
      const r = build(this.game, p, t, land, true);
      if (!r.ok) this.game.displayMessage(`DEV kit ${unitLabel(t)}: ${r.message}`);
    }
    const shore = this.game.shoreTiles(p);
    if (shore.length) {
      const r = build(this.game, p, UnitType.Port, shore[0], true);
      if (!r.ok) this.game.displayMessage(`DEV kit Dock: ${r.message}`);
    }
    this.flyTo(land);
    this.game.displayMessage(`DEV kit: ${types.map(unitLabel).join(", ")} + Dock`);
  }

  handleKey(e: KeyboardEvent): boolean {
    if (e.key === "`" || e.code === "Backquote") {
      e.preventDefault();
      this.toggle();
      return true;
    }
    if (!e.shiftKey) return false;
    if (e.key === "G" || e.key === "g") {
      this.gold(10_000_000);
      return true;
    }
    if (e.key === "T" || e.key === "t") {
      this.troops(100_000);
      return true;
    }
    if (e.key === "N" || e.key === "n") {
      this.skipSpawn();
      return true;
    }
    return false;
  }

  toggle(): void {
    this.root.classList.toggle("hidden");
  }
}

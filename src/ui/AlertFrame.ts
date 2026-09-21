import type { Game } from "../core/Game";
import { unitLabel } from "../core/Game";
import type { Unit } from "../core/Unit";
import { NUKES, PlayerType, UnitType } from "../core/types";
import { h } from "./dom";

const NUKE_RANK: Record<string, number> = {
  [UnitType.HydrogenBomb]: 4,
  [UnitType.MIRV]: 3,
  [UnitType.MIRVWarhead]: 2,
  [UnitType.AtomBomb]: 1,
};

/**
 * Screen flash for the local player:
 *  - red while a land attack is hitting them
 *  - yellow + centered warning while a missile is inbound (dismissable)
 */
export class AlertFrame {
  readonly el: HTMLElement;
  private frame: HTMLElement;
  private banner: HTMLElement;
  private kicker: HTMLElement;
  private title: HTMLElement;
  private sub: HTMLElement;
  private closeBtn: HTMLButtonElement;
  private kind: "attack" | "nuke" | "betrayal" | null = null;
  private bannerKey = "";
  private betrayalUntil = 0;
  /** inbound-nuke signature the player dismissed; cleared when that wave ends */
  private dismissedSig = "";
  private lastScan = 0;

  constructor(
    container: HTMLElement,
    private game: Game,
  ) {
    this.kicker = h("div", { class: "alert-banner-kicker" }, "INCOMING");
    this.title = h("div", { class: "alert-banner-title" }, "NUKE");
    this.sub = h("div", { class: "alert-banner-sub" });
    this.closeBtn = h("button", { class: "alert-banner-close", type: "button", title: "Dismiss" }, "×") as HTMLButtonElement;
    this.closeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.dismissNuke();
    });
    this.banner = h("div", { class: "alert-banner" }, this.closeBtn, this.kicker, this.title, this.sub);
    this.frame = h("div", { class: "alert-wash" });
    this.el = h("div", { class: "alert-root" }, this.frame, this.banner);
    container.appendChild(this.el);
    const prevBreak = game.onAllianceBroken;
    game.onAllianceBroken = (breaker, other) => {
      prevBreak?.(breaker, other);
      if (other === game.human) {
        this.betrayalUntil = performance.now() + 3200;
        this.setKind("betrayal");
      }
    };
  }

  tick(now = performance.now()): void {
    if (now - this.lastScan < 100) return;
    this.lastScan = now;
    const game = this.game;
    const me = game.human;
    if (!me || !me.alive) {
      this.dismissedSig = "";
      this.setKind(null);
      return;
    }
    if (now < this.betrayalUntil && this.kind === "betrayal") return;

    const inbound: Unit[] = [];
    for (const u of game.units) {
      if (!NUKES.has(u.type) || !u.active || u.owner === me) continue;
      if (u.targetTile >= 0 && game.map.owner[u.targetTile] === me.smallID) inbound.push(u);
    }
    if (inbound.length) {
      inbound.sort((a, b) => (NUKE_RANK[b.type] ?? 0) - (NUKE_RANK[a.type] ?? 0) || a.id - b.id);
      const sig = inbound.map((u) => u.id).join(",");
      if (sig === this.dismissedSig) {
        this.setKind(null);
        this.setBanner("", "", "");
        return;
      }
      if (this.dismissedSig && !this.dismissedSig.split(",").includes(String(inbound[0].id))) {
        this.dismissedSig = "";
      }
      const worst = inbound[0];
      const n = inbound.length;
      const who = worst.owner.name;
      this.setKind("nuke");
      this.setBanner(
        n > 1 ? `${n} INCOMING` : "INCOMING",
        unitLabel(worst.type).toUpperCase(),
        n > 1 ? `${who} · missiles inbound` : `${who} launched at your land`,
      );
      return;
    }
    this.dismissedSig = "";

    const minTroops = me.troops / 8;
    for (const a of me.incomingAttacks) {
      if (a.retreated()) continue;
      if (a.owner.type === PlayerType.Bot && a.troops() < minTroops) continue;
      this.setKind("attack");
      this.setBanner("", "", "");
      return;
    }
    this.setKind(null);
    this.setBanner("", "", "");
  }

  private dismissNuke(): void {
    const ids: number[] = [];
    const me = this.game.human;
    if (me) {
      for (const u of this.game.units) {
        if (!NUKES.has(u.type) || !u.active || u.owner === me) continue;
        if (u.targetTile >= 0 && this.game.map.owner[u.targetTile] === me.smallID) ids.push(u.id);
      }
    }
    ids.sort((a, b) => a - b);
    this.dismissedSig = ids.join(",");
    this.setKind(null);
    this.setBanner("", "", "");
  }

  private setKind(kind: "attack" | "nuke" | "betrayal" | null): void {
    if (kind === this.kind) return;
    this.kind = kind;
    this.el.className = kind ? `alert-root ${kind}` : "alert-root";
    this.frame.className = kind ? `alert-wash ${kind}` : "alert-wash";
  }

  private setBanner(kicker: string, title: string, sub: string): void {
    const key = `${kicker}|${title}|${sub}`;
    if (key === this.bannerKey) return;
    this.bannerKey = key;
    this.kicker.textContent = kicker;
    this.title.textContent = title;
    this.sub.textContent = sub;
  }
}

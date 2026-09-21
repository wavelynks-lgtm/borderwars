import type { Game } from "../core/Game";
import { unitLabel } from "../core/Game";
import type { Player } from "../core/Player";
import type { Unit } from "../core/Unit";
import { fmt, fmtTroops } from "../core/executions/AttackExecution";
import { PlayerType, UnitType } from "../core/types";
import { UNIT_DESC } from "./BuildBar";
import { EMOJIS } from "./Hud";
import { clear, h } from "./dom";
import { iconImg, namedIcon } from "./icons";

export interface PlayerPanelCallbacks {
  onAttack(p: Player): void;
  onBoat(p: Player): void;
  onRequestAlliance(p: Player): void;
  onBreakAlliance(p: Player): void;
  onExtendAlliance(p: Player): void;
  onDonateTroops(p: Player): void;
  onDonateGold(p: Player): void;
  onEmbargo(p: Player, on: boolean): void;
  onEmbargoAll(on: boolean): void;
  onEmoji(p: Player, e: string): void;
  onFlyTo(p: Player): void;
  onTarget(p: Player): void;
}

export interface StructurePanelCallbacks {
  onUpgrade(u: Unit): void;
  onDelete(u: Unit): void;
}

const REL = ["Hostile", "Distrustful", "Neutral", "Friendly"];

export class PlayerPanel {
  private el: HTMLElement | null = null;
  private player: Player | null = null;
  constructor(
    private container: HTMLElement,
    private game: Game,
    private cb: PlayerPanelCallbacks,
  ) {}

  open(p: Player): void {
    this.close();
    this.player = p;
    this.el = h("div", { class: "panel glass player-panel" });
    this.container.appendChild(this.el);
    this.render();
  }

  render(): void {
    const p = this.player;
    const el = this.el;
    if (!p || !el) return;
    const game = this.game;
    const human = game.human!;
    clear(el);
    const rel = p.relation(human);
    const allied = human.isAlliedWith(p);
    const alliance = human.allianceWith(p);
    const isMe = p === human;
    const kind = p.isHuman() ? "Player" : "AI";
    const embargoed = human.embargoes.has(p.smallID);
    const left = alliance ? Math.ceil((alliance.expiresAt - game.ticks) / 10) : 0;
    const expiring = allied && left <= 30;
    const stat = (label: string, value: string | Node) => h("div", { class: "kv" }, h("span", { class: "k" }, label), h("span", { class: "v" }, value));
    el.append(
      h(
        "div",
        { class: "panel-title" },
        h("span", { class: "swatch lg", style: `background:${p.color}` }),
        h("span", { class: "title-text" }, p.name, h("span", { class: "muted" }, ` ${kind}`)),
        h("button", { class: "close", onClick: () => this.close() }, "×"),
      ),
      h(
        "div",
        { class: "kv-list" },
        stat("Land", `${game.landPercent(p).toFixed(2)}% · ${p.numTiles.toLocaleString()} tiles`),
        stat("Troops", h("span", { class: "icon-stat" }, namedIcon("troops", 14), `${fmtTroops(p.troops)} · ${fmtTroops(p.workers)} workers`)),
        stat("Gold", h("span", { class: "icon-stat" }, namedIcon("gold", 14), fmt(p.gold))),
        stat(
          "Buildings",
          h(
            "span",
            { class: "unit-counts" },
            ...[UnitType.City, UnitType.Factory, UnitType.DefensePost, UnitType.Port, UnitType.MissileSilo, UnitType.SAMLauncher, UnitType.Radar].map((t) =>
              p.unitLevels(t) > 0 ? h("span", { class: "uc" }, iconImg(t, 16), String(p.unitLevels(t))) : null,
            ),
            [UnitType.City, UnitType.Factory, UnitType.DefensePost, UnitType.Port, UnitType.MissileSilo, UnitType.SAMLauncher, UnitType.Radar].every((t) => p.unitLevels(t) === 0) ? "none" : null,
          ),
        ),
        !isMe && p.type !== PlayerType.Bot ? stat("Attitude", h("b", { class: `rel-${rel}` }, REL[rel])) : null,
        p.isTraitor(game.ticks) ? h("div", { class: "pill warn" }, "☠ Traitor") : null,
        allied && alliance ? h("div", { class: expiring ? "pill warn" : "pill ok" }, namedIcon("alliance", 14), `Allied · ${left}s left`) : null,
        p.embargoes.has(human.smallID) ? h("div", { class: "pill muted" }, namedIcon("embargo", 14), "Embargo against you") : null,
        embargoed ? h("div", { class: "pill muted" }, namedIcon("embargo", 14), "You embargoed them") : null,
      ),
    );
    if (isMe && p.alive) {
      const mine = h("div", { class: "actions" });
      mine.append(
        h("button", { class: "btn", onClick: () => this.cb.onEmbargoAll(true) }, namedIcon("embargo", 14), "Embargo all"),
        h("button", { class: "btn", onClick: () => this.cb.onEmbargoAll(false) }, namedIcon("embargo", 14), "Lift all embargoes"),
      );
      el.append(mine);
      return;
    }
    if (!isMe && p.alive) {
      const actions = h("div", { class: "actions" });
      actions.append(h("button", { class: "btn", onClick: () => this.cb.onFlyTo(p) }, "Locate"));
      if (!allied) {
        actions.append(h("button", { class: "btn btn-danger", onClick: () => this.cb.onAttack(p) }, `Attack · ${fmtTroops(human.troops * human.attackRatio)}`));
        actions.append(h("button", { class: "btn", onClick: () => this.cb.onBoat(p) }, namedIcon("boat", 14), "Send boat"));
        if (p.type !== PlayerType.Bot) {
          const pending = p.incomingAllianceRequests.some((r) => r.requestor === human && r.status === "pending");
          actions.append(h("button", { class: "btn btn-primary", disabled: pending, onClick: () => this.cb.onRequestAlliance(p) }, namedIcon("alliance", 14), pending ? "Request sent" : "Request alliance"));
        }
        actions.append(
          h(
            "button",
            { class: "btn", onClick: () => this.cb.onEmbargo(p, !embargoed) },
            namedIcon("embargo", 14),
            embargoed ? "Lift embargo" : "Embargo",
          ),
        );
      } else {
        actions.append(h("button", { class: "btn", onClick: () => this.cb.onDonateTroops(p) }, namedIcon("donate-troops", 14), `Donate ⅓ troops · ${fmtTroops(human.troops / 3)}`));
        actions.append(h("button", { class: "btn", onClick: () => this.cb.onDonateGold(p) }, namedIcon("donate-gold", 14), `Donate ⅓ gold · ${fmt(human.gold / 3)}`));
        if (expiring) {
          actions.append(h("button", { class: "btn btn-primary", onClick: () => this.cb.onExtendAlliance(p) }, namedIcon("alliance", 14), "Extend alliance"));
        }
        actions.append(h("button", { class: "btn btn-danger", onClick: () => this.cb.onBreakAlliance(p) }, "Break alliance"));
      }
      actions.append(
        h(
          "button",
          { class: "btn" + (human.targetPlayer === p.smallID ? " active" : ""), onClick: () => this.cb.onTarget(p) },
          namedIcon("target", 14),
          human.targetPlayer === p.smallID ? "Untarget" : "Mark target",
        ),
      );
      el.append(actions);
      if (p.type !== PlayerType.Bot) {
        el.append(h("div", { class: "emoji-row" }, ...EMOJIS.map((e) => h("button", { class: "emoji", onClick: () => this.cb.onEmoji(p, e) }, e))));
      }
    }
  }

  current(): Player | null {
    return this.player;
  }
  close(): void {
    this.el?.remove();
    this.el = null;
    this.player = null;
  }
  isOpen(): boolean {
    return this.el !== null;
  }
}

export class StructurePanel {
  private el: HTMLElement | null = null;
  constructor(
    private container: HTMLElement,
    private game: Game,
    private cb: StructurePanelCallbacks,
  ) {}
  open(u: Unit, x: number, y: number): void {
    this.close();
    const cfg = this.game.config;
    const max = cfg.maxLevel(u.type);
    const cost = cfg.upgradeCost(u.type, u.level);
    const mine = u.owner === this.game.human;
    const marked = u.deleteAt >= 0;
    const left = marked ? Math.max(0, Math.ceil((u.deleteAt - this.game.ticks) / 10)) : 0;
    const el = h(
      "div",
      { class: "panel glass structure-panel" },
      h(
        "div",
        { class: "panel-title" },
        iconImg(u.type, 26),
        h("span", { class: "title-text" }, unitLabel(u.type), u.level > 1 ? ` ×${u.level}` : "", h("span", { class: "muted" }, ` · ${u.owner.name}`)),
        h("button", { class: "close", onClick: () => this.close() }, "×"),
      ),
      h(
        "div",
        { class: "kv-list" },
        h("div", { class: "kv" }, h("span", { class: "k" }, "Level"), h("span", { class: "v" }, `${u.level}${max > 1 ? ` / ${max}` : ""}`)),
        marked ? h("div", { class: "pill warn" }, `Demolition in ${left}s`) : null,
        h("div", { class: "muted small" }, UNIT_DESC[u.type]),
      ),
      mine && u.level < max && cost > 0
        ? h(
            "button",
            {
              class: "btn btn-primary",
              onClick: () => {
                this.cb.onUpgrade(u);
                this.close();
              },
            },
            `Upgrade · ${fmt(cost)} ◈`,
          )
        : null,
      mine
        ? h(
            "button",
            {
              class: "btn btn-danger",
              onClick: () => {
                this.cb.onDelete(u);
                this.close();
              },
            },
            marked ? "Cancel demolition" : "Delete structure",
          )
        : null,
    );
    el.style.left = Math.min(x, window.innerWidth - 300) + "px";
    el.style.top = Math.min(y, window.innerHeight - 220) + "px";
    this.container.appendChild(el);
    this.el = el;
  }
  close(): void {
    this.el?.remove();
    this.el = null;
  }
}

export function showEndScreen(container: HTMLElement, game: Game, won: boolean, onSpectate: () => void, onRestart: () => void): void {
  const human = game.human!;
  const s = human.stats;
  const secs = Math.floor(game.elapsedSeconds());
  const stat = (label: string, value: string) => h("div", { class: "end-stat" }, h("div", { class: "end-value" }, value), h("div", { class: "end-label" }, label));
  const el = h(
    "div",
    { class: "menu end-screen" },
    h(
      "div",
      { class: "menu-card glass" },
      h("div", { class: won ? "end-badge win" : "end-badge lose" }, won ? "Victory" : "Defeat"),
      h("p", { class: "menu-sub" }, won ? `You control ${game.landPercent(human).toFixed(1)}% of the world.` : game.winner ? `${game.winner.name} conquered the world.` : "Your nation has fallen."),
      h(
        "div",
        { class: "end-grid" },
        stat("Time", `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`),
        stat("Tiles taken", s.tilesConquered.toLocaleString()),
        stat("Troops killed", fmtTroops(s.troopsKilled)),
        stat("Troops lost", fmtTroops(s.troopsLost)),
        stat("Nations conquered", String(s.playersKilled)),
        stat("Gold earned", fmt(s.goldEarned)),
        stat("Nukes launched", String(s.nukesLaunched)),
      ),
      h(
        "div",
        { class: "actions end" },
        h(
          "button",
          {
            class: "btn",
            onClick: () => {
              el.remove();
              onSpectate();
            },
          },
          "Keep watching",
        ),
        h("button", { class: "btn btn-primary", onClick: onRestart }, "Play again"),
      ),
    ),
  );
  container.appendChild(el);
}

import type { Game } from "../core/Game";
import type { Player } from "../core/Player";
import type { AttackExecution } from "../core/executions/AttackExecution";
import { fmt, fmtTroops } from "../core/executions/AttackExecution";
import { MessageType, PlayerType, UnitType, type GameEvent } from "../core/types";
import { clear, h } from "./dom";
import { namedIcon } from "./icons";

export interface HudCallbacks {
  onRetreat(attackId: number): void;
  onRetreatBoat(unitId: number): void;
  onAcceptAlliance(requestId: number): void;
  onRejectAlliance(requestId: number): void;
  onExtendAlliance(playerId: number): void;
  onSelectPlayer(p: Player): void;
  onAttackRatio(v: number): void;
  onTroopRatio(v: number): void;
  onEmoji(emoji: string): void;
  onTogglePause(): void;
  onFocusAttack(a: AttackExecution): void;
  onRetaliate(a?: AttackExecution): void;
  onHideUi(): void;
}

interface EventItem {
  ev: GameEvent;
  el: HTMLElement;
  expires: number;
}

export const EMOJIS = ["👋", "🤝", "😡", "😂", "🙏", "⚔️", "🏳️", "💀", "🔥", "👑", "🍕", "🌍"];

export class Hud {
  readonly root: HTMLElement;
  private timer: HTMLElement;
  private progress: HTMLElement;
  private progressBar: HTMLElement;
  private leaderboard: HTMLElement;
  private popBar: HTMLElement;
  private popText: HTMLElement;
  private goldText: HTMLElement;
  private growthText: HTMLElement;
  private attackSlider: HTMLInputElement;
  private attackLabel: HTMLElement;
  private troopSlider: HTMLInputElement;
  private troopLabel: HTMLElement;
  private events: HTMLElement;
  private attacksBox: HTMLElement;
  private eventItems: EventItem[] = [];
  private eventCursor = 0;
  private pauseBtn: HTMLElement;
  private spawnHint: HTMLElement;
  private modeHint: HTMLElement;
  private emojiPop: HTMLElement;

  constructor(
    container: HTMLElement,
    private game: Game,
    private cb: HudCallbacks,
  ) {
    const human = game.human!;
    this.timer = h("div", { class: "hud-timer" });
    this.progress = h("div", { class: "hud-progress" });
    this.progressBar = h("div", { class: "hud-goal-fill" });
    this.pauseBtn = h("button", { class: "icon-btn", onClick: () => cb.onTogglePause(), title: "Pause (P)" }, pauseIcon());
    const hideBtn = h("button", { class: "icon-btn", onClick: () => cb.onHideUi(), title: "Hide UI (\\)" }, "▭");
    if(game.online){this.pauseBtn.setAttribute("disabled","");this.pauseBtn.title="Online matches run at server speed";}
    const topKids: Node[] = [this.timer, h("div", { class: "hud-goal" }, this.progress, h("div", { class: "hud-goal-track" }, this.progressBar)), this.pauseBtn, hideBtn];
    if (game.isDev()) topKids.splice(2, 0, h("span", { class: "dev-badge", title: "` toggle cheats" }, "DEV"));
    const top = h("div", { class: "hud-top glass" }, ...topKids);
    this.spawnHint = h(
      "div",
      { class: "spawn-hint glass" },
      h("span", { class: "dot" }),
      game.isDev()
        ? "Click land to spawn · ` cheats · Shift+N skip spawn · Shift-click paint"
        : "Click on land to choose where your nation starts",
    );
    this.modeHint = h("div", { class: "spawn-hint mode glass", style: "display:none" });

    this.leaderboard = h("div", { class: "panel glass leaderboard" });

    this.popBar = h("div", { class: "popbar" }, h("div", { class: "popbar-troops" }), h("div", { class: "popbar-workers" }));
    this.popText = h("div", { class: "stat-row" });
    this.goldText = h("div", { class: "stat-value gold" });
    this.growthText = h("div", { class: "stat-sub" });
    this.attackSlider = h("input", { type: "range", min: 1, max: 100, value: Math.round(human.attackRatio * 100) });
    this.attackLabel = h("span", { class: "slider-value" });
    this.attackSlider.oninput = () => cb.onAttackRatio(Number(this.attackSlider.value) / 100);
    this.troopSlider = h("input", { type: "range", min: 5, max: 95, value: Math.round(human.targetTroopRatio * 100) });
    this.troopLabel = h("span", { class: "slider-value" });
    this.troopSlider.oninput = () => cb.onTroopRatio(Number(this.troopSlider.value) / 100);

    this.emojiPop = h(
      "div",
      { class: "emoji-pop glass" },
      ...EMOJIS.map((e) =>
        h(
          "button",
          {
            class: "emoji",
            onClick: () => {
              cb.onEmoji(e);
              this.emojiPop.classList.remove("open");
            },
          },
          e,
        ),
      ),
    );
    const emojiBtn = h("button", { class: "icon-btn", title: "Quick chat", onClick: () => this.emojiPop.classList.toggle("open") }, "😀");

    const control = h(
      "div",
      { class: "panel glass control" },
      h("div", { class: "control-head" }, h("span", { class: "swatch", style: `background:${human.color}` }), h("span", { class: "control-title" }, `${human.flag?human.flag+" ":""}${human.name}${human.cosmetics.badge==='supporter'?" ★":""}`), emojiBtn),
      this.popBar,
      this.popText,
      h("div", { class: "stat-grid" }, h("div", {}, h("div", { class: "stat-label" }, "Gold"), this.goldText), h("div", {}, h("div", { class: "stat-label" }, "Growth"), this.growthText)),
      h("div", { class: "slider-row" }, h("div", { class: "slider-head" }, h("label", {}, "Attack ratio"), this.attackLabel), this.attackSlider),
      h("div", { class: "slider-row" }, h("div", { class: "slider-head" }, h("label", {}, "Troops / Workers"), this.troopLabel), this.troopSlider),
      this.emojiPop,
    );

    this.attacksBox = h("div", { class: "panel glass attacks" });
    this.events = h("div", { class: "events" });
    const right = h("div", { class: "right-column" }, this.leaderboard, this.attacksBox);

    this.root = h("div", { class: "hud" }, top, this.spawnHint, this.modeHint, control, right, this.events);
    container.appendChild(this.root);
  }

  /** persistent banner under the top bar while in build/target mode */
  setMode(text: string | null, hint = "right-click or Esc to cancel"): void {
    if (!text) {
      this.modeHint.style.display = "none";
      return;
    }
    this.modeHint.replaceChildren(h("span", { class: "dot" }), text, h("span", { class: "muted" }, hint));
    this.modeHint.style.display = "";
  }

  setPaused(p: boolean): void {
    this.pauseBtn.replaceChildren(p ? playIcon() : pauseIcon());
    this.root.classList.toggle("paused", p);
  }

  syncSliders(): void {
    const human = this.game.human!;
    this.attackSlider.value = String(Math.round(human.attackRatio * 100));
    this.troopSlider.value = String(Math.round(human.targetTroopRatio * 100));
  }

  update(): void {
    const game = this.game;
    const human = game.human!;
    const cfg = game.config;

    if (game.inSpawnPhase()) {
      this.timer.textContent = `Spawn ${Math.ceil(game.spawnPhaseTicksLeft() / 10)}s`;
      this.spawnHint.style.display = human.hasSpawned ? "none" : "";
    } else {
      const cap = cfg.settings.maxTimerMinutes;
      if (cap > 0) {
        const left = Math.max(0, Math.floor(cap * 60 - game.elapsedSeconds()));
        this.timer.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
      } else {
        const s = Math.floor(game.elapsedSeconds());
        this.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      }
      this.spawnHint.style.display = "none";
    }
    const alive = game.alivePlayers().sort((a, b) => b.landArea - a.landArea);
    const leader = alive[0];
    const you = game.landPercent(human);
    this.progress.textContent = leader ? `You ${you.toFixed(1)}% · ${leader === human ? "You lead" : `${leader.name} ${game.landPercent(leader).toFixed(1)}%`} · Goal ${cfg.winPercent()}%` : "";
    this.progressBar.style.width = `${Math.min(100, (you / cfg.winPercent()) * 100)}%`;

    const max = cfg.maxPopulation(human);
    const tr = (human.troops / max) * 100;
    const wr = (human.workers / max) * 100;
    (this.popBar.children[0] as HTMLElement).style.width = Math.min(100, tr) + "%";
    (this.popBar.children[1] as HTMLElement).style.width = Math.max(0, Math.min(100 - tr, wr)) + "%";
    this.popText.replaceChildren(
      h("span", { class: "c-troops" }, namedIcon("troops", 14), h("b", {}, fmtTroops(human.troops)), " troops"),
      h("span", { class: "c-workers" }, namedIcon("workers", 14), h("b", {}, fmtTroops(human.workers)), " workers"),
      h("span", { class: "muted" }, `max ${fmtTroops(max)}`),
    );
    this.goldText.replaceChildren(namedIcon("gold", 14), h("b", {}, fmt(human.gold)), h("span", { class: "muted" }, ` +${fmt(game.goldIncome(human) * 10)}/s`));
    this.growthText.replaceChildren(h("b", {}, `+${fmtTroops(cfg.populationIncrease(human) * 10)}`), h("span", { class: "muted" }, "/s"));
    this.attackLabel.textContent = `${Math.round(human.attackRatio * 100)}% · ${fmtTroops(human.troops * human.attackRatio)}`;
    this.troopLabel.title = "More workers increase gold income; more troops strengthen your army.";
    this.troopLabel.textContent = `${Math.round(human.targetTroopRatio * 100)} / ${Math.round(100 - human.targetTroopRatio * 100)}`;

    this.updateLeaderboard(alive);
    this.updateAttacks();
    this.drainEvents();
  }

  private updateLeaderboard(alive: Player[]): void {
    const game = this.game;
    const human = game.human!;
    const top = alive.slice(0, 8);
    if (human.alive && !top.includes(human)) top.push(human);
    clear(this.leaderboard);
    this.leaderboard.append(h("div", { class: "panel-title" }, "Leaderboard", h("span", { class: "muted" }, `${alive.length} alive`)));
    const list = h("div", { class: "lb-list" });
    const maxLand = Math.max(0.01, game.landPercent(alive[0] ?? human));
    top.forEach((p) => {
      const rank = alive.indexOf(p) + 1;
      const land = game.landPercent(p);
      list.append(
        h(
          "div",
          { class: "lb-row" + (p === human ? " me" : "") + (human.isAlliedWith(p) ? " ally" : "") + (p.type === PlayerType.Bot ? " bot" : ""), onClick: () => this.cb.onSelectPlayer(p) },
          h("span", { class: "lb-rank" }, String(rank)),
          h("span", { class: "swatch", style: `background:${p.color}` }),
          h("span", { class: "lb-name" }, `${p.flag?p.flag+" ":""}${p.name}${p.cosmetics.badge==='supporter'?" ★":""}`, p.isTraitor(game.ticks) ? " ☠" : ""),
          h("span", { class: "lb-troops" }, fmtTroops(p.troops)),
          h("span", { class: "lb-land" }, land.toFixed(1) + "%"),
          h("div", { class: "lb-bar", style: `width:${(land / maxLand) * 100}%; background:${p.color}` }),
        ),
      );
    });
    this.leaderboard.append(list);
  }

  private updateAttacks(): void {
    const human = this.game.human!;
    clear(this.attacksBox);
    const out = human.outgoingAttacks.filter((a) => a.isActive());
    const inc = human.incomingAttacks.filter((a) => a.isActive());
    const boats = human.units.filter((u) => u.type === UnitType.TransportShip && u.active);
    if (out.length === 0 && inc.length === 0 && boats.length === 0) {
      this.attacksBox.style.display = "none";
      return;
    }
    this.attacksBox.style.display = "";
    this.attacksBox.append(h("div", { class: "panel-title" }, "Battles"));
    const line = (a: AttackExecution, outgoing: boolean) =>
      h(
        "div",
        { class: "attack-line " + (outgoing ? "out" : "in"), onClick: () => this.cb.onFocusAttack(a) },
        h("span", { class: "attack-dir" }, outgoing ? "→" : "←"),
        h("span", { class: "attack-name" }, outgoing ? (a.target ? a.target.name : "Neutral land") : a.owner.name),
        h("b", { class: "attack-troops" }, fmtTroops(a.troops())),
        outgoing && !a.retreated()
          ? h(
              "button",
              {
                class: "btn btn-tiny",
                onClick: (e: Event) => {
                  e.stopPropagation();
                  this.cb.onRetreat(a.id);
                },
              },
              "Retreat",
            )
          : !outgoing
            ? h(
                "button",
                {
                  class: "btn btn-tiny btn-danger",
                  onClick: (e: Event) => {
                    e.stopPropagation();
                    this.cb.onRetaliate(a);
                  },
                },
                "Retaliate",
              )
            : null,
      );
    for (const a of out) this.attacksBox.append(line(a, true));
    for (const a of inc) this.attacksBox.append(line(a, false));
    for (const u of boats) {
      this.attacksBox.append(
        h(
          "div",
          { class: "attack-line out" },
          namedIcon("boat", 14),
          h("span", { class: "attack-name" }, u.retreatOrdered ? "Boat returning" : "Boat underway"),
          h("b", { class: "attack-troops" }, fmtTroops(u.troops)),
          !u.retreatOrdered
            ? h(
                "button",
                {
                  class: "btn btn-tiny",
                  onClick: (e: Event) => {
                    e.stopPropagation();
                    this.cb.onRetreatBoat(u.id);
                  },
                },
                "Retreat",
              )
            : null,
        ),
      );
    }
  }

  private drainEvents(): void {
    const game = this.game;
    const human = game.human!;
    const evs = game.events;
    for (; this.eventCursor < evs.length; this.eventCursor++) {
      const ev = evs[this.eventCursor];
      if (ev.to !== undefined && ev.to !== human.smallID) continue;
      if (ev.type === MessageType.AttackOutgoing) continue; // shown in the battles box
      this.addEvent(ev);
    }
    if (evs.length > 2000) {
      evs.splice(0, evs.length - 500);
      this.eventCursor = evs.length;
    }
    const now = performance.now();
    for (let i = this.eventItems.length - 1; i >= 0; i--) {
      const it = this.eventItems[i];
      let done = it.expires < now;
      if (it.ev.allianceRequestId !== undefined) {
        const still = human.incomingAllianceRequests.some((r) => r.id === it.ev.allianceRequestId && r.status === "pending");
        done = !still;
      } else if (it.ev.type === MessageType.Alliance && it.ev.from !== undefined) {
        const other = this.game.player(it.ev.from);
        const a = other ? human.allianceWith(other) : null;
        done = !a || a.expiresAt - this.game.ticks > 30 * 10 + 20;
      }
      if (done) {
        it.el.classList.add("out");
        const el = it.el;
        setTimeout(() => el.remove(), 250);
        this.eventItems.splice(i, 1);
      }
    }
  }

  private addEvent(ev: GameEvent): void {
    const el = h("div", { class: `event glass ${ev.type}` });
    const from = ev.from !== undefined ? this.game.player(ev.from) : null;
    if (from) el.append(h("span", { class: "swatch", style: `background:${from.color}` }));
    el.append(h("span", { class: "event-text" }, ev.text));
    let life = 9000;
    if (ev.text.startsWith("Claimed ")) {
      life = 14000;
      el.classList.add("claim");
    }
    if (ev.allianceRequestId !== undefined) {
      life = 1e12;
      el.append(
        h(
          "div",
          { class: "event-actions" },
          h("button", { class: "btn btn-tiny btn-primary", onClick: () => this.cb.onAcceptAlliance(ev.allianceRequestId!) }, "Accept"),
          h("button", { class: "btn btn-tiny", onClick: () => this.cb.onRejectAlliance(ev.allianceRequestId!) }, "Decline"),
        ),
      );
    } else if (ev.type === MessageType.Alliance && ev.from !== undefined) {
      life = 1e12;
      el.append(
        h(
          "div",
          { class: "event-actions" },
          h("button", { class: "btn btn-tiny btn-primary", onClick: () => this.cb.onExtendAlliance(ev.from!) }, namedIcon("alliance", 12), "Extend"),
        ),
      );
    }
    if (ev.type === MessageType.Chat && ev.emoji) {
      el.classList.add("chat");
      life = 7000;
    }
    if (from && ev.type !== MessageType.Chat) {
      el.style.cursor = "pointer";
      el.onclick = () => this.cb.onSelectPlayer(from);
    }
    this.events.prepend(el);
    this.eventItems.push({ ev, el, expires: performance.now() + life });
    while (this.eventItems.length > 7) {
      const old = this.eventItems.find((i) => i.ev.allianceRequestId === undefined) ?? this.eventItems[0];
      old.el.remove();
      this.eventItems.splice(this.eventItems.indexOf(old), 1);
    }
  }

  toast(text: string, type: MessageType = MessageType.Info): void {
    this.addEvent({ tick: this.game.ticks, type, text });
  }

  destroy(): void {
    this.root.remove();
  }
}

function pauseIcon(): HTMLElement {
  return h("span", { class: "glyph", html: '<svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="1.5" width="3" height="9" rx="1" fill="currentColor"/><rect x="7" y="1.5" width="3" height="9" rx="1" fill="currentColor"/></svg>' });
}
function playIcon(): HTMLElement {
  return h("span", { class: "glyph", html: '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 1.5v9l7.5-4.5z" fill="currentColor"/></svg>' });
}

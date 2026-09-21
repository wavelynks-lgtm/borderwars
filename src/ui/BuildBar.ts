import type { Game } from "../core/Game";
import { unitLabel } from "../core/Game";
import { fmt } from "../core/executions/AttackExecution";
import { NUKES, UnitType } from "../core/types";
import { h } from "./dom";
import { iconImg } from "./icons";

export const UNIT_DESC: Record<UnitType, string> = {
  [UnitType.City]: "Speeds troop growth and adds 25K max pop per level. Click an existing City to stack; a neighboring tile places a new one.",
  [UnitType.Factory]: "Lays dual-rail tracks to Cities, Docks and Factories inside the white circle. Each City or Dock stop pays 10k gold (25k at a foreign station, 35k at an ally's); extra stops on the same trip also pay. Factory level spawns more trains.",
  [UnitType.DefensePost]: "Attackers inside the coverage circle lose 5× more troops and advance 3× slower. Hover a post to see its range.",
  [UnitType.Port]: "Coastal dock. Tiny ships sail the harbor; trade ships run to other docks for gold. Unlocks Warships.",
  [UnitType.MissileSilo]: "Launches Atom, Hydrogen and MIRV. 9 s reload.",
  [UnitType.SAMLauncher]: "Shoots down enemy missiles in its radius. Hover a placed SAM to see the circle. Each level (stack) intercepts one extra nuke before reload.",
  [UnitType.Radar]: "Covers nearby SAMs: 1.5× intercept range. Cheap early-warning dish.",
  [UnitType.Warship]: "Patrols the sea, shells enemy boats and warships, and captures trade ships. Click a warship then water to set its patrol.",
  [UnitType.TransportShip]: "",
  [UnitType.TradeShip]: "",
  [UnitType.Train]: "",
  [UnitType.AtomBomb]: "Wipes out everything within 2 tiles, damage up to 5. Leaves fallout, or floods the crater when Nuke flooding is enabled.",
  [UnitType.HydrogenBomb]: "Wipes out everything within 13 tiles, damage up to 17. Leaves fallout, or floods the crater when Nuke flooding is enabled.",
  [UnitType.MIRV]: "Splits into 18 warheads over the target. Each hits a small cluster. 25M+",
  [UnitType.MIRVWarhead]: "",
  [UnitType.Shell]: "Warship projectile.",
  [UnitType.SAMMissile]: "Homing SAM intercept.",
};

export const UNIT_HINT: Record<UnitType, string> = {
  [UnitType.City]: "Place on a neighboring tile, or click an existing City to stack. White circle is rail range to a Factory.",
  [UnitType.Factory]: "Place on a neighboring tile. White circle is rail range to Cities and Docks.",
  [UnitType.Port]: "Place on your coast. White circle is rail range.",
  [UnitType.DefensePost]: "Place on your land, away from existing Defense Posts.",
  [UnitType.MissileSilo]: "Place on your land. Click an existing Silo to stack.",
  [UnitType.SAMLauncher]: "Place on your land. Hover to see intercept range. Stack for extra shots.",
  [UnitType.Radar]: "Place on your land. Click an existing Radar to stack.",
  [UnitType.Warship]: "Deploy on the sea",
  [UnitType.TransportShip]: "",
  [UnitType.TradeShip]: "",
  [UnitType.Train]: "",
  [UnitType.AtomBomb]: "Pick a target on land",
  [UnitType.HydrogenBomb]: "Pick a target on land",
  [UnitType.MIRV]: "Pick a target on land — warheads scatter around it",
  [UnitType.MIRVWarhead]: "",
  [UnitType.Shell]: "",
  [UnitType.SAMMissile]: "",
};

const ITEMS: UnitType[] = [
  UnitType.City,
  UnitType.Factory,
  UnitType.DefensePost,
  UnitType.Port,
  UnitType.MissileSilo,
  UnitType.SAMLauncher,
  UnitType.Radar,
  UnitType.Warship,
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
  UnitType.MIRV,
];

const KEYS: Record<string, UnitType> = {
  q: UnitType.City,
  f: UnitType.Factory,
  w: UnitType.DefensePost,
  e: UnitType.Port,
  r: UnitType.MissileSilo,
  t: UnitType.SAMLauncher,
  a: UnitType.Radar,
  y: UnitType.Warship,
  u: UnitType.AtomBomb,
  i: UnitType.HydrogenBomb,
  o: UnitType.MIRV,
};
const KEY_OF = new Map<UnitType, string>(Object.entries(KEYS).map(([k, v]) => [v, k.toUpperCase()]));

interface Item {
  type: UnitType;
  btn: HTMLButtonElement;
  cost: HTMLElement;
  count: HTMLElement;
}

/**
 * Floating bottom pill with every buildable unit. Clicking an item *buys* it (gold is taken
 * immediately) and arms placement mode; cancelling refunds, placing consumes the purchase.
 */
export class BuildBar {
  readonly root: HTMLElement;
  private items: Item[] = [];
  private tooltip: HTMLElement;
  private hovered: UnitType | null = null;
  private armed: UnitType | null = null;
  /** gold paid for the currently armed item (refunded on cancel) */
  private paid = 0;
  get purchaseCredit(): number { return this.paid; }

  constructor(
    container: HTMLElement,
    private game: Game,
    private onSelect: (type: UnitType | null) => void,
  ) {
    this.tooltip = h("div", { class: "build-tip" });
    this.root = h("div", { class: "build-bar" });
    const disableNukes = game.config.settings.disableNukes;
    for (const type of ITEMS) {
      if (disableNukes && NUKES.has(type)) continue;
      if (game.config.isUnitDisabled(type)) continue;
      const cost = h("span", { class: "bb-cost" });
      const count = h("span", { class: "bb-count" });
      const btn = h(
        "button",
        {
          class: "bb-item",
          onClick: () => this.toggle(type),
          onPointerenter: () => {
            this.hovered = type;
            this.renderTip();
          },
          onPointerleave: () => {
            this.hovered = null;
            this.renderTip();
          },
        },
        iconImg(type, 24),
        cost,
        count,
        h("span", { class: "bb-key" }, KEY_OF.get(type) ?? ""),
      ) as HTMLButtonElement;
      this.root.appendChild(btn);
      this.items.push({ type, btn, cost, count });
    }
    container.append(this.root, this.tooltip);
  }

  /** keyboard shortcut → unit type */
  static keyToType(key: string): UnitType | null {
    return KEYS[key.toLowerCase()] ?? null;
  }

  /** click / hotkey: buy the item, or cancel if it is the one already armed */
  toggle(type: UnitType): void {
    if (this.game.config.isUnitDisabled(type)) {
      this.game.displayMessage(`${unitLabel(type)} is disabled`);
      return;
    }
    if (this.armed === type) {
      this.cancel();
      return;
    }
    if (this.armed) this.cancel();
    const blocked = this.blocker(type);
    if (blocked) {
      const it = this.items.find((i) => i.type === type);
      if (it) {
        it.btn.classList.remove("shake");
        void it.btn.offsetWidth; // restart the animation
        it.btn.classList.add("shake");
      }
      this.hovered = type;
      this.renderTip();
      return;
    }
    const human = this.game.human!;
    const cost = this.game.isDev() ? 0 : this.game.config.unitCost(type, this.game.ownedForCost(human, type));
    if (cost > 0 && !this.game.online) human.removeGold(cost);
    this.paid = this.game.online ? 0 : cost;
    this.armed = type;
    this.refreshActive();
    this.onSelect(type);
  }

  /** placement aborted: give the gold back */
  cancel(): void {
    if (!this.armed) return;
    if (this.paid > 0) this.game.human!.gold += this.paid; // not addGold: a refund is not income
    this.paid = 0;
    this.armed = null;
    this.refreshActive();
    this.onSelect(null);
  }

  /** the bought item was placed / launched */
  placed(): void {
    this.paid = 0;
    this.armed = null;
    this.refreshActive();
  }

  private refreshActive(): void {
    for (const it of this.items) it.btn.classList.toggle("active", it.type === this.armed);
  }

  current(): UnitType | null {
    return this.armed;
  }

  /** why the unit cannot be bought right now, independent of the tile (null = ok) */
  private blocker(type: UnitType): string | null {
    const human = this.game.human!;
    if (!human.hasSpawned) return "Pick your spawn first";
    if (!this.game.isDev() && this.game.inSpawnPhase()) return "Wait for spawn to end";
    if (!human.alive) return "You have no territory";
    if (!this.game.isDev()) {
      if (type === UnitType.Warship && human.unitCount(UnitType.Port) === 0) return "Requires a Dock";
      if (NUKES.has(type)) {
        const silos = human.unitsOf(UnitType.MissileSilo);
        if (!silos.length) return "Requires a Missile Silo";
        const done = silos.filter((s) => !s.constructing);
        if (!done.length) return "Silo still under construction";
        if (done.every((s) => s.cooldownUntil > this.game.ticks)) return "All silos are reloading";
      }
      const cost = this.game.config.unitCost(type, this.game.ownedForCost(human, type));
      if (human.gold < cost) return `Not enough gold (${fmt(cost - human.gold)} more)`;
    }
    return null;
  }

  update(): void {
    const human = this.game.human!;
    const cfg = this.game.config;
    for (const it of this.items) {
      const cost = cfg.unitCost(it.type, this.game.ownedForCost(human, it.type));
      it.cost.textContent = this.game.isDev() ? "FREE" : fmt(cost);
      const n = NUKES.has(it.type) ? 0 : human.unitLevels(it.type);
      it.count.textContent = n > 0 ? String(n) : "";
      it.count.style.display = n > 0 ? "" : "none";
      // the armed item is already paid for, so it never reads as blocked
      const blocked = this.armed !== it.type && this.blocker(it.type) !== null;
      it.btn.classList.toggle("disabled", blocked);
    }
    if (this.armed && !human.alive) this.cancel();
    this.root.classList.toggle("hidden", !human.alive && !this.game.inSpawnPhase());
    if (this.hovered) this.renderTip();
  }

  private renderTip(): void {
    const type = this.hovered;
    if (!type) {
      this.tooltip.classList.remove("show");
      return;
    }
    const human = this.game.human!;
    const cfg = this.game.config;
    const cost = cfg.unitCost(type, this.game.ownedForCost(human, type));
    const armed = this.armed === type;
    const blocked = armed ? null : this.blocker(type);
    const owned = NUKES.has(type) ? human.stats.nukesLaunched : human.unitLevels(type);
    const build = cfg.constructionTicks(type);
    this.tooltip.replaceChildren(
      h("div", { class: "tip-head" }, iconImg(type, 26), h("span", { class: "tip-name" }, unitLabel(type)), h("span", { class: "tip-cost" }, `${fmt(cost)} ◈`)),
      h("div", { class: "tip-desc" }, UNIT_DESC[type]),
      h(
        "div",
        { class: "tip-meta" },
        h("span", {}, NUKES.has(type) ? `${owned} launched` : owned > 1 ? `${owned} owned (levels)` : `${owned} owned`),
        h("span", {}, build > 0 ? `${build / 10}s to build` : UNIT_HINT[type]),
        KEY_OF.has(type) ? h("kbd", {}, KEY_OF.get(type)!) : null,
      ),
      ...(blocked ? [h("div", { class: "tip-block" }, blocked)] : []),
      ...(armed ? [h("div", { class: "tip-armed" }, `Bought · ${UNIT_HINT[type].toLowerCase()} · click again to refund`)] : []),
    );
    const it = this.items.find((i) => i.type === type)!;
    const r = it.btn.getBoundingClientRect();
    this.tooltip.style.left = `${r.left + r.width / 2}px`;
    this.tooltip.style.bottom = `${window.innerHeight - r.top + 12}px`;
    this.tooltip.classList.add("show");
  }
}

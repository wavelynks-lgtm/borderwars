import type { Game } from "../core/Game";
import type { AttackExecution } from "../core/executions/AttackExecution";
import { fmtTroops } from "../core/executions/AttackExecution";
import type { GlobeRenderer } from "./GlobeRenderer";

const POLL_MS = 200;
const ANIM_MS = 250;
/** snap instead of lerping when the front jumps farther than this (wrap / new theatre). */
const SNAP_TILES = 200;

interface Slot {
  el: HTMLElement;
  curX: number;
  curY: number;
  srcX: number;
  srcY: number;
  dstX: number;
  dstY: number;
  startMs: number;
}

interface Group {
  incoming: boolean;
  slot: Slot;
}

/**
 * Troop numbers on the fighting edge, only vs another player (not empty-land spread).
 * Polls the front every 200ms and eases the label there so it does not hop tile-to-tile.
 */
export class AttackLabels {
  private groups = new Map<string, Group>();
  private lastPoll = -1e9;
  private proj = { x: 0, y: 0, scale: 1 };

  constructor(
    private container: HTMLElement,
    private globe: GlobeRenderer,
    private game: Game,
  ) {}

  /** attack fronts (target tiles) for the territory highlight */
  fronts(): { out: Iterable<number>[]; inc: Iterable<number>[] } {
    const me = this.game.human!;
    return {
      out: me.outgoingAttacks.filter((a) => a.isActive() && a.target !== null).map((a) => a.frontTiles()),
      inc: me.incomingAttacks.filter((a) => a.isActive()).map((a) => a.frontTiles()),
    };
  }

  private groupKey(a: AttackExecution, incoming: boolean): string {
    if (incoming) return `in:${a.owner.smallID}`;
    return `out:${a.target!.smallID}`;
  }

  private lerpSlot(slot: Slot, now: number): void {
    const t = Math.min(1, (now - slot.startMs) / ANIM_MS);
    slot.curX = slot.srcX + (slot.dstX - slot.srcX) * t;
    slot.curY = slot.srcY + (slot.dstY - slot.srcY) * t;
  }

  private moveSlot(slot: Slot, x: number, y: number, now: number): void {
    this.lerpSlot(slot, now);
    let dx = x - slot.curX;
    const wrap = this.game.map.width;
    if (dx > wrap / 2) dx -= wrap;
    else if (dx < -wrap / 2) dx += wrap;
    const jump = Math.hypot(dx, y - slot.curY);
    if (jump > SNAP_TILES) {
      slot.curX = x;
      slot.curY = y;
      slot.srcX = x;
      slot.srcY = y;
      slot.dstX = x;
      slot.dstY = y;
      slot.startMs = now;
      return;
    }
    slot.srcX = slot.curX;
    slot.srcY = slot.curY;
    slot.dstX = slot.curX + dx;
    slot.dstY = y;
    slot.startMs = now;
  }

  private poll(now: number): void {
    const me = this.game.human;
    if (!me) return;
    const map = this.game.map;
    const buckets = new Map<string, { incoming: boolean; attacks: AttackExecution[] }>();
    const add = (a: AttackExecution, incoming: boolean) => {
      if (!a.isActive() || a.troops() < 10) return;
      if (!incoming && !a.target) return;
      const key = this.groupKey(a, incoming);
      let b = buckets.get(key);
      if (!b) {
        b = { incoming, attacks: [] };
        buckets.set(key, b);
      }
      b.attacks.push(a);
    };
    for (const a of me.outgoingAttacks) add(a, false);
    for (const a of me.incomingAttacks) add(a, true);

    const seen = new Set<string>();
    for (const [key, b] of buckets) {
      seen.add(key);
      let troops = 0;
      let best: AttackExecution | null = null;
      for (const a of b.attacks) {
        troops += a.troops();
        if (!best || a.troops() > best.troops()) best = a;
      }
      const t = best?.clusteredPositions()[0] ?? -1;
      if (t < 0) continue;
      const x = map.x(t) + 0.5;
      const y = map.y(t) + 0.5;

      let g = this.groups.get(key);
      if (!g) {
        const el = document.createElement("div");
        el.className = "attack-label " + (b.incoming ? "in" : "out");
        this.container.appendChild(el);
        g = {
          incoming: b.incoming,
          slot: { el, curX: x, curY: y, srcX: x, srcY: y, dstX: x, dstY: y, startMs: now },
        };
        this.groups.set(key, g);
      } else {
        this.moveSlot(g.slot, x, y, now);
      }

      g.slot.el.textContent = fmtTroops(troops);
    }

    for (const [key, g] of this.groups) {
      if (seen.has(key)) continue;
      g.slot.el.remove();
      this.groups.delete(key);
    }
  }

  update(now: number): void {
    if (now - this.lastPoll >= POLL_MS) {
      this.lastPoll = now;
      this.poll(now);
    }
    const canvas = this.globe.canvas;
    for (const g of this.groups.values()) {
      const s = g.slot;
      this.lerpSlot(s, now);
      const wrap = this.game.map.width;
      const px = ((s.curX % wrap) + wrap) % wrap;
      if (!this.globe.projectXY(px, s.curY, this.proj)) {
        if (s.el.style.display !== "none") s.el.style.display = "none";
        continue;
      }
      if (this.proj.x < -20 || this.proj.x > canvas.clientWidth + 20 || this.proj.y < -20 || this.proj.y > canvas.clientHeight + 20) {
        if (s.el.style.display !== "none") s.el.style.display = "none";
        continue;
      }
      if (s.el.style.display !== "block") s.el.style.display = "block";
      const sc = Math.max(0.95, Math.min(1.15, this.proj.scale));
      s.el.style.transform = `translate(-50%, -50%) translate3d(${this.proj.x.toFixed(1)}px, ${this.proj.y.toFixed(1)}px, 0) scale(${sc.toFixed(2)})`;
    }
  }
}

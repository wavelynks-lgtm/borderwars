import { namedIcon } from "./icons";
import { h } from "./dom";

export interface RadialSlice {
  id: string;
  label: string;
  color: string;
  icon: string;
  disabled?: boolean;
  slices?: RadialSlice[];
  run?: () => void;
}

export interface RadialModel {
  center: RadialSlice;
  slices: RadialSlice[];
}

const SIZE = 190;
const INNER = 40;
const OUTER = 95;
const CX = SIZE / 2;
const CY = SIZE / 2;

function polar(r: number, a: number): [number, number] {
  return [CX + Math.sin(a) * r, CY - Math.cos(a) * r];
}

function wedge(r0: number, r1: number, a0: number, a1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = polar(r1, a0);
  const [x1, y1] = polar(r1, a1);
  const [x2, y2] = polar(r0, a1);
  const [x3, y3] = polar(r0, a0);
  return `M${x0.toFixed(1)},${y0.toFixed(1)} A${r1},${r1} 0 ${large} 1 ${x1.toFixed(1)},${y1.toFixed(1)} L${x2.toFixed(1)},${y2.toFixed(1)} A${r0},${r0} 0 ${large} 0 ${x3.toFixed(1)},${y3.toFixed(1)} Z`;
}

function iconHref(name: string): string {
  return namedIcon(name, 32).src;
}

/** OpenFront-style 4-slice right-click wheel. */
export class RadialMenu {
  private overlay: HTMLElement;
  private wheel: HTMLElement;
  private tip: HTMLElement;
  private model: RadialModel | null = null;
  private stack: RadialSlice[][] = [];
  private center: RadialSlice | null = null;
  private rootCenter: RadialSlice | null = null;

  constructor(host: HTMLElement) {
    this.tip = h("div", { class: "radial-tip" });
    this.wheel = h("div", { class: "radial-wheel" });
    this.overlay = h("div", { class: "radial-overlay hidden" }, this.wheel, this.tip);
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) this.close();
    });
    this.overlay.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.close();
    });
    host.appendChild(this.overlay);
  }

  isOpen(): boolean {
    return !this.overlay.classList.contains("hidden");
  }

  open(x: number, y: number, model: RadialModel): void {
    this.model = model;
    this.rootCenter = model.center;
    this.center = model.center;
    this.stack = [model.slices];
    const pad = SIZE / 2 + 8;
    this.wheel.style.left = `${Math.max(pad, Math.min(window.innerWidth - pad, x))}px`;
    this.wheel.style.top = `${Math.max(pad, Math.min(window.innerHeight - pad, y))}px`;
    this.tip.style.left = this.wheel.style.left;
    this.tip.style.top = this.wheel.style.top;
    this.overlay.classList.remove("hidden");
    this.paint();
  }

  close(): void {
    this.overlay.classList.add("hidden");
    this.model = null;
    this.stack = [];
    this.center = null;
    this.rootCenter = null;
    this.tip.textContent = "";
    this.tip.classList.remove("show");
  }

  private current(): RadialSlice[] {
    return this.stack[this.stack.length - 1] ?? [];
  }

  private paint(): void {
    const slices = this.current();
    const n = Math.max(1, slices.length);
    const gap = 0.04;
    const span = (Math.PI * 2) / n;
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${SIZE} ${SIZE}`);
    svg.setAttribute("width", String(SIZE));
    svg.setAttribute("height", String(SIZE));

    slices.forEach((s, i) => {
      const a0 = i * span - span / 2 + gap;
      const a1 = i * span + span / 2 - gap;
      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", wedge(INNER, OUTER, a0, a1));
      path.setAttribute("class", "radial-slice" + (s.disabled ? " is-off" : ""));
      path.setAttribute("fill", s.disabled ? "#3a3648" : s.color);
      path.addEventListener("pointerenter", () => this.showTip(s.label));
      path.addEventListener("pointerleave", () => this.hideTip());
      path.addEventListener("click", (e) => {
        e.stopPropagation();
        this.pick(s);
      });
      svg.appendChild(path);
      const [ix, iy] = polar((INNER + OUTER) / 2, i * span);
      const img = document.createElementNS(ns, "image");
      img.setAttribute("href", iconHref(s.icon));
      img.setAttribute("x", String(ix - 14));
      img.setAttribute("y", String(iy - 14));
      img.setAttribute("width", "28");
      img.setAttribute("height", "28");
      img.setAttribute("class", "radial-icon" + (s.disabled ? " is-off" : ""));
      img.style.pointerEvents = "none";
      svg.appendChild(img);
    });

    const disc = document.createElementNS(ns, "circle");
    disc.setAttribute("cx", String(CX));
    disc.setAttribute("cy", String(CY));
    disc.setAttribute("r", "28");
    const center = this.center!;
    disc.setAttribute("class", "radial-hub" + (center.disabled ? " is-off" : ""));
    disc.setAttribute("fill", center.disabled ? "#2a2634" : center.color);
    disc.addEventListener("pointerenter", () => this.showTip(center.label));
    disc.addEventListener("pointerleave", () => this.hideTip());
    disc.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this.stack.length > 1) {
        this.stack.pop();
        this.center = this.rootCenter;
        this.paint();
        return;
      }
      this.pick(center);
    });
    svg.appendChild(disc);
    const hub = document.createElementNS(ns, "image");
    hub.setAttribute("href", iconHref(this.stack.length > 1 ? "back" : center.icon));
    hub.setAttribute("x", String(CX - 16));
    hub.setAttribute("y", String(CY - 16));
    hub.setAttribute("width", "32");
    hub.setAttribute("height", "32");
    hub.style.pointerEvents = "none";
    svg.appendChild(hub);

    this.wheel.replaceChildren(svg);
  }

  private pick(s: RadialSlice): void {
    if (s.disabled) return;
    if (s.slices?.length) {
      this.stack.push(s.slices);
      this.paint();
      return;
    }
    s.run?.();
    this.close();
  }

  private showTip(text: string): void {
    this.tip.textContent = text;
    this.tip.classList.add("show");
  }
  private hideTip(): void {
    this.tip.classList.remove("show");
  }
}

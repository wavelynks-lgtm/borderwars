import {neonAuth,sessionUser} from '../auth/session';
import {showAccount} from './Account';
import {hasAccount} from '../auth/session';
import {api} from "../multiplayer/Client";
import {showWorldCreator} from "./WorldCreator";
import {showCustomization} from "./Customization";
import {showStore} from "./Store";
import {localCosmetics,flagGlyph} from "../customization/cosmetics";
import {mountMenuAd,privacyChoices} from "../commerce/ads";
import {showOnlineLobby,closeOnlineLobby,type LobbyView} from "./OnlineLobby";
import type {OnlineClient} from "../multiplayer/Client";
import type {MatchInfo} from "../multiplayer/protocol";
import { DEFAULT_SETTINGS, Difficulty, GraphicsQuality, MAX_PLAYERS, SETTINGS_REV, UnitType, clampRoster, type GameSettings, type WorldId } from "../core/types";
import { currentFeatured, paintWorldPreview, WORLDS, worldDef, type FeaturedMatch } from "../map/worlds";
import { h } from "./dom";

const STORAGE_KEY = "borderwars.settings";



/** Explicit URL override wins, then the saved checkbox. Normal play is the default. */
export function resolveDevMode(saved?: boolean): boolean {
  const q = new URLSearchParams(location.search).get("dev");
  if (q === "1" || q === "true") return true;
  if (q === "0" || q === "false") return false;
  if (typeof saved === "boolean") return saved;
  return false;
}

export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<GameSettings>;
      if (parsed.settingsRev === SETTINGS_REV) {
        return {
          ...DEFAULT_SETTINGS,
          ...parsed,
          disabledUnits: Array.isArray(parsed.disabledUnits) ? parsed.disabledUnits : [],
          seed: Math.floor(Math.random() * 1e9),
          devMode: resolveDevMode(parsed.devMode),
        };
      }
      return {
        ...DEFAULT_SETTINGS,
        playerName: parsed.playerName ?? DEFAULT_SETTINGS.playerName,
        graphics: parsed.graphics ?? DEFAULT_SETTINGS.graphics,
        world: parsed.world ?? DEFAULT_SETTINGS.world,
        seed: Math.floor(Math.random() * 1e9),
        devMode: resolveDevMode(parsed.devMode),
      };
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SETTINGS, seed: Math.floor(Math.random() * 1e9), devMode: resolveDevMode() };
}

function saveSettings(s: GameSettings): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* Play still works when storage is unavailable. */ }
}

function toast(root: HTMLElement, text: string): void {
  root.querySelector(".lobby-toast")?.remove();
  const el = h("div", { class: "lobby-toast" }, text);
  root.appendChild(el);
  window.setTimeout(() => el.remove(), 1800);
}

export function showMenu(container: HTMLElement, onPlay: (s: GameSettings) => void, onOnline?: (info:MatchInfo,client:OnlineClient)=>void): HTMLElement {
  const draft = loadSettings();
  draft.cosmetics=localCosmetics();
  delete draft.customWorld;
  const name = h("input", {
    type: "text",
    value: draft.playerName,
    maxLength: 20,
    placeholder: "TAG",
    class: "field tag-field",
  });


  const flagButton=h("button",{class:"btn btn-tiny",onClick:()=>showCustomization(container,c=>{draft.cosmetics=c;flagButton.textContent=`${flagGlyph(c.flag)} Customize`;})},`${flagGlyph(draft.cosmetics.flag)} Customize`);
  if(hasAccount())void api("/api/me").then(me=>{if(me.cosmetics){draft.cosmetics=me.cosmetics;flagButton.textContent=`${flagGlyph(me.cosmetics.flag)} Customize`;}}).catch(()=>{});
  const featuredCanvas = h("canvas", { class: "featured-map" }) as HTMLCanvasElement;
  const tagRow = h("div", { class: "featured-tags" });
  const worldTitle = h("div", { class: "featured-title" }, "Earth");
  const worldTag = h("span", { class: "featured-mode" }, "WORLD");
  const popEl = h("div", { class: "featured-pop" }, "0/74");
  const countEl = h("div", { class: "featured-secs" }, "60");
  const countLabel = h("div", { class: "featured-secs-label" }, "ROTATES IN");

  let matchmaking:any=null,matchmakingOffset=0,lastPoll=0,polling=false;
  const refreshFeatured = () => {
    const rooms=matchmaking?.rooms??[],random=rooms.find((r:any)=>r.kind==='random');
    worldTitle.textContent=random?.name??'Random Match';worldTag.textContent='ONLINE';
    popEl.textContent=matchmaking?`${matchmaking.randomPlayers} players joining · up to 8 per match`:(lastPoll?'Match server unavailable':'Connecting to matchmaking…');
    countEl.textContent=random?.countdownAt?String(Math.max(0,Math.ceil((random.countdownAt-Date.now()-matchmakingOffset)/1000))):'—';
    countLabel.textContent=random?.countdownAt?'STARTS IN':'WAITING FOR PLAYERS';
    tagRow.replaceChildren(...(random?[`${random.settings.numNations} nations`,`${random.settings.numBots} tribes`,`${random.settings.goldMultiplier}× gold`,random.settings.disableNukes?'No nukes':'Nukes on']:['Random settings','Live multiplayer']).map((t:string)=>h('span',{class:'chip'},t)));
  };
  void paintWorldPreview(featuredCanvas,'earth');
  refreshFeatured();

  let tick = 0;
  const finish = (partial: Partial<GameSettings>) => {
    window.clearInterval(tick);
    const settings: GameSettings = {
      ...draft,
      ...partial,
      ...clampRoster(partial.numNations ?? draft.numNations, partial.numBots ?? draft.numBots),
      playerName: name.value.trim() || "Commander",
      seed: Math.floor(Math.random() * 1e9),
      devMode: resolveDevMode(partial.devMode ?? draft.devMode),
    };
    saveSettings(settings);
    el.remove();
    closeOnlineLobby(container);
    onPlay(settings);
  };

  const playFeatured = () => {openOnline('random');};

  const playWorld = (world: WorldId) => {
    finish({
      world,
      ...clampRoster(world === "mars" ? 19 : draft.numNations, world === "mars" ? 0 : draft.numBots),
      instantBuild: false,
    });
  };

  const overlayHost = h("div", { class: "lobby-overlays" });

  const openSheet = (title: string, body: HTMLElement, footer?: HTMLElement) => {
    const back = h(
      "div",
      { class: "sheet-back" },
      h(
        "div",
        { class: "menu-card glass sheet-card" },
        h(
          "div",
          { class: "sheet-head" },
          h("div", { class: "menu-eyebrow" }, title),
          h("button", { class: "icon-btn", onClick: () => back.remove() }, "×"),
        ),
        body,
        footer ?? null,
      ),
    );
    back.addEventListener("click", (e) => {
      if (e.target === back) back.remove();
    });
    overlayHost.appendChild(back);
    return back;
  };

  const openSettings = (opts?: { world?: WorldId; playLabel?: string; extra?: Partial<GameSettings> }) => {
    const form = settingsForm({ ...draft, world: opts?.world ?? draft.world });
    openSheet(
      "Custom match",
      form.el,
      h(
        "button",
        {
          class: "btn btn-primary btn-big",
          onClick: () => finish({ ...form.read(), ...opts?.extra }),
        },
        opts?.playLabel ?? "Play",
      ),
    );
  };

  const openWorlds = () => {
    const cards = WORLDS.map((w) => {
      const preview = h("canvas", { class: "world-pick-map" }) as HTMLCanvasElement;
      void paintWorldPreview(preview, w.id);
      return h(
        "button",
        { class: "world-pick", onClick: () => playWorld(w.id) },
        preview,
        h(
          "div",
          {},
          h("div", { class: "world-pick-name" }, w.name),
          h("div", { class: "world-pick-split" }, w.splits),
          h("div", { class: "world-pick-blurb" }, w.blurb),
        ),
      );
    });
    openSheet("Worlds", h("div", { class: "world-grid" }, ...cards));
  };

  const openHelp = (title: string) => {
    openSheet(
      title,
      h(
        "div",
        { class: "menu-help" },
        h("div", { class: "help-item" }, h("kbd", {}, "Click"), "empty land on your border to claim it. Filling a country or state pays gold and troops based on how much of it you hold."),
        h("div", { class: "help-item" }, h("kbd", {}, "Drag"), "rotates the globe, wheel zooms. Right-click inspects a nation."),
        h("div", { class: "help-item" }, h("kbd", {}, "Q / F / W–I"), "or the bottom bar buys a building, then click the globe to place it. Factories lay railways."),
        h("div", { class: "help-item" }, h("kbd", {}, "1 / 2"), "attack ratio · ", h("kbd", {}, "Space"), " terrain · ", h("kbd", {}, "Esc"), " cancel · ", h("kbd", {}, "F3"), " FPS"),
        h("div", { class: "help-item" }, h("kbd", {}, "Shift+R"), "retaliate · ", h("kbd", {}, "\\"), "hide UI"),
        h("div", { class: "help-item" }, h("kbd", {}, "`"), "dev panel · ", h("kbd", {}, "Shift-click"), "paint land · ", h("kbd", {}, "Shift+N"), "skip spawn"),
        h("div", { class: "help-item" }, "Random matches use shared settings and start after 60 seconds, with AI filling empty player slots. Create custom matches with your saved World Forge maps."),
      ),
    );
  };

  const openOnline = (view:LobbyView='lobby') => showOnlineLobby(container,(info,client)=>{window.clearInterval(tick);el.remove();onOnline?.(info,client);},view);

  const navBtn = (icon: string, label: string, onClick: () => void) =>
    h("button", { class: "lobby-nav-btn", title: label, onClick }, h("span", { class: "lobby-nav-ico" }, icon), h("span", { class: "lobby-nav-lab" }, label));

  const action = (cls: string, icon: string, label: string, onClick: () => void, badge?: string) =>
    h(
      "button",
      { class: "action-card " + cls, onClick },
      h("div", { class: "action-ico" }, icon),
      h("div", { class: "action-lab" }, label),
      badge ? h("span", { class: "action-badge" }, badge) : null,
    );

  const randomAction=action("primary","◎","Random Match",()=>openOnline('random'),'…');
  const customAction=action("","+","Custom Match",()=>openOnline('custom'),'…');
  const pollMatches=async()=>{if(polling)return;polling=true;try{const data=await api('/api/matchmaking');matchmaking=data;matchmakingOffset=data.serverTime-Date.now();randomAction.querySelector('.action-badge')!.textContent=String(data.randomPlayers);customAction.querySelector('.action-badge')!.textContent=String(data.customMatches);refreshFeatured();}catch{matchmaking=null;popEl.textContent='Match server unavailable';for(const button of [randomAction,customAction])button.querySelector('.action-badge')!.textContent='—';}finally{polling=false;}};
  const el = h(
    "div",
    { class: "lobby" },
    h(
      "header",
      { class: "lobby-top" },
      h("div", { class: "logo" }, h("span", { class: "logo-b" }, "B"), "ORDERWARS"),
      h(
        "div",
        { class: "potd" },
        h("span", { class: "potd-crown" }, "♛"),
        h("span", { class: "potd-label" }, "ONLINE + SOLO"),
        h("span", { class: "potd-name" }, "Earth & Mars"),
        h("span", { class: "potd-wins" }, "Globe conquest"),
      ),
      h("div", { class: "lobby-lang" }, "EN"),
    ),
    h(
      "div",
      { class: "lobby-body" },
      h(
        "nav",
        { class: "lobby-nav" },
        navBtn("▣", "Sign in", () => neonAuth?showAccount(container):openOnline()),
        navBtn("☺", "Invite", () => openOnline()),
        navBtn("▲", "Ranks", () => openOnline("leaderboard")),
        navBtn("★", "Store", () => showStore(container)),
        navBtn("!", "News", () => toast(el, "Mars is live. Worlds rotate every minute.")),
        navBtn("⚙", "Settings", () => openSettings()),
      ),
      h(
        "main",
        { class: "lobby-main" },
        h(
          "div",
          { class: "tag-bar" },
          flagButton,
          h("span", { class: "tag-lab" }, "TAG"),
          name,
        ),
        h(
          "div",
          { class: "featured" },
          featuredCanvas,
          h("div", { class: "featured-dither" }),
          tagRow,
          h(
            "div",
            { class: "featured-join" },
            h("div", { class: "featured-kicker" }, "FEATURED MATCH"),
            h("div", { class: "featured-headline" }, worldTitle, worldTag),
            popEl,
          ),
          h("div", { class: "featured-timer" }, countEl, countLabel),
          h("button", { class: "featured-hit", onClick: playFeatured, title: "Play featured world" }),
        ),
        h(
          "div",
          { class: "lobby-actions" },
          randomAction,
          action("primary", "▶", "Single Player", () => openSettings({ playLabel: "Start" })),
          customAction,
          action("", "↪", "Quick Play", playFeatured),
          action("", "▣", "Worlds", openWorlds, String(WORLDS.length)),
          action("", "✦", "World Forge", () => showWorldCreator(container,recipe=>finish({world:"earth",customWorld:recipe,numNations:Math.min(recipe.countries,40),numBots:8,randomSpawn:true}))),
        ),
        h(
          "div",
          { class: "lobby-extra" },
          h("button", { class: "extra-btn", onClick: () => openHelp("Tutorial") }, "Tutorial"),
          h("button", { class: "extra-btn", onClick: () => openHelp("Instructions") }, "Instructions"),
        ),
      ),
    ),
    h(
      "footer",
      { class: "lobby-foot" },
      h("span", {}, "About"),
      h("span", { class: "muted" }, "Pixel globe"),
      h("span", { class: "muted" }, "2026 BorderWars"),
    ),
    overlayHost,
  );

  tick = window.setInterval(() => {
    if (!el.isConnected) {
      window.clearInterval(tick);
      return;
    }
    refreshFeatured();
    if(Date.now()-lastPoll>5000){lastPoll=Date.now();void pollMatches();}
  }, 250);

  container.appendChild(el);
  const updateAccount=()=>{if(neonAuth)void sessionUser().then(user=>{if(!el.isConnected)return;const label=el.querySelector('.lobby-nav-lab');if(label)label.textContent=user?.name??'Sign in';}).catch(()=>{});};
  const accountListener=()=>{if(!el.isConnected){window.removeEventListener('borderwars-account-change',accountListener);return;}updateAccount();};
  window.addEventListener('borderwars-account-change',accountListener);updateAccount();

  lastPoll=Date.now();void pollMatches();
  mountMenuAd(el);
  if(import.meta.env.VITE_ADS_ENABLED==='true')el.querySelector(".lobby-foot")?.append(h("button",{class:"extra-btn",onClick:privacyChoices},"Privacy choices"));
  const purchase=new URLSearchParams(location.search).get("purchase");
  if(purchase){toast(el,purchase==="success"?"Payment submitted. Your account updates after payment verification.":"Checkout cancelled. No purchase was activated.");history.replaceState(null,"",location.pathname);}
  return el;
}

function fromMatch(base: GameSettings, match: FeaturedMatch): Partial<GameSettings> {
  return {
    ...base,
    world: match.world,
    ...clampRoster(match.nations, match.bots),
    goldMultiplier: match.goldMultiplier,
    randomSpawn: match.randomSpawn,
    instantBuild: match.instantBuild,
  };
}

function settingsForm(s: GameSettings): { el: HTMLElement; read: () => Partial<GameSettings> } {
  const segmented = <T extends string>(values: T[], initial: T, label: (v: T) => string) => {
    let cur = initial;
    const buttons = values.map((v) =>
      h(
        "button",
        {
          class: "seg-item" + (v === initial ? " on" : ""),
          onClick: () => {
            cur = v;
            for (const b of buttons) b.classList.toggle("on", b.dataset.v === v);
          },
          "data-v": v,
        },
        label(v),
      ),
    );
    return {
      el: h("div", { class: "segmented" }, ...buttons),
      get: () => cur,
    };
  };

  const world = segmented(["earth", "mars"] as WorldId[], s.world, (v) => (v === "earth" ? "Earth" : "Mars"));
  const difficulty = segmented(Object.values(Difficulty), s.difficulty, (d) => d[0].toUpperCase() + d.slice(1));
  const gfx = segmented(Object.values(GraphicsQuality), s.graphics, (g) => g[0].toUpperCase() + g.slice(1));

  const slider = (min: number, max: number, step: number, value: number, format: (v: number) => string) => {
    const input = h("input", { type: "range", min, max, step, value });
    const val = h("span", { class: "slider-value" }, format(value));
    input.oninput = () => (val.textContent = format(Number(input.value)));
    return { input, val };
  };
  const aiSlots = MAX_PLAYERS - 1;
  const nations = slider(0, aiSlots, 1, Math.min(aiSlots, s.numNations), (v) => (v === 0 ? "Off" : String(v)));
  const bots = slider(0, aiSlots, 1, Math.min(aiSlots, s.numBots), (v) => (v === 0 ? "Off" : String(v)));
  const fitBots = () => {
    const b = Math.min(Number(bots.input.value), aiSlots - Number(nations.input.value));
    bots.input.value = String(b);
    bots.val.textContent = b === 0 ? "Off" : String(b);
  };
  const fitNations = () => {
    const n = Math.min(Number(nations.input.value), aiSlots - Number(bots.input.value));
    nations.input.value = String(n);
    nations.val.textContent = n === 0 ? "Off" : String(n);
  };
  nations.input.addEventListener("input", fitBots);
  bots.input.addEventListener("input", fitNations);
  fitBots();
  const win = slider(30, 95, 1, s.winPercent, (v) => `${v}%`);
  const spawn = slider(5, 40, 1, s.spawnPhaseSeconds, (v) => `${v}s`);
  const startGold = slider(0, 10_000_000, 250_000, s.startingGold, (v) =>
    v >= 1e6 ? `${(v / 1e6).toFixed(v % 1e6 ? 1 : 0)}M` : v === 0 ? "0" : `${Math.round(v / 1000)}K`,
  );
  const goldMult = slider(5, 30, 1, Math.round(s.goldMultiplier * 10), (v) => `${(v / 10).toFixed(1)}×`);
  const maxTimer = slider(0, 120, 1, s.maxTimerMinutes, (v) => (v === 0 ? "Off" : `${v}m`));
  const nukes = h("input", { type: "checkbox", checked: !s.disableNukes, class: "switch" });
  const waterNukes = h("input", { type: "checkbox", checked: s.waterNukes, class: "switch" });
  const randomSpawn = h("input", { type: "checkbox", checked: s.randomSpawn, class: "switch" });
  const instant = h("input", { type: "checkbox", checked: s.instantBuild, class: "switch" });
  const infGold = h("input", { type: "checkbox", checked: s.infiniteGold, class: "switch" });
  const infTroops = h("input", { type: "checkbox", checked: s.infiniteTroops, class: "switch" });
  const dev = h("input", { type: "checkbox", checked: s.devMode, class: "switch" });

  const DISABLEABLE: { type: UnitType; label: string }[] = [
    { type: UnitType.City, label: "City" },
    { type: UnitType.Factory, label: "Factory" },
    { type: UnitType.DefensePost, label: "Defense" },
    { type: UnitType.Port, label: "Dock" },
    { type: UnitType.MissileSilo, label: "Silo" },
    { type: UnitType.SAMLauncher, label: "SAM" },
    { type: UnitType.Warship, label: "Warship" },
    { type: UnitType.AtomBomb, label: "Atom" },
    { type: UnitType.HydrogenBomb, label: "H-Bomb" },
    { type: UnitType.MIRV, label: "MIRV" },
  ];
  const disabled = new Set(s.disabledUnits ?? []);
  const unitBtns = DISABLEABLE.map(({ type, label }) => {
    const btn = h("button", { class: "unit-chip" + (disabled.has(type) ? " off" : ""), type: "button" }, label);
    btn.onclick = () => {
      if (disabled.has(type)) disabled.delete(type);
      else disabled.add(type);
      btn.classList.toggle("off", disabled.has(type));
    };
    return btn;
  });

  const row = (label: string, ctrl: Node, val?: Node) => h("div", { class: "menu-row" }, h("span", { class: "menu-label" }, label), ctrl, val ?? null);

  const el = h(
    "div",
    { class: "sheet-body" },
    h("div", { class: "menu-group" }, row("World", world.el), row("Difficulty", difficulty.el), row("Graphics", gfx.el)),
    h(
      "div",
      { class: "menu-group" },
      row("Nations", nations.input, nations.val),
      row("Tribes", bots.input, bots.val),
      row("Land to win", win.input, win.val),
      row("Spawn phase", spawn.input, spawn.val),
      row("Start gold", startGold.input, startGold.val),
      row("Gold ×", goldMult.input, goldMult.val),
      row("Max timer", maxTimer.input, maxTimer.val),
      row("Inf. gold", h("label", { class: "switch-wrap" }, infGold, h("span", { class: "switch-track" }))),
      row("Inf. troops", h("label", { class: "switch-wrap" }, infTroops, h("span", { class: "switch-track" }))),
      row("Nukes", h("label", { class: "switch-wrap" }, nukes, h("span", { class: "switch-track" }))),
      row("Nuke flooding", h("label", { class: "switch-wrap" }, waterNukes, h("span", { class: "switch-track" }))),
      row("Rand. spawn", h("label", { class: "switch-wrap" }, randomSpawn, h("span", { class: "switch-track" }))),
      row("Instant", h("label", { class: "switch-wrap" }, instant, h("span", { class: "switch-track" }))),
      row("Dev mode", h("label", { class: "switch-wrap" }, dev, h("span", { class: "switch-track" }))),
    ),
    h("div", { class: "menu-group unit-group" }, h("div", { class: "menu-row" }, h("span", { class: "menu-label" }, "Disable")), h("div", { class: "unit-chips" }, ...unitBtns)),
    h("div", { class: "menu-hint" }, `At most ${MAX_PLAYERS} players on one globe (you + nations + tribes). Land spreads along the border like OpenFront — extra clicks add troops, they do not flash a new continent.`),
  );

  return {
    el,
    read: () => ({
      settingsRev: SETTINGS_REV,
      world: world.get(),
      difficulty: difficulty.get(),
      graphics: gfx.get(),
      ...clampRoster(Number(nations.input.value), Number(bots.input.value)),
      winPercent: Number(win.input.value),
      spawnPhaseSeconds: Number(spawn.input.value),
      startingGold: Number(startGold.input.value),
      goldMultiplier: Number(goldMult.input.value) / 10,
      maxTimerMinutes: Number(maxTimer.input.value),
      infiniteGold: infGold.checked,
      infiniteTroops: infTroops.checked,
      disableNukes: !nukes.checked,
      waterNukes: waterNukes.checked,
      randomSpawn: randomSpawn.checked,
      instantBuild: instant.checked,
      disabledUnits: [...disabled],
      devMode: resolveDevMode(dev.checked),
    }),
  };
}

import {activeSalvo, type Command} from "../multiplayer/protocol";
import type {OnlineClient} from "../multiplayer/Client";
import { MissilePlanner } from "../ui/MissilePlanner";
import type { MissileSalvoExecution } from "../core/executions/MissileSalvoExecution";
import { prepareMatch } from "./prepareMatch";
import { loadingFrame } from "../ui/WorldLoading";
import * as THREE from "three";
import type { Game } from "../core/Game";
import { unitLabel } from "../core/Game";
import type { GameMap } from "../core/GameMap";
import type { Player } from "../core/Player";
import type { Unit } from "../core/Unit";
import type { AttackExecution } from "../core/executions/AttackExecution";
import { queueMissiles, attackTile, build, moveWarship, notify, retreatAttack, retreatBoat, sendBoat, upgradeUnit } from "../core/actions";
import { fmtTroops } from "../core/executions/AttackExecution";
import { MessageType, NUKES, PlayerType, UnitType, type GameSettings } from "../core/types";
import { AttackLabels } from "../render/AttackLabels";
import { BuildLabels } from "../render/BuildLabels";
import { GoldFloats } from "../render/GoldFloats";
import { GlobeRenderer } from "../render/GlobeRenderer";
import { Labels } from "../render/Labels";
import { UnitLayer } from "../render/UnitLayer";
import { AlertFrame } from "../ui/AlertFrame";
import { BuildBar } from "../ui/BuildBar";
import { DevPanel } from "../ui/DevPanel";
import { Hud } from "../ui/Hud";
import { PlayerPanel, StructurePanel, showEndScreen } from "../ui/Panels";
import { RadialMenu, type RadialModel, type RadialSlice } from "../ui/RadialMenu";
import { h } from "../ui/dom";
import { createGame } from "./setup";

const TICK_MS = 100;

export class App {
  private game!: Game;
  private online: OnlineClient | null = null;
  private hud!: Hud;
  private unitLayer!: UnitLayer;
  private goldFloats!: GoldFloats;
  private labels!: Labels;
  private attackLabels!: AttackLabels;
  private buildLabels!: BuildLabels;
  private alertFrame!: AlertFrame;
  private buildBar!: BuildBar;
  private devPanel: DevPanel | null = null;
  private playerPanel!: PlayerPanel;
  private structurePanel!: StructurePanel;
  private radial!: RadialMenu;
  private tooltip: HTMLElement;
  private performanceLabel: HTMLElement;
  private performanceVisible = false;
  private performanceFrames = 0;
  private performanceSince = 0;
  private simulationMs = 0;
  private simulationTicks = 0;
  private acc = 0;
  private last = 0;
  private lastHud = 0;
  private lastFront = 0;
  private needPick = false;
  private paused = false;
  private speed = 1;
  private endShown = false;
  /** unit type selected in the build bar (build mode) */
  private armed: UnitType | null = null;
  private missilePlanner!: MissilePlanner;
  private planningMissiles = false;
  private missileTargets: number[] = [];
  private salvo: MissileSalvoExecution | null = null;
  private shownSalvoCount = -1;
  private down: { x: number; y: number; button: number; t: number } | null = null;
  private hoverTile = -1;
  private hoverPos = { x: 0, y: 0 };
  private hoverPoint = new THREE.Vector3();
  private hasHoverPoint = false;
  private running = false;
  private uiHidden = false;
  private selectedWarship: Unit | null = null;

  constructor(
    private map: GameMap,
    private globe: GlobeRenderer,
    private ui: HTMLElement,
    private labelsEl: HTMLElement,
  ) {
    this.tooltip = h("div", { class: "tooltip" });
    ui.appendChild(this.tooltip);
    this.performanceLabel = h("div", { class: "performance-label", hidden: true });
    ui.appendChild(this.performanceLabel);
    ui.appendChild(
      h(
        "button",
        {
          class: "icon-btn ui-restore",
          title: "Show UI (\\)",
          onClick: () => this.setUiHidden(false),
        },
        "UI",
      ),
    );
  }

  async start(settings: GameSettings, progress: (message: string, percent: number) => void = () => {}, online?: {client:OnlineClient; game:Game}): Promise<void> {
    this.globe.setQuality(settings.graphics);
    const game = online?.game ?? createGame(this.map, settings);
    this.online = online?.client ?? null;
    this.game = game;
    const human = game.human!;
    game.onTerrainSunk = (t) => this.globe.paintSunk(t);
    for (const p of game.allPlayers()){this.globe.setPlayerColor(p.smallID,new THREE.Color(p.color));this.globe.setPlayerPattern(p.smallID,p.cosmetics);}
    this.unitLayer = new UnitLayer(this.globe, game);
    game.onBorderAssault = (tile, color) => this.unitLayer.ping(tile, color, 16);
    this.goldFloats = new GoldFloats(this.labelsEl, this.globe);
    game.onGoldFloat = (tile, gold, player, troops) => {
      if (player === human) this.goldFloats.spawn(tile, gold, troops);
    };
    this.labels = new Labels(this.labelsEl, this.globe, game);
    this.attackLabels = new AttackLabels(this.labelsEl, this.globe, game);
    this.alertFrame = new AlertFrame(this.ui, game);
    this.hud = new Hud(this.ui, game, {
      onRetreat: (id) => this.order({kind:'retreat',id},()=>retreatAttack(game, human, id)),
      onRetreatBoat: (id) => this.order({kind:'retreatBoat',id},()=>retreatBoat(human, id)),
      onAcceptAlliance: (id) => {
        const r = human.incomingAllianceRequests.find((r) => r.id === id);
        if (r) this.order({kind:'accept',id:r.id},()=>game.acceptAlliance(r));
      },
      onRejectAlliance: (id) => {
        const r = human.incomingAllianceRequests.find((r) => r.id === id);
        if (r) this.order({kind:'reject',id:r.id},()=>game.rejectAlliance(r));
      },
      onExtendAlliance: (id) => {
        const other = game.player(id);
        if (other) this.order({kind:'extend',target:other.smallID},()=>game.extendAlliance(human, other));
      },
      onSelectPlayer: (p) => this.playerPanel.open(p),
      onAttackRatio: (v) => this.setRatio("attackRatio",v),
      onTroopRatio: (v) => this.setRatio("troopRatio",v),
      onEmoji: (e) => {
        const target = human.targetPlayer ? game.player(human.targetPlayer) : null;
        this.order({kind:'emoji',target:target?.smallID,emoji:e},()=>game.sendEmoji(human, target, e));
      },
      onTogglePause: () => this.togglePause(),
      onFocusAttack: (a) => {
        const pos = a.clusteredPositions();
        if (pos.length) this.globe.flyTo(pos[0], 600);
      },
      onRetaliate: (a) => this.retaliate(a),
      onHideUi: () => this.setUiHidden(true),
    });
    this.buildLabels = new BuildLabels(this.labelsEl, this.globe, game);
    this.missilePlanner = new MissilePlanner(this.ui,
      () => { this.planningMissiles=true;this.updateMissilePlan();this.hud.setMode("Plan missile targets", "Click land to mark areas, then Launch salvo"); },
      () => this.launchMissilePlan(),
      () => { this.missileTargets.pop();this.updateMissilePlan(); },
      () => { if(this.salvo){this.order({kind:"cancelSalvo"},()=>this.salvo?.cancel());this.salvo=null;this.updateMissilePlan();}else this.cancelBuild(); });
    this.buildBar = new BuildBar(this.ui, game, (type) => {
      this.armed = type;
      this.planningMissiles=false;this.missileTargets=[];
      this.updateMissilePlan();
      if (!type) {
        this.unitLayer.setGhost(null, -1, false);
        this.globe.setPreviewTiles([]);
        this.globe.setRailGhost([]);
        this.previewTile = -1;
        this.hud.setMode(null);
      } else {
        const nuke = NUKES.has(type);
        this.hud.setMode(
          `${unitLabel(type)} ${this.online ? "selected" : "bought"} — ${nuke ? "pick a target" : "click to place it"}`,
          this.online ? "right-click or Esc to cancel selection" : "right-click or Esc to cancel & refund",
        );
      }
      this.refreshTooltip();
    });
    this.playerPanel = new PlayerPanel(this.ui, game, {
      onAttack: (p) => {
        const t = this.anyTileOf(p);
        if (t >= 0) this.doAttack(t);
      },
      onBoat: (p) => {
        const t = this.anyShoreTileOf(p);
        if (t >= 0) {
          const r = this.action({kind:'boat',tile:t,value:human.attackRatio},()=>sendBoat(game, human, t, human.troops * human.attackRatio));
          notify(game, human, r);
          if (r.ok) this.unitLayer.ping(t, human.color, 10);
        } else this.hud.toast("That player has no coastline", MessageType.Warn);
      },
      onRequestAlliance: (p) => {
        const r = this.requestAlliance(p);
        if (r) this.hud.toast(`Alliance request sent to ${p.name}`);
        else this.hud.toast("Cannot send a request right now (cooldown)", MessageType.Warn);
        this.playerPanel.render();
      },
      onBreakAlliance: (p) => {
        this.order({kind:'break',target:p.smallID},()=>game.breakAlliance(human, p));
        this.playerPanel.render();
      },
      onExtendAlliance: (p) => {
        this.order({kind:'extend',target:p.smallID},()=>game.extendAlliance(human, p));
        this.playerPanel.render();
      },
      onDonateTroops: (p) => {
        this.order({kind:'donateTroops',target:p.smallID},()=>game.donateTroops(human, p, human.troops / 3));
        this.playerPanel.render();
      },
      onDonateGold: (p) => {
        this.order({kind:'donateGold',target:p.smallID},()=>game.donateGold(human, p, human.gold / 3));
        this.playerPanel.render();
      },
      onEmbargo: (p, on) => {
        this.order({kind:'embargo',target:p.smallID,on},()=>game.setEmbargo(human, p, on));
        this.playerPanel.render();
      },
      onEmbargoAll: (on) => {
        this.order({kind:'embargoAll',on},()=>game.embargoAll(human, on));
        this.playerPanel.render();
      },
      onEmoji: (p, e) => this.order({kind:'emoji',target:p.smallID,emoji:e},()=>game.sendEmoji(human, p, e)),
      onFlyTo: (p) => {
        const t = this.anyTileOf(p);
        if (t >= 0) this.globe.flyTo(t);
      },
      onTarget: (p) => {
        human.targetPlayer = human.targetPlayer === p.smallID ? 0 : p.smallID;
        this.playerPanel.render();
      },
    });
    this.radial = new RadialMenu(this.ui);
    this.structurePanel = new StructurePanel(this.ui, game, {
      onUpgrade: (u) => notify(game, human, this.action({kind:'upgrade',id:u.id},()=>upgradeUnit(game, human, u))),
      onDelete: (u) => {
        this.order({kind:'delete',id:u.id},()=>{if (u.deleteAt >= 0) game.cancelDelete(human, u);else game.markDelete(human, u);});
      },
    });
    if (game.isDev()) {
      this.devPanel = new DevPanel(
        this.ui,
        game,
        (t) => this.globe.flyTo(t),
        () => this.anyTileOf(human),
        (n) => {
          this.speed = n;
          this.hud.toast(`Speed ×${n}`);
        },
      );
    }

    this.globe.setSpawnMode(true);
    this.globe.setLocalOwner(human.smallID);
    if (!online && settings.randomSpawn && !human.hasSpawned) {
      const t = game.randomSpawnTile(human);
      if (t >= 0) {
        game.spawnPlayer(human, t);
        this.globe.flyTo(t, 700);
      }
    }
    if (!online) await prepareMatch(game, (message, fraction) => progress(message, 72 + fraction * 16), loadingFrame);
    progress("Uploading terrain and starting territories…", 90);
    while (this.map.dirty) { this.globe.syncTerritory(); await loadingFrame(); }
    this.unitLayer.update();
    this.labels.update(performance.now());
    this.hud.update();
    progress("Preparing building and vehicle textures…", 93);
    await this.unitLayer.warmAssets(loadingFrame);
    progress("Warming up graphics…", 95);
    await this.globe.renderer.compileAsync(this.globe.scene, this.globe.camera);
    for (let i=0;i<4;i++) { this.globe.render(); await loadingFrame(); }
    progress("Ready to deploy", 100);
    if (this.online) {
      const banner=h("div",{class:"online-banner"},"Online · waiting for all players");this.ui.append(banner);
      this.ui.append(h("button",{class:"online-leave",onClick:()=>this.online?.send({type:"leave"})},"Surrender & leave"));
      this.online.on(m=>{
        if(m.type==='left'){this.online?.close();location.reload();}
        if(m.type==='error'||m.type==='aborted')this.hud.toast(m.message,MessageType.Warn);
        if(m.type==='connection')banner.textContent=m.status;
        if(m.type==='room'&&m.room.phase==='playing')banner.textContent='Online · live match';
        if(m.type==='synced')banner.textContent='Online · connected';
        if(m.type==='result')this.hud.toast(m.message);
      });
      this.online.attach(game);
    }
    this.bindInput();
    this.acc = 0;
    this.running = true;
    this.last = performance.now();
    this.performanceSince = this.last;
    requestAnimationFrame((t) => this.frame(t));
    (window as unknown as { __game: Game; __app: App }).__game = game;
    (window as unknown as { __game: Game; __app: App }).__app = this;
  }

  private anyTileOf(p: Player): number {
    for (const t of p.borderTiles) return t;
    for (const t of p.tiles) return t;
    return -1;
  }
  private anyShoreTileOf(p: Player): number {
    const human = this.game.human!;
    let best = -1;
    let bestD = Infinity;
    const mine = this.anyTileOf(human);
    let i = 0;
    for (const t of p.borderTiles) {
      if (i++ % 3 !== 0) continue;
      if (!this.map.isShore(t)) continue;
      const d = mine >= 0 ? this.map.distSq(t, mine) : 0;
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  }

  private order(command:Command,offline:()=>void):void {
    if(this.online)this.online.command(command);else offline();
  }
  private action(command:Command,offline:()=>{ok:true;message?:string}|{ok:false;message:string}):{ok:true;message?:string}|{ok:false;message:string} {
    if(this.online){this.online.command(command);return {ok:true};}return offline();
  }
  private requestAlliance(player:Player):boolean {
    if(this.online){this.online.command({kind:'alliance',target:player.smallID});return true;}
    return !!this.game.requestAlliance(this.game.human!,player);
  }
  private setRatio(kind:'attackRatio'|'troopRatio',value:number):void {
    this.order({kind,value},()=>{if(kind==='attackRatio')this.game.human!.attackRatio=value;else this.game.human!.targetTroopRatio=value;});
  }
  private togglePause(): void {
    if(this.online){this.hud.toast('Online matches run at server speed');return;}
    this.paused = !this.paused;
    this.hud.setPaused(this.paused);
  }

  private updateMissilePlan(): void {
    const queued=!!this.salvo?.isActive();
    const type=queued?this.salvo!.type:this.armed;
    const targets=queued?this.salvo!.orders.map(o=>o.tile):this.missileTargets;
    this.missilePlanner.update(!!type&&NUKES.has(type),this.planningMissiles,targets.length,queued);
    this.unitLayer.setMissileTargets(targets,type??UnitType.AtomBomb);
    this.shownSalvoCount=queued?targets.length:-1;
  }
  private launchMissilePlan(): void {
    if(!this.armed||this.salvo?.isActive())return;
    if(this.online){
      this.online.command({kind:'salvo',type:this.armed,tiles:this.missileTargets.slice()});
      this.buildBar.placed();this.armed=null;this.planningMissiles=false;this.missileTargets=[];this.unitLayer.setGhost(null,-1,false);this.hud.setMode(null);this.updateMissilePlan();return;
    }
    const result=queueMissiles(this.game,this.game.human!,this.armed,this.missileTargets,this.buildBar.purchaseCredit);
    if(!result.ok){this.hud.toast(result.message,MessageType.Warn);return;}
    this.salvo=result.salvo;this.buildBar.placed();this.armed=null;this.planningMissiles=false;this.missileTargets=[];
    this.unitLayer.setGhost(null,-1,false);this.hud.setMode(null);this.updateMissilePlan();
  }

  /** cancel build mode and refund the purchase */
  private cancelBuild(): void {
    if (this.armed) this.buildBar.cancel();
    this.armed = null;
    this.planningMissiles=false;this.missileTargets=[];this.updateMissilePlan();
    this.selectedWarship = null;
    this.unitLayer.setGhost(null, -1, false);
    this.globe.setPreviewTiles([]);
    this.globe.setRailGhost([]);
    this.previewTile = -1;
    this.hud.setMode(null);
  }

  private retaliate(from?: AttackExecution): void {
    const game = this.game;
    const human = game.human!;
    const inc = human.incomingAttacks.filter((a) => a.isActive());
    const a = from ?? inc.sort((x, y) => y.troops() - x.troops())[0];
    if (!a) {
      this.hud.toast("No incoming attack to retaliate", MessageType.Warn);
      return;
    }
    const tile = this.anyTileOf(a.owner);
    if (tile < 0) return;
    this.doAttack(tile);
  }

  private setUiHidden(on: boolean): void {
    this.uiHidden = on;
    this.ui.classList.toggle("ui-hidden", on);
    this.labelsEl.classList.toggle("ui-hidden", on);
  }

  private doAttack(tile: number): void {
    const game = this.game;
    const human = game.human!;
    const r = this.action({kind:'attack',tile,value:human.attackRatio},()=>attackTile(game, human, tile));
    notify(game, human, r);
    if (r.ok) this.unitLayer.ping(tile, human.color, 14);
  }

  private actionRadial(tile: number): RadialModel {
    const game = this.game;
    const human = game.human!;
    const owner = game.ownerAt(tile);
    const own = owner === human;
    const allied = !!owner && !own && human.isAlliedWith(owner);
    const spawn = game.inSpawnPhase();
    const land = game.map.isLand(tile);
    const hudIcon: Partial<Record<UnitType, string>> = {
      [UnitType.City]: "city",
      [UnitType.Factory]: "factory",
      [UnitType.DefensePost]: "defense",
      [UnitType.Port]: "port",
      [UnitType.MissileSilo]: "silo",
      [UnitType.SAMLauncher]: "sam",
      [UnitType.Radar]: "radar",
      [UnitType.Warship]: "warship",
      [UnitType.AtomBomb]: "atom",
      [UnitType.HydrogenBomb]: "hydrogen",
      [UnitType.MIRV]: "mirv",
    };
    const place = (type: UnitType, color: string): RadialSlice => ({
      id: type,
      label: unitLabel(type),
      color,
      icon: hudIcon[type] ?? "build",
      disabled: !!game.canBuild(human, type, tile),
      run: () => {
        const r = this.action({kind:'build',type,tile},()=>build(game, human, type, tile, false));
        notify(game, human, r);
        if (r.ok) this.unitLayer.ping(tile, NUKES.has(type) ? "#ff3b30" : human.color, NUKES.has(type) ? 12 : 5);
      },
    });
    const builds = [UnitType.City, UnitType.Factory, UnitType.DefensePost, UnitType.Port, UnitType.MissileSilo, UnitType.SAMLauncher, UnitType.Radar];
    const strikes = [UnitType.Warship, UnitType.AtomBomb, UnitType.HydrogenBomb, UnitType.MIRV].filter(
      (t) => !(NUKES.has(t) && game.config.settings.disableNukes) && !game.config.isUnitDisabled(t),
    );
    const near = this.unitNear(tile, game.map.tiles(5));
    const pending = !!owner && owner.incomingAllianceRequests.some((r) => r.requestor === human && r.status === "pending");
    const alliance = owner ? human.allianceWith(owner) : null;
    const expiring = allied && !!alliance && alliance.expiresAt - game.ticks <= 300;

    const info: RadialSlice = {
      id: "info",
      label: owner ? owner.name : "Info",
      color: "#475569",
      icon: "info",
      disabled: !owner || spawn,
      run: () => {
        if (owner) this.playerPanel.open(owner);
      },
    };
    const boat: RadialSlice = allied
      ? {
          id: "break",
          label: "Break alliance",
          color: "#dc2626",
          icon: "traitor",
          disabled: spawn,
          run: () => this.order({kind:'break',target:owner!.smallID},()=>game.breakAlliance(human, owner!)),
        }
      : own
        ? {
            id: "delete",
            label: "Remove building",
            color: "#ef4444",
            icon: "close",
            disabled: spawn || !near || near.owner !== human,
            run: () => {
              if (!near || near.owner !== human) return;
              this.order({kind:'delete',id:near.id},()=>{if (near.deleteAt >= 0) game.cancelDelete(human, near);else game.markDelete(human, near);});
            },
          }
        : {
            id: "boat",
            label: "Send boat",
            color: "#2a82c9",
            icon: "boat",
            disabled: spawn || !land || game.shoreTiles(human).length === 0,
            run: () => {
              const r = this.action({kind:'boat',tile,value:human.attackRatio},()=>sendBoat(game, human, tile, human.troops * human.attackRatio));
              notify(game, human, r);
              if (r.ok) this.unitLayer.ping(tile, human.color, 10);
            },
          };
    const ally: RadialSlice =
      allied && expiring
        ? {
            id: "extend",
            label: "Extend alliance",
            color: "#4ade80",
            icon: "alliance",
            run: () => this.order({kind:'extend',target:owner!.smallID},()=>game.extendAlliance(human, owner!)),
          }
        : allied
          ? { id: "ally", label: "Allied", color: "#4ade80", icon: "alliance", disabled: true }
          : {
              id: "ally",
              label: pending ? "Request sent" : "Request alliance",
              color: "#4ade80",
              icon: "alliance",
              disabled: spawn || !owner || own || owner.type === PlayerType.Bot || pending,
              run: () => {
                const r = this.requestAlliance(owner!);
                this.hud.toast(r ? `Alliance request sent to ${owner!.name}` : "Cannot send a request right now (cooldown)", r ? MessageType.Info : MessageType.Warn);
              },
            };
    const fourth: RadialSlice = own
      ? {
          id: "build",
          label: "Build",
          color: "#c8a84a",
          icon: "build",
          disabled: spawn,
          slices: builds.filter((t) => !game.config.isUnitDisabled(t)).map((t) => place(t, "#1e3a5f")),
        }
      : allied
        ? {
            id: "gold",
            label: "Donate gold",
            color: "#f59e0b",
            icon: "donate-gold",
            disabled: spawn || human.gold < 1,
            run: () => this.order({kind:'donateGold',target:owner!.smallID},()=>game.donateGold(human, owner!, human.gold / 3)),
          }
        : {
            id: "attack",
            label: "Special",
            color: "#ef4444",
            icon: "sword",
            disabled: spawn,
            slices: strikes.map((t) => place(t, "#b91c1c")),
          };
    const center: RadialSlice = spawn
      ? {
          id: "spawn",
          label: "Spawn here",
          color: "#0f2744",
          icon: "sword",
          disabled: !land || !game.canSpawnAt(tile, human),
          run: () => {
            if (!land) return this.hud.toast("Spawn on land", MessageType.Warn);
            if (!game.canSpawnAt(tile, human)) return this.hud.toast("That land is already claimed", MessageType.Warn);
            this.order({kind:"spawn",tile},()=>game.spawnPlayer(human,tile));
            this.unitLayer.ping(tile, human.color, game.config.spawnRadius() + 2);
            this.globe.setPreviewTiles([]);
            if (!this.online) this.globe.flyTo(tile, 700);
          },
        }
      : allied
        ? {
            id: "donate",
            label: "Donate troops",
            color: "#155e75",
            icon: "donate-troops",
            disabled: human.troops < 1,
            run: () => this.order({kind:'donateTroops',target:owner!.smallID},()=>game.donateTroops(human, owner!, human.troops / 3)),
          }
        : {
            id: "strike",
            label: "Attack",
            color: "#0f2744",
            icon: "sword",
            disabled: !land || own,
            run: () => this.doAttack(tile),
          };
    return { center, slices: [info, boat, ally, fourth] };
  }

  // ---------------- input ----------------
  private bindInput(): void {
    const canvas = this.globe.canvas;
    canvas.addEventListener("pointerdown", (e) => {
      this.down = { x: e.clientX, y: e.clientY, button: e.button, t: performance.now() };
    });
    canvas.addEventListener("pointerup", (e) => {
      const d = this.down;
      this.down = null;
      if (!d) return;
      const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);
      if (moved > 5 || performance.now() - d.t > 600) return;
      this.click(e.clientX, e.clientY, d.button, e);
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("pointermove", (e) => this.hover(e));
    canvas.addEventListener("pointerleave", () => {
      this.tooltip.style.display = "none";
      this.globe.setHover(-1, -1);
      if (!this.armed && !this.selectedWarship) this.unitLayer.setGhost(null, -1, false);
    });
    canvas.addEventListener(
      "wheel",
      (e) => {
        if (!e.shiftKey) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const human = this.game.human!;
        this.setRatio("attackRatio",Math.min(1, Math.max(0.01, human.attackRatio + (e.deltaY > 0 ? -0.05 : 0.05))));
        this.hud.syncSliders();
      },
      { passive: false, capture: true },
    );
    document.addEventListener("visibilitychange", () => {
      this.last = performance.now();
      this.acc = 0;
      this.globe.setTerrainView(false);
    });
    window.addEventListener("blur", () => this.globe.setTerrainView(false));
    window.addEventListener("keydown", (e) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select, [contenteditable]")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.repeat && !["1", "2"].includes(e.key)) return;
      const human = this.game.human!;
      if (this.devPanel?.handleKey(e)) return;
      if (e.key === "\\" || e.code === "Backslash") {
        this.setUiHidden(!this.uiHidden);
        return;
      }
      if (e.shiftKey && (e.key === "R" || e.key === "r")) {
        this.retaliate();
        return;
      }
      const buildKey = BuildBar.keyToType(e.key);
      if (buildKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        this.buildBar.toggle(buildKey);
        return;
      }
      switch (e.key) {
        case "F3":
          e.preventDefault();
          this.performanceVisible = !this.performanceVisible;
          this.performanceLabel.hidden = !this.performanceVisible;
          break;
        case "1":
          this.setRatio("attackRatio",Math.max(0.01, human.attackRatio - 0.1));
          this.hud.syncSliders();
          break;
        case "2":
          this.setRatio("attackRatio",Math.min(1, human.attackRatio + 0.1));
          this.hud.syncSliders();
          break;
        case " ":
          e.preventDefault();
          this.globe.setTerrainView(true);
          break;
        case "Escape":
          this.radial.close();
          this.cancelBuild();
          this.structurePanel.close();
          this.playerPanel.close();
          break;
        case "p":
        case "P":
          this.togglePause();
          break;
        case "h":
        case "H": {
          const t = this.anyTileOf(human);
          if (t >= 0) this.globe.flyTo(t);
          break;
        }
        case "]":
          if(this.online)break;
          this.speed = Math.min(this.game.isDev() ? 16 : 8, this.speed * 2);
          this.hud.toast(`Speed ×${this.speed}`);
          break;
        case "[":
          if(this.online)break;
          this.speed = Math.max(0.5, this.speed / 2);
          this.hud.toast(`Speed ×${this.speed}`);
          break;
      }
    });
    window.addEventListener("keyup", (e) => {
      if (e.key === " ") this.globe.setTerrainView(false);
    });
  }

  private click(x: number, y: number, button: number, e: PointerEvent): void {
    const game = this.game;
    const human = game.human!;
    const pick = this.globe.pick(x, y);
    this.structurePanel.close();
    if (!pick) return;
    const tile = pick.tile;
    const map = this.map;

    if (button === 2) {
      if (this.armed) return this.cancelBuild();
      if (this.selectedWarship) return this.clearWarshipSelect();
      this.structurePanel.close();
      this.playerPanel.close();
      if (!human.alive) {
        const owner = game.ownerAt(tile);
        if (owner) this.playerPanel.open(owner);
        return;
      }
      this.radial.open(x, y, this.actionRadial(tile));
      return;
    }
    if (button !== 0) return;

    if (game.isDev() && e.shiftKey && map.isLand(tile)) {
      if (!human.hasSpawned) {
        if (!game.canSpawnAt(tile, human)) return this.hud.toast("That land is already claimed", MessageType.Warn);
        this.order({kind:"spawn",tile},()=>game.spawnPlayer(human,tile));
        this.unitLayer.ping(tile, human.color, game.config.spawnRadius() + 2);
        this.globe.setPreviewTiles([]);
        this.globe.flyTo(tile, 700);
        return;
      }
      const r = game.map.tiles(10);
      const n = game.claimAround(human, tile, r);
      this.hud.toast(n ? `DEV claimed ${n} tiles` : "DEV already yours");
      return;
    }

    if (this.armed) {
      const type = this.armed;
      if(NUKES.has(type)&&this.planningMissiles){
        if(this.salvo?.isActive()){this.hud.toast("Finish or cancel the current salvo first",MessageType.Warn);return;}
        if(this.missileTargets.length>=20){this.hud.toast("Maximum 20 targets per salvo",MessageType.Warn);return;}
        const error=game.canBuild(human,type,tile,true);if(error){this.hud.toast(error,MessageType.Warn);return;}
        this.missileTargets.push(tile);this.updateMissilePlan();return;
      }
      // already paid for in the build bar
      const r = this.action({kind:'build',type,tile},()=>build(game, human, type, tile, true, this.buildBar.purchaseCredit));
      notify(game, human, r);
      if (r.ok) {
        this.unitLayer.ping(tile, NUKES.has(type) ? "#ff3b30" : human.color, NUKES.has(type) ? 12 : 5);
        this.buildBar.placed();
        this.armed = null;
        this.updateMissilePlan();
        this.unitLayer.setGhost(null, -1, false);
        this.globe.setPreviewTiles([]);
        this.globe.setRailGhost([]);
        this.previewTile = -1;
        this.hud.setMode(null);
        this.refreshTooltip();
      }
      return;
    }
    if (game.inSpawnPhase()) {
      if (!map.isLand(tile)) return this.hud.toast("Spawn on land", MessageType.Warn);
      if (!game.canSpawnAt(tile, human)) return this.hud.toast("That land is already claimed", MessageType.Warn);
      this.order({kind:"spawn",tile},()=>game.spawnPlayer(human,tile));
      this.unitLayer.ping(tile, human.color, game.config.spawnRadius() + 2);
      this.globe.setPreviewTiles([]);
      if (!this.online) this.globe.flyTo(tile, 700);
      return;
    }
    const ship = this.shipNear(tile, UnitType.Warship, human, map.tiles(8));
    if (this.selectedWarship && this.selectedWarship.active) {
      if (ship && ship !== this.selectedWarship) {
        this.selectWarship(ship);
        return;
      }
      if (ship === this.selectedWarship) {
        this.clearWarshipSelect();
        return;
      }
      if (map.isWater(tile)) {
        const r = this.action({kind:'patrol',unit:this.selectedWarship.id,tile},()=>moveWarship(game, human, this.selectedWarship!, tile));
        notify(game, human, r);
        if (r.ok) this.unitLayer.ping(tile, human.color, 10);
        this.clearWarshipSelect();
        return;
      }
      this.clearWarshipSelect();
    } else if (ship) {
      this.selectWarship(ship);
      return;
    }
    const owner = game.ownerAt(tile);
    if (owner === human) {
      const unit = this.unitNear(tile, map.tiles(4));
      if (unit && unit.isStructure()) this.structurePanel.open(unit, x, y);
      return;
    }
    if (!human.alive) {
      if (owner) this.playerPanel.open(owner);
      return;
    }
    if (e.altKey && owner) {
      this.playerPanel.open(owner);
      return;
    }
    this.doAttack(tile);
  }

  private unitNear(tile: number, r: number): Unit | null {
    let best: Unit | null = null;
    let bestD = r * r;
    for (const u of this.game.units) {
      if (!u.isStructure()) continue;
      const d = this.map.distSq(u.tile, tile);
      if (d <= bestD) {
        bestD = d;
        best = u;
      }
    }
    return best;
  }

  private shipNear(tile: number, type: UnitType, owner: Player, r: number): Unit | null {
    let best: Unit | null = null;
    let bestD = r * r;
    for (const u of owner.units) {
      if (u.type !== type || !u.active) continue;
      const d = this.map.distSq(u.tile, tile);
      if (d <= bestD) {
        bestD = d;
        best = u;
      }
    }
    return best;
  }

  private selectWarship(u: Unit): void {
    this.selectedWarship = u;
    this.hud.setMode("Warship selected — click water to set patrol", "right-click or Esc to cancel");
    this.unitLayer.setRangeOverlay(u.tile, this.game.config.warshipPatrolRange(), 0x7ec8ff);
  }

  private clearWarshipSelect(): void {
    this.selectedWarship = null;
    this.hud.setMode(null);
    this.unitLayer.setGhost(null, -1, false);
  }

  private hover(e: PointerEvent): void {
    this.hoverPos = { x: e.clientX, y: e.clientY };
    if (this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 5) {
      this.tooltip.style.display = "none";
      return;
    }
    this.needPick = true;
  }

  private applyHoverPick(): void {
    if (!this.needPick) return;
    this.needPick = false;
    const pick = this.globe.pick(this.hoverPos.x, this.hoverPos.y);
    if (!pick) {
      this.tooltip.style.display = "none";
      this.globe.setHover(-1, -1);
      if (!this.armed && !this.selectedWarship) this.unitLayer.setGhost(null, -1, false);
      if (this.game.inSpawnPhase() && !this.armed) this.globe.setPreviewTiles([]);
      this.hoverTile = -1;
      this.hasHoverPoint = false;
      return;
    }
    this.hoverTile = pick.tile;
    this.hoverPoint.copy(pick.point);
    this.hasHoverPoint = true;
    this.refreshTooltip();
    this.refreshSpawnPreview();
  }

  private showHoverRange(tile: number): void {
    const game = this.game;
    const sam = this.nearestStructure(tile, UnitType.SAMLauncher);
    if (sam) {
      this.unitLayer.setRangeOverlay(sam.tile, game.effectiveSamRange(sam), 0x7ec8ff);
      return;
    }
    const radar = this.nearestStructure(tile, UnitType.Radar);
    if (radar) {
      this.unitLayer.setRangeOverlay(radar.tile, game.config.radarRange(radar.level), 0x86efac);
      return;
    }
    const post = this.nearestStructure(tile, UnitType.DefensePost);
    if (post) {
      this.unitLayer.setRangeOverlay(post.tile, game.config.defensePostRange(), 0xffc14a);
      return;
    }
    this.unitLayer.setGhost(null, -1, false);
  }

  /** exact tile, or the icon the cursor is actually over (sprites cover several tiles when zoomed out) */
  private nearestStructure(tile: number, type: UnitType): Unit | undefined {
    const game = this.game;
    const here = game.structuresAt(tile).find((u) => u.type === type && u.active);
    if (here) return here;
    let best: Unit | undefined;
    let bestD = 8 * 8;
    for (const u of game.units) {
      if (u.type !== type || !u.active) continue;
      const d = game.map.distSq(u.tile, tile);
      if (d < bestD) {
        best = u;
        bestD = d;
      }
    }
    return best;
  }

  private ghostError: string | null = null;
  private previewTile = -1;
  private spawnPreviewTile = -1;

  private refreshSpawnPreview(): void {
    const game = this.game;
    const human = game.human;
    if (this.armed || !human || !game.inSpawnPhase() || human.hasSpawned) {
      if (this.spawnPreviewTile >= 0) {
        this.spawnPreviewTile = -1;
        if (!this.armed) this.globe.setPreviewTiles([]);
      }
      return;
    }
    const tile = this.hoverTile;
    if (tile === this.spawnPreviewTile) return;
    this.spawnPreviewTile = tile;
    if (tile < 0 || !game.canSpawnAt(tile, human)) {
      this.globe.setPreviewTiles([]);
      return;
    }
    this.globe.setPreviewTiles(game.spawnTilesAt(tile, human));
  }

  private refreshGhost(): void {
    const type = this.armed;
    let tile = this.hoverTile;
    if (!type || tile < 0) {
      this.unitLayer.setGhost(null, -1, false);
      if (this.previewTile >= 0) {
        this.previewTile = -1;
        this.globe.setPreviewTiles([]);
        this.globe.setRailGhost([]);
      }
      return;
    }
    const game = this.game;
    const cfg = game.config;
    const human = game.human!;
    this.ghostError = game.canBuild(human, type, tile, true);
    const snap = game.stackTarget(human, type, tile);
    if (snap) tile = snap.tile;
    let range = 0;
    let inner = 0;
    let rangeColor = 0xffffff;
    if (type === UnitType.DefensePost) range = cfg.defensePostRange();
    else if (type === UnitType.Factory || type === UnitType.City || type === UnitType.Port) {
      range = cfg.trainStationMaxRange();
      rangeColor = 0xffffff;
    } else if (type === UnitType.SAMLauncher) {
      const same = game.stackTarget(human, type, tile);
      range = same ? game.effectiveSamRange(same) : cfg.samRange(1);
      rangeColor = 0x7ec8ff;
    } else if (type === UnitType.Radar) {
      range = cfg.radarRange();
      rangeColor = 0x86efac;
    } else if (NUKES.has(type)) ({ outer: range, inner } = cfg.nukeMagnitude(type));
    const innerColor = 0xff453a;
    this.unitLayer.setGhost(type, tile, this.ghostError === null, range, inner, rangeColor, innerColor, !snap && this.hasHoverPoint ? this.hoverPoint : null, human.color);
    // defense post: light up the stretch of border it would reinforce
    // factory / city / port: ghost dual-rails that would be laid
    if (tile !== this.previewTile) {
      this.previewTile = tile;
      if (this.ghostError !== null) {
        this.globe.setPreviewTiles([]);
        this.globe.setRailGhost([]);
      } else if (type === UnitType.DefensePost) {
        this.globe.setRailGhost([]);
        this.globe.setPreviewTiles(game.defendedBorderPreview(human, tile));
      } else if (!snap && (type === UnitType.Factory || type === UnitType.City || type === UnitType.Port)) {
        this.globe.setPreviewTiles([]);
        const g = game.rail.ghostPlacement(tile, type);
        this.globe.setRailGhost(g.tiles, g.overlap);
      } else {
        this.globe.setPreviewTiles([]);
        this.globe.setRailGhost([]);
      }
    }
  }

  private refreshTooltip(): void {
    const tile = this.hoverTile;
    if (tile < 0 || !this.game) return;
    const e = this.hoverPos;
    const map = this.map;
    const game = this.game;
    const owner = game.ownerAt(tile);
    const country = map.countryAt(tile);
    let text: string;
    if (!map.isLand(tile)) {
      text = map.isImpassable(tile) ? "Antarctica · impassable ice" : "Ocean";
      this.globe.setHover(-1, -1);
    } else if (owner) {
      const human = game.human!;
      const rel = owner === human ? "" : human.isAlliedWith(owner) ? " · Ally" : owner.type !== "bot" ? ` · ${["Hostile", "Distrustful", "Neutral", "Friendly"][owner.relation(human)]}` : "";
      text = `${owner.name}${owner.isTraitor(game.ticks) ? " ☠" : ""} · ${fmtTroops(owner.troops)} troops · ${game.landPercent(owner).toFixed(1)}%${rel}${country ? ` · ${country.name}` : ""}`;
      const stack = game.structuresAt(tile);
      if (stack.length) {
        text += ` · ${stack
          .map((u) => (u.level > 1 ? `${unitLabel(u.type)} ×${u.level}` : unitLabel(u.type)))
          .join(" + ")}`;
      }
      const sam = this.nearestStructure(tile, UnitType.SAMLauncher);
      if (sam) {
        const shots =
          sam.cooldownUntil > game.ticks
            ? sam.samAmmo
            : sam.samAmmo > 0
              ? sam.samAmmo
              : sam.level;
        text += ` · intercept ${Math.round(game.effectiveSamRange(sam))} tiles · ${shots} shot${shots === 1 ? "" : "s"}`;
      }
      this.globe.setHover(owner.smallID, -1);
    } else {
      text = `${country ? country.name : "Unclaimed land"} · neutral${map.hasFallout(tile) ? " · ☢ fallout" : ""}`;
      this.globe.setHover(-1, country ? country.id : -1);
    }
    if (this.armed) {
      this.refreshGhost();
      if (this.ghostError !== null) {
        text = `${unitLabel(this.armed)} · ${this.ghostError}`;
      } else if (NUKES.has(this.armed)) {
        text = `${unitLabel(this.armed)} · click to ${this.planningMissiles ? "mark target" : "launch"}`;
      } else {
        const same = game.stackTarget(game.human!, this.armed, tile);
        text = same
          ? `${unitLabel(this.armed)} · click to upgrade → level ${same.level + 1}`
          : `${unitLabel(this.armed)} · click to ${game.stackTarget(game.human!, this.armed, tile) ? "upgrade" : "build"} here`;
      }
      this.tooltip.classList.toggle("bad", this.ghostError !== null);
      this.tooltip.classList.toggle("good", this.ghostError === null);
    } else if (this.selectedWarship?.active) {
      this.unitLayer.setRangeOverlay(this.selectedWarship.tile, game.config.warshipPatrolRange(), 0x7ec8ff);
      this.tooltip.classList.remove("bad", "good");
    } else {
      this.showHoverRange(tile);
      this.tooltip.classList.remove("bad", "good");
    }
    this.tooltip.textContent = text;
    this.tooltip.style.display = "block";
    this.tooltip.style.left = Math.min(e.x + 14, window.innerWidth - 320) + "px";
    this.tooltip.style.top = e.y + 18 + "px";
  }

  // ---------------- loop ----------------
  private frame(now: number): void {
    if (!this.running) return;
    requestAnimationFrame((t) => this.frame(t));
    const game = this.game;
    const dt = Math.min(250, now - this.last);
    this.last = now;
    if (document.hidden) { this.acc = 0; return; }
    if(this.online)this.online.advance();
    if (!this.online && !this.paused) {
      this.acc += dt * this.speed;
      let n = 0;
      const cap = Math.max(3, Math.ceil(this.speed * 2));
      const deadline = performance.now() + 8;
      while (this.acc >= TICK_MS && n < cap && (n === 0 || performance.now() < deadline)) {
        const tickStart = performance.now();
        game.tick();
        this.simulationMs += performance.now() - tickStart;
        this.simulationTicks++;
        this.acc -= TICK_MS;
        n++;
      }
      this.acc = Math.min(this.acc, TICK_MS * 2);
    }
    this.performanceFrames++;
    if (now - this.performanceSince >= 1000) {
      const fps = Math.round(this.performanceFrames * 1000 / Math.max(1, now - this.performanceSince));
      if (this.performanceVisible) this.performanceLabel.textContent = `${fps} FPS · ${(this.simulationMs / Math.max(1, this.simulationTicks)).toFixed(1)} ms/tick · ×${this.speed}`;
      this.performanceFrames = this.simulationMs = this.simulationTicks = 0;
      this.performanceSince = now;
    }
    if (!game.inSpawnPhase()) this.globe.setSpawnMode(false);
    this.applyHoverPick();

    if (this.selectedWarship && !this.selectedWarship.active) this.clearWarshipSelect();

    if (now - this.lastFront > 250) {
      this.lastFront = now;
      const f = this.attackLabels.fronts();
      this.globe.setFrontTiles(concat(f.out), concat(f.inc));
    }
    this.globe.syncTerritory();
    this.globe.syncTerrain();
    if(this.online){const active=activeSalvo(game,game.human!.smallID);if(active?.isActive()&&this.salvo!==active){this.salvo=active;this.updateMissilePlan();}}
    if(this.salvo && (!this.salvo.isActive() || this.salvo.orders.length!==this.shownSalvoCount)) {
      if(!this.salvo.isActive())this.salvo=null;
      this.updateMissilePlan();
    }
    this.unitLayer.update();
    this.globe.render();
    this.labels.update(now);
    this.attackLabels.update(now);
    this.buildLabels.update();
    this.goldFloats.update(now);
    this.alertFrame.tick(now);
    if (now - this.lastHud > 120) {
      this.lastHud = now;
      this.hud.update();
      this.buildBar.update();
      if (this.tooltip.style.display === "block") this.refreshTooltip();
      if (this.playerPanel.isOpen()) this.playerPanel.render();
      this.checkEnd();
    }
  }

  private checkEnd(): void {
    if (this.endShown) return;
    const game = this.game;
    const human = game.human!;
    const won = game.winner === human;
    const lost = human.diedAt >= 0 || (game.winner !== null && !won);
    if (!won && !lost) return;
    this.endShown = true;
    this.cancelBuild();
    showEndScreen(
      this.ui,
      game,
      won,
      () => {
        /* keep watching */
      },
      () => {if(this.online)this.online.send({type:"leave"});else location.reload();},
    );
  }
}

function* concat(sets: Iterable<number>[]): Iterable<number> {
  for (const s of sets) yield* s;
}

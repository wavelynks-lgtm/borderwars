import type { Execution, Game } from "../Game";
import type { Player } from "../Player";
import { PseudoRandom } from "../PseudoRandom";
import type { Unit } from "../Unit";
import { build, sendBoat } from "../actions";
import { AttackExecution } from "../executions/AttackExecution";
import { Difficulty, PlayerType, Relation, UnitType, type TileRef } from "../types";

const EMOJIS_ATTACK = ["⚔️", "😈", "🔥", "💀", "👊"];
const EMOJIS_CASUAL = ["👋", "🙂", "🤝", "🌍", "☕"];

/**
 * Smart AI for country nations. Personality: how often it decides, how many troops
 * it keeps in reserve, when it starts wars. Ported in spirit from OpenFront's nation AI.
 */
export class NationAI implements Execution {
  readonly activeDuringSpawnPhase = true;
  private game!: Game;
  private random!: PseudoRandom;
  private attackRate = 60;
  private attackTick = 0;
  private triggerRatio = 0.55;
  private reserveRatio = 0.35;
  private expandRatio = 0.15;
  private aggression = 1; // 0.6..1.4 personality
  private active = true;
  private firstAttackSent = false;
  private lastNukeAt = -Infinity;
  private lastEmojiAt = 0;

  constructor(
    readonly player: Player,
    private spawnTile: TileRef = -1,
  ) {}

  init(game: Game): void {
    this.game = game;
    this.random = new PseudoRandom(game.config.settings.seed * 131 + this.player.smallID * 17 + 5);
    this.triggerRatio = this.random.nextInt(36, 48) / 100;
    this.reserveRatio = this.random.nextInt(16, 26) / 100;
    this.expandRatio = this.random.nextInt(8, 14) / 100;
    this.aggression = 0.95 + this.random.next() * 0.55;
    switch (game.config.difficulty) {
      case Difficulty.Easy:
        this.attackRate = this.random.nextInt(42, 68);
        break;
      case Difficulty.Medium:
        this.attackRate = this.random.nextInt(34, 50);
        break;
      case Difficulty.Hard:
        this.attackRate = this.random.nextInt(26, 40);
        break;
      case Difficulty.Impossible:
        this.attackRate = this.random.nextInt(18, 32);
        break;
    }
    this.attackRate = Math.round(this.attackRate * game.config.aiCadence());
    this.attackTick = this.random.nextInt(0, this.attackRate - 1);
  }

  private get p(): Player {
    return this.player;
  }
  private get hard(): boolean {
    const d = this.game.config.difficulty;
    return d === Difficulty.Hard || d === Difficulty.Impossible;
  }

  tick(): void {
    const game = this.game;
    const p = this.p;
    if (game.inSpawnPhase()) {
      // SpawnTimerExecution places AI during the countdown.
      return;
    }
    if (game.devFreezeAi) return;
    if (!p.hasSpawned) return;
    if (!p.alive) {
      this.active = false;
      return;
    }
    if (!this.firstAttackSent) {
      this.firstAttackSent = true;
      this.expandNeutral(0.22);
      return;
    }
    const offset = game.ticks % this.attackRate;
    if (offset !== this.attackTick) {
      const third = Math.floor(this.attackRate / 3);
      if (offset === (this.attackTick + third) % this.attackRate || offset === (this.attackTick + 2 * third) % this.attackRate) {
        this.handleStructures();
      }
      if (this.early() && offset % Math.max(6, Math.floor(this.attackRate / 5)) === this.attackTick % Math.max(6, Math.floor(this.attackRate / 5))) {
        this.expandNeutral(0.2);
      }
      return;
    }
    this.handleAllianceRequests();
    this.handleStructures();
    this.maybeSpawnWarship();
    this.maybeDirectWarships();
    this.maybeAttack();
    this.maybeSendNuke();
    this.maybeEmoji();
  }

  private spawn(): void {
    const game = this.game;
    const map = game.map;
    let t = this.spawnTile;
    if (!game.canSpawnAt(t, this.p)) {
      // search nearby inside the same country
      let found = -1;
      const cx = map.x(t);
      const cy = map.y(t);
      const maxR = map.tiles(40);
      for (let r = 2; r <= maxR && found < 0; r += 2) {
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          const c = map.refWrapped(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r));
          if (c >= 0 && game.canSpawnAt(c, this.p) && (map.country[c] === this.p.countryId || r > maxR / 2)) {
            found = c;
            break;
          }
        }
      }
      t = found >= 0 ? found : game.randomTileInCountry(this.p.countryId, this.p);
    }
    if (t >= 0) game.spawnPlayer(this.p, t);
  }

  private ageSeconds(): number {
    if (this.p.spawnedAt < 0) return 0;
    return (this.game.ticks - this.p.spawnedAt) / 10;
  }
  private early(): boolean {
    return this.ageSeconds() < 90;
  }
  private expanding(): boolean {
    return this.p.outgoingAttacks.some((a) => a.isActive() && a.target === null);
  }
  /** Small repeated bites of empty land so the opening looks like a player growing the border. */
  private expandNeutral(share = 0.28): boolean {
    if (this.expanding()) return false;
    const p = this.p;
    const game = this.game;
    const { invaders, neutralHome } = game.homeFront(p);
    const emptyLeft = p.countryId !== 0 && game.unownedInCountry(p.countryId) > 0;
    const around = game.neighbors(p);
    if (!neutralHome && !emptyLeft && !around.neutral && invaders.length === 0) return false;
    return this.sendAttack(null, false, share);
  }

  // ---------------- attacking ----------------
  private maybeAttack(): void {
    const game = this.game;
    const p = this.p;
    if (this.expandNeutral(this.early() ? 0.24 : 0.32)) return;

    const { invaders } = game.homeFront(p);
    const around = game.neighbors(p);
    const enemies = (around.players.length ? around.players : invaders).filter((n) => !p.isFriendly(n));
    if (enemies.length === 0) {
      if (this.random.chance(3)) this.attackWithRandomBoat();
      return;
    }
    const incoming = this.findIncomingAttacker(enemies);
    if (incoming) {
      this.sendAttack(incoming, true);
      return;
    }
    this.maybeSendAllianceRequests(enemies);
    this.attackBestTarget([], enemies);
    if (this.random.chance(this.early() ? 2 : 3)) this.attackWithRandomBoat(enemies);
  }

  private maxPop(): number {
    return this.game.config.maxPopulation(this.p);
  }
  private hasReserve(): boolean {
    return this.p.troops / this.maxPop() >= this.reserveRatio;
  }
  private hasTrigger(): boolean {
    return this.p.troops / this.maxPop() >= this.triggerRatio;
  }

  private attackBestTarget(_friends: Player[], enemies: Player[]): void {
    const game = this.game;
    const p = this.p;
    // bots holding structures are juicy: recapture asap
    const botsWithStructures = enemies.filter((e) => e.type === PlayerType.Bot && e.hasStructures());
    if (botsWithStructures.length) {
      for (const b of botsWithStructures.slice(0, 2)) this.sendAttack(b, true);
      return;
    }
    if (!this.hasReserve()) return;
    if (!this.hasTrigger() && !this.random.chance(this.early() ? 3 : 6)) return;

    // 1) whoever is attacking us the hardest (ignore bots unless nothing else)
    const incoming = this.findIncomingAttacker(enemies);
    if (incoming) {
      this.sendAttack(incoming);
      return;
    }
    // 2) traitors and hostile nations
    const hostile = enemies.filter((e) => p.relation(e) === Relation.Hostile || e.isTraitor(game.ticks));
    if (hostile.length) {
      this.sendAttack(hostile[0]);
      return;
    }
    // 3) weakest neighbour, if we're clearly stronger (bots first — they're easy prey)
    const bots = enemies.filter((e) => e.type === PlayerType.Bot);
    if (bots.length) {
      bots.sort((a, b) => a.troops / a.numTiles - b.troops / b.numTiles);
      for (const b of bots.slice(0, 2)) this.sendAttack(b);
      return;
    }
    const others = enemies.filter((e) => e.type !== PlayerType.Bot);
    if (others.length === 0) return;
    others.sort((a, b) => a.troops / Math.max(1, a.numTiles) - b.troops / Math.max(1, b.numTiles));
    const target = others[0];
    const ratio = p.troops / Math.max(1, target.troops);
    const threshold = this.hard ? 0.9 / this.aggression : 1.15 / this.aggression;
    if (ratio >= threshold || (p.relation(target) <= Relation.Distrustful && this.random.chance(2))) {
      if (target.isHuman() && game.ticks - target.spawnedAt < game.config.spawnImmunityTicks()) return;
      this.sendAttack(target);
    }
  }

  private findIncomingAttacker(enemies: Player[]): Player | null {
    let best: Player | null = null;
    let biggest = 0;
    for (const a of this.p.incomingAttacks) {
      if (!a.isActive()) continue;
      if (a.owner.type === PlayerType.Bot) continue;
      if (!enemies.includes(a.owner)) continue;
      if (a.troops() > biggest) {
        biggest = a.troops();
        best = a.owner;
      }
    }
    return best;
  }

  private sendAttack(target: Player | null, urgent = false, share?: number): boolean {
    const p = this.p;
    const game = this.game;
    const max = this.maxPop();
    const keep = max * (target && !urgent ? this.reserveRatio : this.expandRatio);
    let troops: number;
    if (target === null) {
      const bite = Math.max(80, p.troops * (share ?? (this.early() ? 0.22 : 0.3)));
      troops = Math.min(p.troops - keep, bite);
    } else {
      troops = p.troops - keep;
      if (target.type !== PlayerType.Bot) troops = Math.min(troops, p.troops * (urgent ? 0.7 : 0.55));
    }
    if (troops < 80) return false;
    if (target && this.hard && troops < target.troops * 0.15) return false;
    if (target && p.isFriendly(target)) return false;
    const clipHome = target === null && p.countryId !== 0 && game.unownedInCountry(p.countryId) > 0;
    game.addExecution(new AttackExecution(troops, p, target, game.borderContact(p, target ? target.smallID : 0, clipHome ? p.countryId : 0)));
    if (target?.isHuman()) {
      this.maybeAttackEmoji(target);
      if (!p.embargoes.has(target.smallID)) game.setEmbargo(p, target, true);
    }
    return true;
  }

  private attackWithRandomBoat(borderingEnemies: Player[] = []): void {
    const game = this.game;
    const p = this.p;
    if (p.unitCount(UnitType.TransportShip) >= game.config.boatMaxNumber()) return;
    const shore = game.shoreTiles(p);
    if (shore.length === 0) return;
    const src = this.random.randElement(shore);
    const map = game.map;
    const x = map.x(src);
    const y = map.y(src);
    for (let i = 0; i < 150; i++) {
      const R = map.tiles(150);
      const t = map.refWrapped(x + this.random.nextInt(-R, R), y + this.random.nextInt(-R, R));
      if (t < 0 || !map.isLand(t) || !map.isShore(t)) continue;
      const owner = game.ownerAt(t);
      if (owner === p) continue;
      if (owner && (p.isFriendly(owner) || borderingEnemies.includes(owner))) continue;
      if (owner && owner.troops > p.troops && owner.type !== PlayerType.Bot) continue;
      if (owner && owner.isHuman() && game.ticks - owner.spawnedAt < game.config.spawnImmunityTicks()) continue;
      const troops = Math.min(p.troops / 5, Math.max(0, p.troops - this.maxPop() * this.reserveRatio));
      if (troops < 200) return;
      sendBoat(game, p, t, troops);
      if (owner?.isHuman() && !p.embargoes.has(owner.smallID)) game.setEmbargo(p, owner, true);
      return;
    }
  }

  // ---------------- diplomacy ----------------
  private maybeSendAllianceRequests(enemies: Player[]): void {
    const p = this.p;
    const game = this.game;
    if (enemies.length < 2 && !this.random.chance(4)) return;
    for (const e of enemies) {
      if (e.type === PlayerType.Bot) continue;
      if (p.relation(e) < Relation.Neutral) continue;
      if (e.isTraitor(game.ticks)) continue;
      if (!this.random.chance(3)) continue;
      // ally with the strongest threats first
      if (e.troops > p.troops * 0.8 || this.random.chance(3)) {
        game.requestAlliance(p, e);
        return;
      }
    }
  }

  private handleAllianceRequests(): void {
    const p = this.p;
    const game = this.game;
    for (const req of [...p.incomingAllianceRequests]) {
      const other = req.requestor;
      const rel = p.relation(other);
      let accept = false;
      if (other.isTraitor(game.ticks)) accept = false;
      else if (rel === Relation.Friendly) accept = true;
      else if (rel === Relation.Neutral) accept = this.random.bool(game.config.difficulty === Difficulty.Impossible ? 0.35 : 0.7);
      else if (rel === Relation.Distrustful) accept = this.random.bool(0.15);
      // impossible nations refuse alliances with much weaker players
      if (game.config.difficulty === Difficulty.Impossible && other.troops < p.troops * 0.3) accept = false;
      if (accept) game.acceptAlliance(req);
      else game.rejectAlliance(req);
    }
    // extend alliances with friends that are about to expire
    for (const a of p.alliances) {
      const other = a.a === p ? a.b : a.a;
      if (a.expiresAt - game.ticks < 60 * 10 && p.relation(other) >= Relation.Neutral && this.random.chance(2)) {
        game.extendAlliance(p, other);
      }
    }
    // help allies under attack occasionally
    if (this.random.chance(6)) {
      for (const ally of p.allies()) {
        if (ally.incomingAttacks.length > 0 && p.troops > this.maxPop() * 0.6) {
          game.donateTroops(p, ally, p.troops / 3);
          break;
        }
      }
    }
  }

  private maybeEmoji(): void {
    const game = this.game;
    const human = game.online ? game.allPlayers().find(p => p.type === PlayerType.Human) : game.human;
    if (!human || !human.alive) return;
    if (game.ticks - this.lastEmojiAt < 60 * 10) return;
    if (!this.random.chance(30)) return;
    const { players } = game.neighbors(this.p);
    if (!players.includes(human) && !this.p.isAlliedWith(human)) return;
    this.lastEmojiAt = game.ticks;
    game.sendEmoji(this.p, human, this.random.randElement(EMOJIS_CASUAL));
  }
  private maybeAttackEmoji(target: Player): void {
    if (this.game.ticks - this.lastEmojiAt < 30 * 10 || !this.random.chance(3)) return;
    this.lastEmojiAt = this.game.ticks;
    this.game.sendEmoji(this.p, target, this.random.randElement(EMOJIS_ATTACK));
  }

  // ---------------- structures ----------------
  private randomTiles(n: number, filter: (t: TileRef) => boolean): TileRef[] {
    const tiles = this.p.tiles;
    const size = tiles.size;
    if (size === 0) return [];
    const out: TileRef[] = [];
    // sample by skipping: iterate once, picking with probability n*4/size
    const prob = Math.min(1, (n * 6) / size);
    for (const t of tiles) {
      if (this.random.next() < prob && filter(t)) {
        out.push(t);
        if (out.length >= n) break;
      }
    }
    return out;
  }

  private interiorTile(): TileRef {
    const p = this.p;
    const map = this.game.map;
    const cands = this.randomTiles(12, (t) => !p.borderTiles.has(t) && map.isLand(t));
    if (cands.length === 0) return this.randomTiles(1, () => true)[0] ?? -1;
    // prefer tiles far from the border: approximate with distance to a few border samples
    let best = cands[0];
    let bestScore = -1;
    const borderSamples: TileRef[] = [];
    let i = 0;
    for (const b of p.borderTiles) {
      if (i++ % Math.max(1, Math.floor(p.borderTiles.size / 30)) === 0) borderSamples.push(b);
      if (borderSamples.length >= 30) break;
    }
    for (const c of cands) {
      let minD = Infinity;
      for (const b of borderSamples) minD = Math.min(minD, map.distSq(c, b));
      if (minD > bestScore) {
        bestScore = minD;
        best = c;
      }
    }
    return best;
  }

  private tryBuild(type: UnitType, tile: TileRef): boolean {
    if (tile < 0) return false;
    return build(this.game, this.p, type, tile).ok;
  }

  private handleStructures(): void {
    const game = this.game;
    const p = this.p;
    const cfg = game.config;
    if (!p.alive) return;
    const minutes = game.elapsedSeconds() / 60;
    const cities = p.unitCount(UnitType.City);
    const { players: neighbors } = game.neighbors(p);
    const enemies = neighbors.filter((n) => !p.isFriendly(n) && n.type !== PlayerType.Bot);
    const refTiles = p.landArea * cfg.tileScale;

    // City: the main investment
    const cityCost = cfg.unitCost(UnitType.City, game.ownedForCost(p, UnitType.City));
    if (p.gold >= cityCost && cities < 2 + refTiles / 2500) {
      if (this.tryBuild(UnitType.City, this.emptyNear(this.interiorTile(), 8))) return;
    }
    // Factory: rails + train gold. After the first city, then one per ~few cities.
    const factories = p.unitCount(UnitType.Factory);
    const factoryCost = cfg.unitCost(UnitType.Factory, game.ownedForCost(p, UnitType.Factory));
    if (p.gold >= factoryCost && cities >= 1 && factories < 1 + Math.floor(cities / 2) && this.random.chance(2)) {
      const city = p.unitsOf(UnitType.City)[0];
      if (city && this.tryBuild(UnitType.Factory, this.emptyNear(city.tile, 10))) return;
      if (this.tryBuild(UnitType.Factory, this.emptyNear(this.interiorTile(), 8))) return;
    }
    // Defense posts on contested borders
    if (enemies.length > 0) {
      const posts = p.unitCount(UnitType.DefensePost);
      const cost = cfg.unitCost(UnitType.DefensePost, posts);
      if (p.gold >= cost && posts < enemies.length * 2 + 1 && this.random.chance(2)) {
        const strongest = enemies.reduce((a, b) => (a.troops > b.troops ? a : b));
        const tile = this.borderTileFacing(strongest);
        if (this.tryBuild(UnitType.DefensePost, tile)) return;
      }
    }
    // Port
    const ports = p.unitCount(UnitType.Port);
    const portCost = cfg.unitCost(UnitType.Port, game.ownedForCost(p, UnitType.Port));
    if (p.gold >= portCost * 1.2 && ports < 1 + Math.floor(refTiles / 8000) && cities >= 1 && this.random.chance(2)) {
      const shore = game.shoreTiles(p);
      if (shore.length) {
        for (let i = 0; i < 6; i++) {
          if (this.tryBuild(UnitType.Port, this.random.randElement(shore))) return;
        }
      }
    }
    // Missile silo (mid/late game, not on easy)
    if (!cfg.settings.disableNukes && cfg.difficulty !== Difficulty.Easy && minutes > 6) {
      const silos = p.unitCount(UnitType.MissileSilo);
      const siloCost = cfg.unitCost(UnitType.MissileSilo, silos);
      if (p.gold >= siloCost * 1.5 && silos < 1 + Math.floor(refTiles / 15000) && cities >= 2) {
        if (this.tryBuild(UnitType.MissileSilo, this.emptyNear(this.interiorTile(), 8))) return;
      }
    }
    // SAM if nukes are flying
    if (!cfg.settings.disableNukes) {
      let nukesExist = this.p.lastNukedBy !== null;
      if (!nukesExist) {
        for (const u of game.units) {
          if (u.type === UnitType.MissileSilo && u.owner !== p && !p.isFriendly(u.owner)) {
            nukesExist = true;
            break;
          }
        }
      }
      const sams = p.unitCount(UnitType.SAMLauncher);
      const samCost = cfg.unitCost(UnitType.SAMLauncher, sams);
      if (nukesExist && p.gold >= samCost * 1.3 && sams < Math.max(1, cities) && minutes > 8) {
        const city = p.unitsOf(UnitType.City)[sams % Math.max(1, cities)];
        const tile = city ? this.emptyNear(city.tile, 14) : this.interiorTile();
        if (this.tryBuild(UnitType.SAMLauncher, tile)) return;
      }
      const radars = p.unitCount(UnitType.Radar);
      const radarCost = cfg.unitCost(UnitType.Radar, radars);
      if (sams > 0 && radars < sams && p.gold >= radarCost && this.random.chance(2)) {
        const sam = p.unitsOf(UnitType.SAMLauncher)[radars % Math.max(1, sams)];
        const tile = sam ? this.emptyNear(sam.tile, 18) : this.interiorTile();
        if (this.tryBuild(UnitType.Radar, tile)) return;
      }
    }
    // Upgrades when rich
    if (cities > 0 && p.gold > cityCost * 2.5 && this.random.chance(2)) {
      const city = p.unitsOf(UnitType.City).sort((a, b) => a.level - b.level)[0];
      if (city && city.level < cfg.maxLevel(UnitType.City)) {
        const cost = cfg.upgradeCost(UnitType.City, city.level);
        if (p.removeGold(cost)) city.level++;
      }
    }
  }

  private nearTile(center: TileRef, r: number): TileRef {
    const map = this.game.map;
    for (let i = 0; i < 20; i++) {
      const t = map.refWrapped(map.x(center) + this.random.nextInt(-r, r), map.y(center) + this.random.nextInt(-r, r));
      if (t >= 0 && map.owner[t] === this.p.smallID && map.isLand(t)) return t;
    }
    return center;
  }

  /** owned empty land near `center` so AI does not stack a new building on an existing one */
  private emptyNear(center: TileRef, r: number): TileRef {
    const map = this.game.map;
    const game = this.game;
    if (center < 0) return this.interiorTile();
    for (let i = 0; i < 40; i++) {
      const t = map.refWrapped(map.x(center) + this.random.nextInt(-r, r), map.y(center) + this.random.nextInt(-r, r));
      if (t < 0 || t === center || map.owner[t] !== this.p.smallID || !map.isLand(t)) continue;
      if (game.structuresAt(t).length === 0) return t;
    }
    return this.interiorTile();
  }

  private borderTileFacing(enemy: Player): TileRef {
    const map = this.game.map;
    const buf: TileRef[] = [0, 0, 0, 0];
    const cands: TileRef[] = [];
    let i = 0;
    const step = Math.max(1, Math.floor(this.p.borderTiles.size / 400));
    for (const t of this.p.borderTiles) {
      if (i++ % step !== 0) continue;
      const n = map.neighbors4(t, buf);
      for (let k = 0; k < n; k++) {
        if (map.owner[buf[k]] === enemy.smallID) {
          cands.push(t);
          break;
        }
      }
    }
    if (cands.length === 0) return -1;
    // step a few tiles inward from the border for safety
    const b = this.random.randElement(cands);
    return this.nearTile(b, map.tiles(4));
  }

  private maybeSpawnWarship(): void {
    const p = this.p;
    const game = this.game;
    const ports = p.unitsOf(UnitType.Port);
    if (ports.length === 0 || game.config.difficulty === Difficulty.Easy) return;
    const ships = p.unitCount(UnitType.Warship);
    const cost = game.config.unitCost(UnitType.Warship, ships);
    if (p.gold < cost * 2 || ships >= ports.length) return;
    if (!this.random.chance(3)) return;
    const port = this.random.randElement(ports);
    const map = game.map;
    for (let i = 0; i < 10; i++) {
      const R = map.tiles(8);
      const t = map.refWrapped(map.x(port.tile) + this.random.nextInt(-R, R), map.y(port.tile) + this.random.nextInt(-R, R));
      if (t >= 0 && map.isWater(t)) {
        build(game, p, UnitType.Warship, t);
        return;
      }
    }
  }

  private maybeDirectWarships(): void {
    const p = this.p;
    const game = this.game;
    const ships = p.units.filter((u) => u.type === UnitType.Warship && u.active);
    if (ships.length === 0) return;
    const { players } = game.neighbors(p);
    const enemies = players.filter((n) => !p.isFriendly(n) && n.type !== PlayerType.Bot);
    if (enemies.length === 0) return;
    const enemy = this.random.randElement(enemies);
    const shore = game.shoreTiles(enemy);
    if (shore.length === 0) return;
    const dest = this.random.randElement(shore);
    const map = game.map;
    for (const u of ships) {
      if (!this.random.chance(3)) continue;
      const R = map.tiles(12);
      for (let i = 0; i < 8; i++) {
        const t = map.refWrapped(map.x(dest) + this.random.nextInt(-R, R), map.y(dest) + this.random.nextInt(-R, R));
        if (t >= 0 && map.isWater(t)) {
          u.patrolTile = t;
          u.path = [];
          u.pathIndex = 0;
          break;
        }
      }
    }
  }

  // ---------------- nukes ----------------
  private maybeSendNuke(): void {
    const game = this.game;
    const p = this.p;
    const cfg = game.config;
    if (cfg.settings.disableNukes || cfg.difficulty === Difficulty.Easy) return;
    const silos = p.unitsOf(UnitType.MissileSilo).filter((s) => !s.constructing && s.cooldownUntil <= game.ticks);
    if (silos.length === 0) return;
    if (game.ticks - this.lastNukeAt < (cfg.difficulty === Difficulty.Medium ? 240 : 120) * 10) return;
    const { players: neighbors } = game.neighbors(p);
    const enemies = neighbors.filter((n) => !p.isFriendly(n) && n.type !== PlayerType.Bot);
    // targets: who attacks us, hostile, or someone who nuked us
    let target: Player | null = this.findIncomingAttacker(enemies);
    if (!target && this.p.lastNukedBy && this.p.lastNukedBy.alive && !p.isFriendly(this.p.lastNukedBy)) target = this.p.lastNukedBy;
    if (!target) {
      const hostile = enemies.filter((e) => p.relation(e) === Relation.Hostile);
      if (hostile.length) target = hostile.reduce((a, b) => (a.troops > b.troops ? a : b));
    }
    if (!target && this.hard && enemies.length && this.random.chance(4)) {
      target = enemies.reduce((a, b) => (a.troops > b.troops ? a : b));
      if (target.troops < p.troops * 0.7) target = null; // only nuke real threats
    }
    if (!target) return;
    if (target.isHuman() && game.ticks - target.spawnedAt < 60 * 10) return;
    const minutes = game.elapsedSeconds() / 60;
    const useMirv = p.gold >= cfg.unitCost(UnitType.MIRV, p.stats.nukesLaunched) * 1.1 && target.landArea * cfg.tileScale > 18_000 && minutes > 10 && this.random.chance(3);
    const useHydro = !useMirv && p.gold >= cfg.unitCost(UnitType.HydrogenBomb, 0) * 1.4 && target.landArea * cfg.tileScale > 20000 && this.random.chance(3);
    const type = useMirv ? UnitType.MIRV : useHydro ? UnitType.HydrogenBomb : UnitType.AtomBomb;
    if (p.gold < cfg.unitCost(type, game.ownedForCost(p, type)) * 1.3) return;
    const tile = this.pickNukeTarget(target, silos, type);
    if (tile < 0) return;
    if (build(game, p, type, tile).ok) this.lastNukeAt = game.ticks;
  }

  private pickNukeTarget(target: Player, silos: Unit[], type: UnitType): TileRef {
    const game = this.game;
    const map = game.map;
    const { outer } = game.config.nukeMagnitude(type);
    const safe = (t: TileRef): boolean => {
      // no own / allied tiles within the blast radius (sampled ring + centre)
      const cx = map.x(t);
      const cy = map.y(t);
      const check = (x: number, y: number) => {
        const c = map.refWrapped(x, y);
        if (c < 0) return true;
        const o = game.ownerAt(c);
        return o !== null && (o === this.p || this.p.isFriendly(o));
      };
      if (check(cx, cy)) return false;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        if (check(Math.round(cx + Math.cos(a) * (outer + 3)), Math.round(cy + Math.sin(a) * (outer + 3)))) return false;
        if (check(Math.round(cx + Math.cos(a) * (outer * 0.5)), Math.round(cy + Math.sin(a) * (outer * 0.5)))) return false;
      }
      return true;
    };
    const inRange = (t: TileRef) => silos.some((s) => game.siloCanReach(s, t));
    // prefer structures
    const structures = target.units.filter((u) => u.isStructure() && u.active);
    this.random.shuffle(structures);
    for (const s of structures) if (inRange(s.tile) && safe(s.tile)) return s.tile;
    // otherwise sample target tiles
    const tiles = target.tiles;
    const prob = Math.min(1, 40 / Math.max(1, tiles.size));
    for (const t of tiles) {
      if (this.random.next() >= prob) continue;
      if (inRange(t) && safe(t)) return t;
    }
    return -1;
  }

  isActive(): boolean {
    return this.active;
  }
}

import { Difficulty, NUKES, PlayerType, TerrainType, UnitType, type GameSettings } from "./types";

export interface AttackLogicInput {
  terrain: TerrainType;
  attackTroops: number;
  attacker: { type: PlayerType; numTiles: number };
  defender: {
    type: PlayerType;
    numTiles: number;
    troops: number;
    isTraitor: boolean;
  } | null;
  defenderHasDefensePost: boolean;
  falloutRatio: number | null;
  borderSize: number;
  /** tiles in the country/territory being filled — bigger land needs a bigger send */
  landTiles: number;
  /** Elapsed combat ticks; omitted only when evaluating upstream baseline formulas. */
  elapsedTicks?: number;
}

export interface AttackLogicResult {
  attackerTroopLoss: number;
  defenderTroopLoss: number;
  /** share of the tick's conquest budget this tile consumes */
  tickFraction: number;
}

// --- tunables (mirroring the OpenFront/FrontWars balance) ---
const LARGE_TERRITORY_MIDPOINT = 300_000;
const LARGE_TERRITORY_STEEPNESS = 2.5;
const LARGE_ATTACKER_DEPTH = 0.7;
const LARGE_DEFENDER_DEPTH = 0.3;
const LARGE_ATTACKER_SPEED_DEPTH = 0.73;
const BOT_DEFENDER_LOSS_MULT = 0.7;
const ATTACKER_LOSS_BASE = 0.463;
const ATTACKER_LOSS_PER_DENSITY = 0.0039;
const TERRA_NULLIUS_COST_SCALE = 2000;
const TERRA_NULLIUS_MIN_COST = 5;
const TERRA_NULLIUS_MAX_COST = 100;
const SPEED_COST_DIVISOR = 8.55;

export const TICKS_PER_SECOND = 10;
/** land tiles on the FrontWars/OpenFront world map the balance numbers were tuned for */
const REFERENCE_LAND_TILES = 652_000;

function within(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
function sigmoid(x: number, steepness: number, mid: number): number {
  return 1 / (1 + Math.exp(-steepness * (x - mid)));
}
function largeTerritoryBonus(numTiles: number, depth: number): number {
  return 1 - depth * sigmoid(Math.log(Math.max(1, numTiles)), LARGE_TERRITORY_STEEPNESS, Math.log(LARGE_TERRITORY_MIDPOINT));
}
function terrainAttackBase(terrain: TerrainType): { mag: number; tileCost: number } {
  switch (terrain) {
    case TerrainType.Plains:
      return { mag: 80, tileCost: 16.5 };
    case TerrainType.Highland:
      return { mag: 100, tileCost: 20 };
    case TerrainType.Mountain:
      return { mag: 120, tileCost: 25 };
    default:
      return { mag: 80, tileCost: 16.5 };
  }
}

export interface PlayerLike {
  type: PlayerType;
  numTiles: number;
  landArea?: number;
  population: number;
  troops: number;
  workers: number;
  cityLevels: number;
}

export class Config {
  /** tiles per reference tile (map width / 2048): every tile-unit distance is multiplied by this */
  readonly k: number;
  /** reference land tiles per unit of spherical land area; multiply per-tile costs by tile area */
  readonly tileScale: number;

  constructor(
    readonly settings: GameSettings,
    mapScale = 1,
    numLandTiles = 490_000,
  ) {
    this.k = mapScale;
    this.tileScale = REFERENCE_LAND_TILES / Math.max(1, numLandTiles);
  }

  /** scale a distance/speed given in reference tiles to this map */
  tiles(n: number): number {
    return n * this.k;
  }
  /**
   * Compact radii for other globe effects (one twelfth of reference tile units).
   * Defense Posts and SAM coverage deliberately use full-scale radii instead.
   */
  range(n: number): number {
    return Math.max(1, Math.round(n * this.k / 12));
  }
  growthRate(): number {
    return 1;
  }
  /** multiplier on the ticks between AI decisions */
  aiCadence(): number {
    return 1;
  }

  get difficulty(): Difficulty {
    return this.settings.difficulty;
  }

  spawnPhaseTicks(): number {
    return this.settings.spawnPhaseSeconds * TICKS_PER_SECOND;
  }
  spawnImmunityTicks(): number {
    return 5 * TICKS_PER_SECOND;
  }
  /** OpenFront has no pre-attack hang — tiles flip the same tick the army arrives */
  attackMarchTicks(): number {
    return 0;
  }
  winPercent(): number {
    return this.settings.winPercent;
  }
  minDistanceBetweenPlayers(): number {
    return 30;
  }
  /** OpenFront `getSpawnTiles`: Euclidean radius 4. */
  spawnRadius(): number {
    return Math.max(1, Math.round(2 * this.k));
  }

  // ---------- population / economy ----------
  /** Everyone builds population from zero; infinite troops is an explicit sandbox override. */
  startPopulation(type: PlayerType): number {
    if (this.settings.infiniteTroops && type === PlayerType.Human) return 1_000_000;
    return 0;
  }

  /**
   * OpenFront `maxTroops`: 2 × (area^0.6 × 1000 + 50_000) + cityLevels × 250_000.
   * `tileScale` maps this globe onto the 2048-wide reference so the same country
   * yields the same cap. More land → higher cap → faster troop/worker growth
   * until you approach the bar.
   */
  maxPopulation(p: PlayerLike): number {
    if (this.settings.infiniteTroops && p.type === PlayerType.Human) return 1_000_000_000;
    const tiles = Math.max(1, (p.landArea ?? p.numTiles) * this.tileScale);
    const base = 2 * (Math.pow(tiles, 0.6) * 1000 + 50_000) + p.cityLevels * this.cityPopulationIncrease();
    if (p.type === PlayerType.Bot) return base / 3;
    if (p.type === PlayerType.Human) return base;
    switch (this.difficulty) {
      case Difficulty.Easy:
        return base * 0.5;
      case Difficulty.Medium:
        return base * 0.75;
      case Difficulty.Hard:
        return base;
      case Difficulty.Impossible:
        return base * 1.25;
    }
  }

  cityPopulationIncrease(): number {
    return 250_000;
  }

  /**
   * OpenFront `troopIncreaseRate`: (10 + troops^0.73 / 4) × (1 − troops / max).
   */
  populationIncrease(p: PlayerLike): number {
    const max = this.maxPopulation(p);
    if (max <= 0) return 0;
    const people = Math.max(0, p.population);
    let toAdd = 10 + Math.pow(people, 0.73) / 4;
    toAdd *= 1 - people / max;
    if (p.type === PlayerType.Bot) toAdd *= 0.5;
    if (p.type === PlayerType.Nation) {
      switch (this.difficulty) {
        case Difficulty.Easy:
          toAdd *= 0.9;
          break;
        case Difficulty.Medium:
          toAdd *= 0.95;
          break;
        case Difficulty.Hard:
          break;
        case Difficulty.Impossible:
          toAdd *= 1.05;
          break;
      }
    }
    return Math.max(0, Math.min(people + toAdd, max) - people);
  }

  /** how many people can shift between troops/workers per tick */
  troopAdjustmentRate(p: PlayerLike): number {
    return Math.max(10, this.maxPopulation(p) / 500);
  }

  /**
   * OpenFront's base income, adjusted by workforce allocation. The default
   * 40% workers keeps base income; allocating more workers trades army for gold.
   */
  goldPerTick(p: PlayerLike, _linkedFactoryLevels = 0): number {
    if (this.settings.infiniteGold && p.type === PlayerType.Human) return 0;
    const base = p.type === PlayerType.Bot ? 50 : 100;
    const workerShare = p.workers / Math.max(1, p.population);
    const workforce = 0.25 + 0.75 * within(workerShare / 0.4, 0, 2);
    return base * workforce * this.settings.goldMultiplier;
  }

  cityGrowthMult(_cityLevels: number): number {
    return 1;
  }

  /** gold for finishing a country/state, scaled by your share of its land */
  countryClaimGold(yourTiles: number, totalTiles: number): number {
    const total = Math.max(1, totalTiles);
    const share = Math.max(0, Math.min(1, yourTiles / total));
    const size = total * this.tileScale;
    return Math.floor((18_000 * Math.min(1, size / 3000) + size * 1.8) * share * this.settings.goldMultiplier);
  }
  /** extra troops (internal) for the same claim */
  countryClaimTroops(yourTiles: number, totalTiles: number): number {
    const total = Math.max(1, totalTiles);
    const share = Math.max(0, Math.min(1, yourTiles / total));
    const size = total * this.tileScale;
    return Math.max(0, Math.floor((500 * Math.min(1, size / 3000) + size * 0.06) * share));
  }
  /** bonus for eliminating an AI nation/tribe, scaled by the land they held */
  nationTakeoverGold(tiles: number): number {
    const size = Math.max(1, tiles) * this.tileScale;
    return Math.floor((14_000 + size * 2.4) * this.settings.goldMultiplier);
  }
  nationTakeoverTroops(tiles: number): number {
    const size = Math.max(1, tiles) * this.tileScale;
    return Math.max(0, Math.floor(400 + size * 0.09));
  }

  // ---------- combat ----------
  attackAmount(type: PlayerType, troops: number, attackRatio: number): number {
    if (type === PlayerType.Bot) return troops / 20;
    return troops * attackRatio;
  }
  boatAttackAmount(troops: number, attackRatio: number): number {
    return Math.floor(troops * attackRatio);
  }
  boatMaxNumber(): number {
    if (this.isUnitDisabled(UnitType.TransportShip)) return 0;
    return 3;
  }
  boatSpeed(): number {
    return this.tiles(0.42);
  }
  retreatMalusPercent(): number {
    return 25;
  }
  annexTilesThreshold(): number {
    return Math.max(1, Math.round(3 * this.k * this.k));
  }

  defensePostRange(): number {
    return Math.max(1, Math.round(this.tiles(8)));
  }
  defensePostDefenseBonus(): number {
    return 5;
  }
  defensePostSpeedBonus(): number {
    return 3;
  }
  traitorDefenseDebuff(): number {
    return 0.5;
  }
  traitorSpeedDebuff(): number {
    return 0.8;
  }
  traitorDuration(): number {
    return 30 * TICKS_PER_SECOND;
  }
  falloutDefenseModifier(falloutRatio: number): number {
    return 5 - falloutRatio * 2;
  }
  falloutDuration(): number {
    return 240 * TICKS_PER_SECOND;
  }

  /** An army can support only a limited length of simultaneously advancing front.
   * 200 internal troops (20 displayed) per reference-map edge. Convert back
   * to physical map pixels so increasing resolution cannot grant extra speed.
   */
  supportedAttackFront(borderSize: number, troops: number): number {
    const supported = Math.max(1, troops / 200);
    return Math.min(borderSize, supported / Math.sqrt(this.tileScale));
  }

  /**
   * OpenFront `attackLogic`, scaled for this globe.
   *
   * The caller supplies spherical territory areas and weights each conquered
   * pixel's casualties and time by its latitude. Reference front length and
   * area conversion reproduces upstream per-reference-tile costs and pacing.
   */
  attackLogic(input: AttackLogicInput): AttackLogicResult {
    const { attackTroops, attacker, defender } = input;
    let { mag, tileCost } = terrainAttackBase(input.terrain);

    if (defender !== null && input.defenderHasDefensePost) {
      mag *= this.defensePostDefenseBonus();
      tileCost *= this.defensePostSpeedBonus();
    }
    if (input.falloutRatio !== null) {
      const f = this.falloutDefenseModifier(input.falloutRatio);
      mag *= f;
      tileCost *= f;
    }

    const area = this.tileScale;
    const timeScale = area;
    const attackerTiles = Math.max(1, attacker.numTiles * area);
    const defenderTiles = defender ? Math.max(1, defender.numTiles * area) : 1;
    // Input is surface border length in equatorial pixels, converted to the
    // same reference map as territory area and casualty costs.
    const logicalBorder = Math.max(1, input.borderSize * Math.sqrt(area));

    if (defender === null) {
      const tickBudget = logicalBorder * 2;
      return this.balanceLandAdvance({
        attackerTroopLoss: (area * mag) / (attacker.type === PlayerType.Bot ? 10 : 5),
        defenderTroopLoss: 0,
        tickFraction:
          within((TERRA_NULLIUS_COST_SCALE * tileCost) / Math.max(1, attackTroops), TERRA_NULLIUS_MIN_COST, TERRA_NULLIUS_MAX_COST) /
          tickBudget * timeScale,
      }, input);
    }

    if (attacker.type !== PlayerType.Bot && defender.type === PlayerType.Bot) {
      mag *= BOT_DEFENDER_LOSS_MULT;
    }
    const largeAttackerBonus = largeTerritoryBonus(attackerTiles, LARGE_ATTACKER_DEPTH);
    const largeDefenderBonus = largeTerritoryBonus(defenderTiles, LARGE_DEFENDER_DEPTH);
    const traitorLossMod = defender.isTraitor ? this.traitorDefenseDebuff() : 1;
    const traitorCostMod = defender.isTraitor ? this.traitorSpeedDebuff() : 1;

    const defenderTroopLoss = defender.troops / Math.max(1, defender.numTiles);
    const troopRatio = defender.troops / Math.max(1, attackTroops);
    const attackerTroopLoss =
      area *
      mag *
      traitorLossMod *
      within(troopRatio, 0.6, 2) *
      (ATTACKER_LOSS_BASE * largeAttackerBonus * largeDefenderBonus + ATTACKER_LOSS_PER_DENSITY * (defender.troops / defenderTiles));

    const speedCost = (within(troopRatio, 0.82, 7.5) * within(troopRatio / 20, 1, 50)) / SPEED_COST_DIVISOR;
    const largeAttackerSpeedBonus = largeTerritoryBonus(attackerTiles, LARGE_ATTACKER_SPEED_DEPTH);
    return this.balanceLandAdvance({
      attackerTroopLoss,
      defenderTroopLoss,
      tickFraction: (speedCost * tileCost * largeAttackerSpeedBonus * largeDefenderBonus * traitorCostMod) / logicalBorder * timeScale,
    }, input);
  }

  private balanceLandAdvance(result: AttackLogicResult, input: AttackLogicInput): AttackLogicResult {
    if(input.elapsedTicks===undefined)return result;
    // An opening army advances at 30% of its mature rate, ramping over 90 seconds.
    const opening=.3+.7*Math.min(1,Math.max(0,input.elapsedTicks)/(90*TICKS_PER_SECOND));
    const terrain=terrainAttackBase(input.terrain).mag/80;
    // Per-army throughput and occupation cost use reference surface area.
    // Troops are recalculated after each capture: depleted armies slow naturally.
    const maxAreaPerSecond=Math.max(1,input.attackTroops)/2500*opening;
    return {
      ...result,
      attackerTroopLoss:Math.max(result.attackerTroopLoss,60*terrain*this.tileScale),
      tickFraction:Math.max(result.tickFraction,TICKS_PER_SECOND*this.tileScale/maxAreaPerSecond),
    };
  }

  relationChangeOnAttack(): number {
    switch (this.difficulty) {
      case Difficulty.Easy:
        return -60;
      case Difficulty.Medium:
        return -70;
      case Difficulty.Hard:
        return -80;
      case Difficulty.Impossible:
        return -100;
    }
  }

  // ---------- units ----------
  unitCost(type: UnitType, owned: number): number {
    if (this.settings.infiniteGold) return 0;
    const n = owned;
    switch (type) {
      case UnitType.City:
      case UnitType.Factory:
      case UnitType.Port:
        return Math.min(1_000_000, 125_000 * 2 ** n);
      case UnitType.DefensePost:
        return Math.min(250_000, (n + 1) * 50_000);
      case UnitType.MissileSilo:
        return 1_000_000;
      case UnitType.SAMLauncher:
        return Math.min(3_000_000, (n + 1) * 1_500_000);
      case UnitType.Radar:
        return Math.min(1_200_000, (n + 1) * 200_000);
      case UnitType.Warship:
        return Math.min(1_000_000, (n + 1) * 250_000);
      case UnitType.AtomBomb:
        return 750_000;
      case UnitType.HydrogenBomb:
        return 5_000_000;
      case UnitType.MIRV:
        return 25_000_000 + n * 15_000_000;
      default:
        return 0;
    }
  }
  isUnitDisabled(type: UnitType): boolean {
    if (this.settings.disableNukes && NUKES.has(type)) return true;
    return this.settings.disabledUnits?.includes(type) ?? false;
  }
  upgradeCost(type: UnitType, level: number): number {
    if (this.settings.infiniteGold) return 0;
    switch (type) {
      case UnitType.City:
        return Math.min(1_000_000, (level + 1) * 125_000);
      case UnitType.Factory:
        return Math.min(1_000_000, (level + 1) * 125_000);
      case UnitType.Port:
        return Math.min(1_000_000, (level + 1) * 125_000);
      case UnitType.MissileSilo:
        return 1_000_000;
      case UnitType.SAMLauncher:
        return 1_500_000;
      case UnitType.Radar:
        return Math.min(800_000, (level + 1) * 200_000);
      default:
        return 0;
    }
  }
  maxLevel(type: UnitType): number {
    switch (type) {
      case UnitType.City:
        return 10;
      case UnitType.Factory:
        return 5;
      case UnitType.Port:
        return 5;
      case UnitType.MissileSilo:
        return 3;
      case UnitType.SAMLauncher:
        return 5;
      case UnitType.Radar:
        return 3;
      default:
        return 1;
    }
  }
  structureMinDist(): number {
    return 1;
  }
  /** how many structures may occupy one tile */
  maxStack(): number {
    return 6;
  }

  // ---------- railways / trains ----------
  /** skip a brand-new rail when two stations are this close (stacking still snaps) */
  trainStationMinRange(): number {
    return 0;
  }
  /** OpenFront `trainStationMaxRange` 110 */
  trainStationMaxRange(): number {
    return this.range(110);
  }
  /** longest rail (in tiles) the pathfinder may lay between two stations */
  railroadMaxSize(): number {
    return Math.round(this.trainStationMaxRange() * 1.4142);
  }
  /** OpenFront snaps a new station onto a track within 3 tiles */
  trainSnapRange(): number {
    return this.range(3);
  }
  trainSpeed(): number {
    return this.tiles(1);
  }
  trainCars(): number {
    return 5;
  }
  /**
   * Global throttle for the train economy (OpenFront's curve, in trains rather
   * than train units): a small boost for the first few trains, then a
   * sigmoid damping past ~70 trains that flattens onto a 0.25 plateau.
   */
  trainSaturation(numTrains: number): number {
    const units = numTrains * 7;
    const sigmoid = (x: number, k: number, mid: number) => 1 / (1 + Math.exp(-k * (x - mid)));
    const boost = 1 + 0.5 * Math.exp(-units / 30);
    const damping = 1 - sigmoid(units, Math.LN2 / 100, 500);
    const plateau = 0.25 * (1 - sigmoid(units, Math.LN2 / 150, 900));
    return boost * Math.max(damping, plateau);
  }
  /** ticks between spawn rolls; lower = more trains on the map */
  trainSpawnRate(numPlayerFactories: number, numTrains: number): number {
    const rate = (numPlayerFactories + 2) * 4;
    return Math.max(3, Math.floor(rate / this.trainSaturation(numTrains)));
  }
  /**
   * Gold paid when a train stops at a City/Port. Both the train owner and a
   * foreign station owner receive the full amount.
   *
   * OpenFront pays per stop, not per route: ride length and station level do
   * not change the payout (longer trips already pay more by hitting more
   * cities; factory level already spawns more trains). Relationship is the
   * lever — own 10k, other 25k, ally 35k — with a 5k floor after the 10th stop.
   */
  trainGold(rel: "self" | "ally" | "other", stopsVisited: number): number {
    const penalised = Math.max(0, stopsVisited - 9);
    const base = rel === "ally" ? 35_000 : rel === "other" ? 25_000 : 10_000;
    const gold = Math.max(5_000, base - penalised * 5_000);
    return Math.floor(gold * this.settings.goldMultiplier);
  }

  // ---------- nukes / SAM ----------
  nukeMagnitude(type: UnitType): { inner: number; outer: number } {
    if (type === UnitType.HydrogenBomb) return { inner: this.range(80), outer: this.range(100) };
    if (type === UnitType.MIRVWarhead) return { inner: this.range(12), outer: this.range(18) };
    if (type === UnitType.MIRV) return { inner: this.range(22), outer: this.range(28) };
    return { inner: this.range(12), outer: this.range(30) };
  }
  nukeSpeed(type: UnitType = UnitType.AtomBomb): number {
    if (type === UnitType.MIRV) return this.tiles(15);
    if (type === UnitType.MIRVWarhead) return this.tiles(22);
    return this.tiles(10);
  }
  /**
   * ICBM hang time, twice as fast as the old curve.
   * ~15 s next door, ~1.5 min to the far side of the world.
   */
  nukeFlightTicks(type: UnitType, dist: number): number {
    const width = 2048 * this.k;
    const omega = Math.min(Math.PI, (dist / Math.max(1, width)) * Math.PI * 2);
    const k = omega / Math.PI;
    let seconds: number;
    if (type === UnitType.MIRVWarhead) seconds = 7 + 9 * k;
    else if (type === UnitType.MIRV) seconds = 25 + 77 * k;
    else seconds = 16 + 74 * k;
    return Math.max(6, Math.round(seconds * TICKS_PER_SECOND));
  }
  /** modest loft so the path hugs the globe instead of drawing a huge circle */
  nukeArcHeight(type: UnitType, dist: number): number {
    const width = 2048 * this.k;
    const omega = Math.min(Math.PI, (dist / Math.max(1, width)) * Math.PI * 2);
    const k = omega / Math.PI;
    if (type === UnitType.MIRVWarhead) return 1.6 + 2.4 * k;
    if (type === UnitType.HydrogenBomb) return 3.2 + 6.5 * k;
    if (type === UnitType.MIRV) return 3.4 + 7 * k;
    return 2.8 + 5.5 * k;
  }
  mirvWarheads(): number {
    return 18;
  }
  radarRange(level = 1): number {
    return this.range(70 * (1 + 0.25 * (level - 1)));
  }
  radarSamBonus(): number {
    return 1.5;
  }
  siloCooldown(): number {
    return this.settings.devMode ? 0 : 90;
  }
  /** ticks a structure takes to build (0 = instant) */
  constructionTicks(type: UnitType): number {
    if (this.settings.devMode || this.settings.instantBuild) return 0;
    switch (type) {
      case UnitType.City:
        return 20;
      case UnitType.Factory:
        return 20;
      case UnitType.Port:
        return 50;
      case UnitType.DefensePost:
        return 50;
      case UnitType.MissileSilo:
        return 100;
      case UnitType.SAMLauncher:
        return 300;
      case UnitType.Radar:
        return 40;
      default:
        return 0;
    }
  }
  samCooldown(): number {
    return 90;
  }
  samRange(level: number): number {
    return Math.max(1, Math.round(this.tiles(Math.max(8, 45 - 150 / (level + 5)))));
  }
  samHitChance(type: UnitType): number {
    if (type === UnitType.HydrogenBomb) return 0.8;
    if (type === UnitType.MIRV) return 0.75;
    if (type === UnitType.MIRVWarhead) return 0.35;
    return 1;
  }
  nukeDeathFactor(troops: number, tiles: number): number {
    return (5 * troops) / Math.max(1, tiles);
  }
  /** Max surface-distance a level-1 silo can fire (220 reference tiles, map-scaled). */
  nukeTargetableRange(): number {
    return this.tiles(220);
  }

  // ---------- diplomacy ----------
  allianceDuration(): number {
    return 300 * TICKS_PER_SECOND;
  }
  allianceRequestTimeout(): number {
    return 20 * TICKS_PER_SECOND;
  }
  allianceRequestCooldown(): number {
    return 30 * TICKS_PER_SECOND;
  }
  embargoDuration(): number {
    return 300 * TICKS_PER_SECOND;
  }
  structureDeleteTicks(): number {
    return 30 * TICKS_PER_SECOND;
  }
  retreatDelayTicks(): number {
    return 20;
  }

  // ---------- trade / warships ----------
  warshipPatrolRange(): number {
    return this.range(60);
  }
  warshipTargetRange(): number {
    return this.range(90);
  }
  warshipSpeed(): number {
    return this.tiles(0.38);
  }
  warshipHealth(): number {
    return 1000;
  }
  warshipHealthFor(veterancy: number): number {
    return 1000 + Math.floor((1000 * Math.max(0, veterancy) * 20) / 100);
  }
  warshipDamage(): number {
    return 250;
  }
  warshipFireCooldown(): number {
    return 20;
  }
  shellSpeed(): number {
    return this.tiles(3);
  }
  shellLifetime(): number {
    return 50;
  }
  shellDamage(veterancy: number, roll: number): number {
    let mul = (Math.max(1, Math.min(6, roll)) - 1) * 25 + 200;
    if (veterancy > 0) mul = Math.floor((mul * (100 + veterancy * 20)) / 100);
    return Math.floor((250 * mul) / 100);
  }
  samMissileSpeed(): number {
    return this.tiles(12);
  }
  tradeShipSpeed(): number {
    return this.tiles(0.48);
  }
  tradeShipSpawnRate(): number {
    return 12 * TICKS_PER_SECOND;
  }
  tradeShipGold(distance: number, portLevel: number): number {
    return Math.floor((20_000 + (distance / this.k) * 400) * (0.75 + 0.25 * portLevel) * this.settings.goldMultiplier);
  }
}

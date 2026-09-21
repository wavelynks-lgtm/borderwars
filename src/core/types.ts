import type {Cosmetics} from "../customization/cosmetics";
import type {WorldRecipe} from "../map/generator";
export type TileRef = number;
export type PlayerID = number; // smallID, 0 = terra nullius

export enum TerrainType {
  Water = 0,
  Plains = 1,
  Highland = 2,
  Mountain = 3,
  Impassable = 4,
}

export enum PlayerType {
  Human = "human",
  Nation = "nation",
  Bot = "bot",
}

export enum Difficulty {
  Easy = "easy",
  Medium = "medium",
  Hard = "hard",
  Impossible = "impossible",
}

export enum UnitType {
  City = "city",
  Factory = "factory",
  DefensePost = "defense_post",
  Port = "port",
  MissileSilo = "missile_silo",
  SAMLauncher = "sam_launcher",
  Warship = "warship",
  TransportShip = "transport_ship",
  TradeShip = "trade_ship",
  Train = "train",
  Radar = "radar",
  AtomBomb = "atom_bomb",
  HydrogenBomb = "hydrogen_bomb",
  MIRV = "mirv",
  MIRVWarhead = "mirv_warhead",
  Shell = "shell",
  SAMMissile = "sam_missile",
}

/** GameMap.flags bits shared with the renderer's owner texture (blue channel) */
export const FLAG_FALLOUT = 1;
export const FLAG_FRONT_OUT = 2;
export const FLAG_FRONT_IN = 4;
export const FLAG_BORDER = 8;
export const FLAG_DEFENDED = 16;
export const FLAG_PREVIEW = 32;
export const FLAG_RAIL = 64;

export const STRUCTURES: ReadonlySet<UnitType> = new Set([
  UnitType.City,
  UnitType.Factory,
  UnitType.DefensePost,
  UnitType.Port,
  UnitType.MissileSilo,
  UnitType.SAMLauncher,
  UnitType.Radar,
]);

export const NUKES: ReadonlySet<UnitType> = new Set([
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
  UnitType.MIRV,
  UnitType.MIRVWarhead,
]);

export enum Relation {
  Hostile = 0,
  Distrustful = 1,
  Neutral = 2,
  Friendly = 3,
}

export enum MessageType {
  Info = "info",
  Success = "success",
  Warn = "warn",
  Error = "error",
  AttackIncoming = "attack_in",
  AttackOutgoing = "attack_out",
  Alliance = "alliance",
  Nuke = "nuke",
  Chat = "chat",
}

export interface GameEvent {
  tick: number;
  type: MessageType;
  text: string;
  /** player this event is addressed to (smallID); undefined = everyone */
  to?: PlayerID;
  from?: PlayerID;
  /** attached data for interactive events */
  attackId?: number;
  allianceRequestId?: number;
  emoji?: string;
}

export enum GraphicsQuality {
  Low = "low",
  Medium = "medium",
  High = "high",
}

export type WorldId = "earth" | "mars";

/** bump when SP defaults change so old localStorage does not keep custom balance */
export const SETTINGS_REV = 4;
/** human + nations + tribes on one globe */
export const MAX_PLAYERS = 100;

export function clampRoster(nations: number, bots: number): { numNations: number; numBots: number } {
  const ai = MAX_PLAYERS - 1;
  const numNations = Math.max(0, Math.min(ai, Math.floor(nations)));
  const numBots = Math.max(0, Math.min(ai - numNations, Math.floor(bots)));
  return { numNations, numBots };
}

export interface GameSettings {
  cosmetics?: Cosmetics;
  customWorld?: WorldRecipe;
  settingsRev: number;
  playerName: string;
  difficulty: Difficulty;
  numNations: number;
  numBots: number;
  winPercent: number; // 0..100
  seed: number;
  spawnPhaseSeconds: number;
  /** disable nukes entirely */
  disableNukes: boolean;
  /** cheat panel, free builds, instant construction */
  devMode: boolean;
  graphics: GraphicsQuality;
  /** gold the human starts with */
  startingGold: number;
  /** multiplier on all gold income */
  goldMultiplier: number;
  /** OpenFront infinite gold cheat */
  infiniteGold: boolean;
  /** OpenFront infinite troops cheat */
  infiniteTroops: boolean;
  /** match time limit in minutes, 0 = off */
  maxTimerMinutes: number;
  /** unit types the lobby turned off */
  disabledUnits: UnitType[];
  /** place the human immediately instead of clicking spawn */
  randomSpawn: boolean;
  /** nukes permanently turn destroyed land into ocean */
  waterNukes: boolean;
  /** which globe to load */
  world: WorldId;
  /** structures finish the tick they are placed */
  instantBuild: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  settingsRev: SETTINGS_REV,
  playerName: "Commander",
  difficulty: Difficulty.Easy,
  numNations: 10,
  numBots: 9,
  winPercent: 80,
  seed: 1,
  spawnPhaseSeconds: 10,
  disableNukes: false,
  devMode: false,
  graphics: GraphicsQuality.Medium,
  startingGold: 0,
  goldMultiplier: 1,
  infiniteGold: false,
  infiniteTroops: false,
  maxTimerMinutes: 0,
  disabledUnits: [],
  randomSpawn: false,
  waterNukes: false,
  world: "earth",
  instantBuild: false,
};

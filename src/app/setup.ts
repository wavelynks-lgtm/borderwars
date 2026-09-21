import {sanitizeCosmetics,flagGlyph} from "../customization/cosmetics";
import {countryColor} from "../map/generator";
import { Game } from "../core/Game";
import type { GameMap } from "../core/GameMap";
import { PseudoRandom } from "../core/PseudoRandom";
import { PlayerType, clampRoster, type GameSettings } from "../core/types";
import { SpawnTimerExecution } from "../core/executions/SpawnTimerExecution";
import { NationAI } from "../core/ai/NationAI";
import { BotAI } from "../core/ai/BotAI";

const BOT_NAMES = [
  "Tribe of the Ash", "Free Hills", "Red Clan", "River Folk", "Iron Band", "Stone Kin", "Sun Nomads", "Wolf Pack", "Salt Traders",
  "Grey Marches", "Coast Raiders", "Highland Clan", "Dune Riders", "Marsh Lords", "Frost Kin", "Amber League", "Cedar Folk", "Copper Union",
];

export function createGame(map: GameMap, settings: GameSettings): Game {
  const game = new Game(map, settings);
  const rnd = new PseudoRandom(settings.seed ^ 0x5bd1e995);

  // human
  const cosmetics=sanitizeCosmetics(settings.cosmetics,true);
  const human = game.addPlayer(settings.playerName || "Commander", PlayerType.Human, cosmetics.color,0,flagGlyph(cosmetics.flag));
  human.cosmetics=cosmetics;
  game.human = human;

  // nations = one AI per country/state, biggest first unless you crank the slider
  const SKIP = new Set(["Antarctica", "Planum Boreum", "Planum Australe", "North Ice", "South Ice"]);
  const candidates = map.countries.filter(
    (c) => c.id !== 0 && c.centroid >= 0 && c.tiles >= 40 && !SKIP.has(c.name),
  );
  candidates.sort((a, b) => b.tiles - a.tiles);
  const { numNations, numBots } = clampRoster(settings.numNations, settings.numBots);
  const want = Math.min(numNations, candidates.length);
  let chosen = candidates;
  if (want < candidates.length) {
    const pool = candidates.slice(0, Math.min(candidates.length, Math.max(want * 3, 40)));
    rnd.shuffle(pool);
    chosen = pool.slice(0, want);
    for (const big of candidates.slice(0, 8)) {
      if (!chosen.includes(big) && chosen.length < want) chosen.push(big);
    }
  }
  const hueStep = 360 / Math.max(1, chosen.length);
  chosen.forEach((c, i) => {
    const hue = (i * hueStep * 7) % 360; // spread hues
    const col = map.generated ? `rgb(${countryColor(c.id).join(",")})` : hsl(hue, 62 + (i % 3) * 8, 48 + (i % 2) * 8);
    const p = game.addPlayer(c.name, PlayerType.Nation, col, c.id);
    game.addExecution(new NationAI(p, c.centroid));
  });

  // bots
  for (let i = 0; i < numBots; i++) {
    const name = BOT_NAMES[i % BOT_NAMES.length] + (i >= BOT_NAMES.length ? ` ${Math.floor(i / BOT_NAMES.length) + 1}` : "");
    const g = 95 + rnd.nextInt(0, 60);
    const col = `rgb(${g + rnd.nextInt(-10, 10)},${g},${g + rnd.nextInt(-10, 10)})`;
    const p = game.addPlayer(name, PlayerType.Bot, col);
    game.addExecution(new BotAI(p));
  }
  game.addExecution(new SpawnTimerExecution());
  return game;
}

function hsl(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (v: number) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

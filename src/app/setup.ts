import {sanitizeCosmetics,flagGlyph} from "../customization/cosmetics";
import { Game } from "../core/Game";
import type { GameMap } from "../core/GameMap";
import { PseudoRandom } from "../core/PseudoRandom";
import { PlayerType, clampRoster, type GameSettings } from "../core/types";
import { SpawnTimerExecution } from "../core/executions/SpawnTimerExecution";
import { NationAI } from "../core/ai/NationAI";
import { aiColor, pickAiNames } from "../core/ai/aiNames";

export function createGame(map: GameMap, settings: GameSettings): Game {
  const game = new Game(map, settings);
  const rnd = new PseudoRandom(settings.seed ^ 0x5bd1e995);

  const cosmetics=sanitizeCosmetics(settings.cosmetics,true);
  const human = game.addPlayer(settings.playerName || "Commander", PlayerType.Human, cosmetics.color,0,flagGlyph(cosmetics.flag));
  human.cosmetics=cosmetics;
  game.human = human;

  const { numBots } = clampRoster(settings.numNations, settings.numBots);
  const names = pickAiNames(numBots, rnd, new Set([human.name]));
  for (let i = 0; i < numBots; i++) {
    const p = game.addPlayer(names[i] ?? `AI ${i + 1}`, PlayerType.Nation, aiColor(i));
    game.addExecution(new NationAI(p));
  }
  game.addExecution(new SpawnTimerExecution());
  return game;
}

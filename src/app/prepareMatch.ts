import type { Game } from '../core/Game';

/** Warm AI brains without placing them — they pick land during the spawn countdown. */
export async function prepareMatch(game:Game, report:(message:string,fraction:number)=>void, yieldWork:()=>Promise<void>):Promise<void> {
  report('Readying commanders…', 0.4);
  await game.prepareExecutions(yieldWork);
  report('Waiting for the spawn countdown…', 1);
}

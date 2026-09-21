import type { Game } from '../core/Game';
import { PlayerType } from '../core/types';

/** Prepare every AI and starting territory without advancing simulation time. */
export async function prepareMatch(game:Game, report:(message:string,fraction:number)=>void, yieldWork:()=>Promise<void>):Promise<void> {
  const players=game.allPlayers().filter(p=>p.type!==PlayerType.Human);
  for(let i=0;i<players.length;i++){
    const player=players[i];
    if(!player.hasSpawned){const tile=game.randomSpawnTile(player);if(tile<0)throw new Error(`No starting position available for ${player.name}`);game.spawnPlayer(player,tile);}
    report(`Placing commanders… ${i+1}/${players.length}`,(i+1)/Math.max(1,players.length));
    if(i%4===3)await yieldWork();
  }
  await game.prepareExecutions(yieldWork);
}

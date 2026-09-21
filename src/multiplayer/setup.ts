import {sanitizeCosmetics,flagGlyph} from "../customization/cosmetics";
import {createGame} from '../app/setup';
import {prepareMatch} from '../app/prepareMatch';
import {PlayerType,type GameSettings} from '../core/types';
import type {GameMap} from '../core/GameMap';
import type {Member} from './protocol';
export async function createOnlineGame(map:GameMap,settings:GameSettings,members:Member[],localId:string){
 const game=createGame(map,{...settings,playerName:members[0].name,cosmetics:members[0].cosmetics});
 const first=members[0];

 first.playerId=game.human!.smallID;
 for(const member of members.slice(1)){const p=game.addPlayer(member.name,PlayerType.Human,member.color,0,flagGlyph(member.cosmetics?.flag??""));p.cosmetics=sanitizeCosmetics(member.cosmetics,true);member.playerId=p.smallID;}
 game.online=true;
 // Spawn order and preparation are identical on server and each browser.
 for(const member of members){const p=game.player(member.playerId)!;const t=game.randomSpawnTile(p);if(t<0)throw new Error('No spawn available');game.spawnPlayer(p,t);}
 await prepareMatch(game,()=>{},async()=>{});
 game.human=game.player(members.find(m=>m.id===localId)?.playerId??first.playerId);
 return game;
}

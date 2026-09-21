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
 // Humans click a start location during the countdown, same as single player.
 // AI claim land over those ticks; anyone still unplaced is assigned at the end.
 await prepareMatch(game,()=>{},async()=>{});
 game.human=game.player(members.find(m=>m.id===localId)?.playerId??first.playerId);
 return game;
}

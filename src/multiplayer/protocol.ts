import type {Cosmetics} from "../customization/cosmetics";
import type {Game} from '../core/Game';
import {attackTile,build,sendBoat,moveWarship,retreatAttack,retreatBoat,upgradeUnit,queueMissiles} from '../core/actions';
import {PlayerType,UnitType,STRUCTURES,NUKES,type GameSettings} from '../core/types';
import type {MissileSalvoExecution} from '../core/executions/MissileSalvoExecution';
export const PROTOCOL=1;
export type Command={kind:string;tile?:number;target?:number;unit?:number;id?:number;value?:number;on?:boolean;type?:UnitType;tiles?:number[];emoji?:string};
export interface Member {id:string;name:string;color:string;playerId:number;ready:boolean;connected:boolean;cosmetics?:Cosmetics}
export interface MatchInfo {id:string;settings:GameSettings;members:Member[];mapHash:string;mapURL:string}
export interface Frame {tick:number;commands:{player:number;command:Command}[];digest?:string}
const buildable=new Set([...STRUCTURES,UnitType.Warship,UnitType.AtomBomb,UnitType.HydrogenBomb,UnitType.MIRV]);
const salvos=new WeakMap<Game,Map<number,MissileSalvoExecution>>();
export function activeSalvo(g:Game,p:number):MissileSalvoExecution|undefined{return salvos.get(g)?.get(p);}
export function validCommand(c:unknown):c is Command {
 if(!c||typeof c!=='object'||Array.isArray(c))return false;
 const x=c as Command;
 const int=(n:unknown)=>Number.isSafeInteger(n)&&Number(n)>=0&&Number(n)<100_000_000;
 const ratio=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1;
 switch(x.kind){
 case 'spawn':case 'attack':case 'boat':return int(x.tile)&&(x.value===undefined||ratio(x.value));
 case 'build':return int(x.tile)&&buildable.has(x.type!);
 case 'salvo':return NUKES.has(x.type!)&&x.type!==UnitType.MIRVWarhead&&Array.isArray(x.tiles)&&x.tiles.length>0&&x.tiles.length<=20&&x.tiles.every(int);
 case 'cancelSalvo':case 'surrender':return true;
 case 'attackRatio':case 'troopRatio':return ratio(x.value);
 case 'retreat':case 'retreatBoat':case 'upgrade':case 'delete':return int(x.id);
 case 'patrol':return int(x.unit)&&int(x.tile);
 case 'accept':case 'reject':return int(x.id);
 case 'alliance':case 'break':case 'extend':case 'donateTroops':case 'donateGold':return int(x.target);
 case 'embargo':return int(x.target)&&typeof x.on==='boolean';
 case 'embargoAll':return typeof x.on==='boolean';
 case 'emoji':return (x.target===undefined||int(x.target))&&typeof x.emoji==='string'&&['😀','😂','😡','🤝','👋','👍','💀','❤️','😎','🔥','⚔️','🕊️','🙏','🏳️','👑','🍕','🌍'].includes(x.emoji);
 default:return false;
 }
}
/** The server supplies the player identity; clients never send balances or scores. */
export function applyCommand(g:Game,playerId:number,c:Command):string|null {
 if(!validCommand(c))return 'Invalid command';
 const p=g.player(playerId);if(!p||p.type!==PlayerType.Human)return 'Invalid player';
 if(g.winner)return 'Match finished';
 if(c.kind==='spawn'){
  if(!g.inSpawnPhase()||p.hasSpawned||!g.map.isValid(c.tile!)||!g.canSpawnAt(c.tile!,p))return 'Spawn unavailable';
  g.spawnPlayer(p,c.tile!);return null;
 }
 if(!p.hasSpawned||!p.alive)return 'You have no territory';
 if(c.kind==='attackRatio'){p.attackRatio=Math.max(.01,c.value!);return null;}
 if(c.kind==='troopRatio'){p.targetTroopRatio=c.value!;return null;}
 if(g.inSpawnPhase())return 'Wait for the countdown';
 if(c.tile!==undefined&&!g.map.isValid(c.tile))return 'Invalid tile';
 const other=c.target?g.player(c.target):null;
 const u=[...g.units].find(u=>u.id===(c.unit??c.id)&&u.active&&u.owner===p);
 const result=(r:{ok:boolean;message?:string})=>r.ok?null:r.message??'Action unavailable';
 switch(c.kind){
 case 'attack':return result(attackTile(g,p,c.tile!,p.troops*(c.value??p.attackRatio)));
 case 'boat':return result(sendBoat(g,p,c.tile!,p.troops*(c.value??p.attackRatio)));
 case 'build':return result(build(g,p,c.type!,c.tile!));
 case 'salvo':{
  if(activeSalvo(g,playerId)?.isActive())return 'Finish or cancel your current salvo';
  const r=queueMissiles(g,p,c.type!,c.tiles!);if(!r.ok)return r.message;
  if(!salvos.has(g))salvos.set(g,new Map());salvos.get(g)!.set(playerId,r.salvo);return null;
 }
 case 'cancelSalvo':activeSalvo(g,playerId)?.cancel();return null;
 case 'retreat':retreatAttack(g,p,c.id!);return null;
 case 'retreatBoat':retreatBoat(p,c.id!);return null;
 case 'patrol':return u?result(moveWarship(g,p,u,c.tile!)):'Not your unit';
 case 'upgrade':return u?result(upgradeUnit(g,p,u)):'Not your unit';
 case 'delete':return u&&(u.deleteAt>=0?g.cancelDelete(p,u):g.markDelete(p,u))?null:'Cannot remove unit';
 case 'accept':case 'reject':{
  const req=p.incomingAllianceRequests.find(r=>r.id===c.id&&r.status==='pending');if(!req)return 'Request expired';
  if(c.kind==='accept')g.acceptAlliance(req);else g.rejectAlliance(req);return null;
 }
 case 'alliance':return other&&g.requestAlliance(p,other)?null:'Alliance unavailable';
 case 'break':if(other)g.breakAlliance(p,other);return null;
 case 'extend':if(other)g.extendAlliance(p,other);return null;
 case 'donateTroops':return other&&g.donateTroops(p,other,p.troops/3)?null:'Donation unavailable';
 case 'donateGold':return other&&g.donateGold(p,other,p.gold/3)?null:'Donation unavailable';
 case 'embargo':if(other)g.setEmbargo(p,other,c.on!);return null;
 case 'embargoAll':g.embargoAll(p,c.on!);return null;
 case 'emoji':g.sendEmoji(p,other,c.emoji!);return null;
 case 'surrender':for(const t of [...p.tiles])g.relinquish(t);return null;
 default:return 'Unknown command';
 }
}
/** Periodic divergence check, including every owned tile, unit and army. No client score is trusted. */
export function stateDigest(g:Game):string {
 let h=2166136261;const mix=(n:number)=>{h=Math.imul(h^(Math.round(n*1000)|0),16777619);};mix(g.ticks);
 for(const p of g.allPlayers()){
  mix(p.smallID);mix(p.troops);mix(p.workers);mix(p.gold);mix(p.attackRatio);mix(p.targetTroopRatio);
  for(const t of p.tiles)mix(t);
  for(const a of p.outgoingAttacks){mix(a.id);mix(a.troops());}
 }
 for(const u of g.units){mix(u.id);mix(u.owner.smallID);mix(u.tile);mix(u.level);mix(u.health);mix(u.cooldownUntil);}
 return (h>>>0).toString(16);
}

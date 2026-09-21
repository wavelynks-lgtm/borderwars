import {DEFAULT_SETTINGS,Difficulty,MAX_HUMANS,MAX_PLAYERS,clampAi,clampRoster,type GameSettings} from '../core/types';
import {validateRecipe,type WorldRecipe} from '../map/generator';
export type RoomKind='random'|'custom';
export const RANDOM_MIN_PLAYERS=50;
export const RANDOM_MAX_PLAYERS=100;
export const RANDOM_PRESETS=[
 {name:'Border Skirmish',goldMultiplier:1,disableNukes:false,difficulty:Difficulty.Easy},
 {name:'Fortress World',goldMultiplier:1,disableNukes:true,difficulty:Difficulty.Medium},
 {name:'Golden Frontiers',goldMultiplier:1.5,disableNukes:false,difficulty:Difficulty.Medium},
 {name:'Crowded Earth',goldMultiplier:1,disableNukes:true,difficulty:Difficulty.Easy},
];
/** Fill leftover seats with AI so the globe always has 50–100 players. */
export function fillRandomRoster(settings:GameSettings,humans:number):GameSettings{
 const nHumans=Math.max(1,Math.min(MAX_HUMANS,Math.floor(humans)));
 const span=RANDOM_MAX_PLAYERS-RANDOM_MIN_PLAYERS+1;
 const target=Math.min(MAX_PLAYERS,RANDOM_MIN_PLAYERS+((settings.seed>>>0)%span));
 const total=Math.max(target,nHumans);
 const ai=Math.min(MAX_PLAYERS-nHumans,Math.max(0,total-nHumans));
 return {...settings,...clampAi(ai,nHumans),genericAi:true};
}
export function randomMatch(seed:number){const preset=RANDOM_PRESETS[(seed>>>0)%RANDOM_PRESETS.length];return {name:preset.name,settings:{...DEFAULT_SETTINGS,...preset,seed,randomSpawn:true,spawnPhaseSeconds:15,maxTimerMinutes:30,genericAi:true}};}
export function customMatch(input:unknown):{name:string;settings:GameSettings;recipe?:WorldRecipe}{
 const v=(input&&typeof input==='object'?input:{}) as Record<string,unknown>;
 const settings={...DEFAULT_SETTINGS,seed:1,randomSpawn:true,spawnPhaseSeconds:15,maxTimerMinutes:30};
 const bounded=(key:string,n:unknown,min:number,max:number)=>{if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max)throw new Error(`Invalid ${key}`);return Math.floor(n);};
 if(v.numPlayers!==undefined)Object.assign(settings,clampAi(bounded('numPlayers',v.numPlayers,2,MAX_PLAYERS)-1));
 else if(v.numNations!==undefined||v.numBots!==undefined){
  const nations=v.numNations===undefined?0:bounded('numNations',v.numNations,0,MAX_PLAYERS-1);
  const bots=v.numBots===undefined?0:bounded('numBots',v.numBots,0,MAX_PLAYERS-1);
  Object.assign(settings,clampRoster(nations,bots));
 }
 for(const [key,min,max] of [['maxTimerMinutes',10,60],['winPercent',50,95],['goldMultiplier',1,3]] as const){
  if(v[key]!==undefined){const n=v[key];if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max)throw new Error(`Invalid ${key}`);settings[key]=key==='goldMultiplier'?n:Math.floor(n);}
 }
 if(v.disableNukes!==undefined){if(typeof v.disableNukes!=='boolean')throw new Error('Invalid nuke setting');settings.disableNukes=v.disableNukes;}
 if(v.difficulty!==undefined){if(!Object.values(Difficulty).includes(v.difficulty as Difficulty))throw new Error('Invalid difficulty');settings.difficulty=v.difficulty as Difficulty;}
 const recipe=v.customWorld===undefined?undefined:validateRecipe(v.customWorld);
 if(recipe&&recipe.resolution>2048)throw new Error('Online worlds support up to 2048 pixels. Save a 2048-pixel version in World Forge.');
 if(recipe)settings.customWorld=recipe;
 const name=typeof v.name==='string'?v.name.trim().slice(0,40):recipe?.name??'Custom Earth';
 return {name:name||'Custom Earth',settings,recipe};
}

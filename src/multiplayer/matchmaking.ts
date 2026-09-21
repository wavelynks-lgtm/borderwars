import {DEFAULT_SETTINGS,Difficulty,type GameSettings} from '../core/types';
import {validateRecipe,type WorldRecipe} from '../map/generator';
export type RoomKind='random'|'custom';
export const RANDOM_PRESETS=[
 {name:'Border Skirmish',numNations:6,numBots:4,goldMultiplier:1,disableNukes:false,difficulty:Difficulty.Easy},
 {name:'Fortress World',numNations:10,numBots:2,goldMultiplier:1,disableNukes:true,difficulty:Difficulty.Medium},
 {name:'Golden Frontiers',numNations:4,numBots:8,goldMultiplier:1.5,disableNukes:false,difficulty:Difficulty.Medium},
 {name:'Crowded Earth',numNations:12,numBots:8,goldMultiplier:1,disableNukes:true,difficulty:Difficulty.Easy},
];
export function randomMatch(seed:number){const preset=RANDOM_PRESETS[(seed>>>0)%RANDOM_PRESETS.length];return {name:preset.name,settings:{...DEFAULT_SETTINGS,...preset,seed,randomSpawn:true,spawnPhaseSeconds:15,maxTimerMinutes:30}};}
export function customMatch(input:unknown):{name:string;settings:GameSettings;recipe?:WorldRecipe}{
 const v=(input&&typeof input==='object'?input:{}) as Record<string,unknown>;
 const settings={...DEFAULT_SETTINGS,seed:1,randomSpawn:true,spawnPhaseSeconds:15,maxTimerMinutes:30};
 for(const [key,min,max] of [['numNations',0,20],['numBots',0,20],['maxTimerMinutes',10,60],['winPercent',50,95],['goldMultiplier',1,3]] as const){
  if(v[key]!==undefined){const n=v[key];if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max)throw new Error(`Invalid ${key}`);settings[key]=key==='goldMultiplier'?n:Math.floor(n);}
 }
 if(v.disableNukes!==undefined){if(typeof v.disableNukes!=='boolean')throw new Error('Invalid nuke setting');settings.disableNukes=v.disableNukes;}
 if(v.difficulty!==undefined){if(!Object.values(Difficulty).includes(v.difficulty as Difficulty))throw new Error('Invalid difficulty');settings.difficulty=v.difficulty as Difficulty;}
 const recipe=v.customWorld===undefined?undefined:validateRecipe(v.customWorld);
 if(recipe&&recipe.resolution>2048)throw new Error('Online worlds support up to 2048 pixels. Save a 2048-pixel version in World Forge.');
 if(recipe){settings.customWorld=recipe;settings.numNations=Math.min(settings.numNations,recipe.countries);}
 const name=typeof v.name==='string'?v.name.trim().slice(0,40):recipe?.name??'Custom Earth';
 return {name:name||'Custom Earth',settings,recipe};
}

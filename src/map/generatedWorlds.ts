import {GameMap} from '../core/GameMap';
import {validateRecipe,type WorldRecipe} from './generator';
export function generateAsync(recipe:WorldRecipe,progress:(m:string,n:number)=>void=()=>{},signal?:AbortSignal):Promise<GameMap>{
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./generator.worker.ts',import.meta.url),{type:'module'});
  const cleanup=()=>{worker.terminate();signal?.removeEventListener('abort',abort);};
  const abort=()=>{cleanup();reject(new DOMException('Generation cancelled','AbortError'));};if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort);
  worker.onerror=e=>{cleanup();reject(new Error(e.message));};
  worker.onmessage=e=>{if(e.data.progress){progress(e.data.progress.message,e.data.progress.percent);return;}cleanup();if(e.data.error){reject(new Error(e.data.error));return;}const m=e.data.map;const map=new GameMap(m.width,m.height,m.terrain,m.country,m.countries);map.elevation=m.elevation;map.generated=m.generated;resolve(map);};worker.postMessage(validateRecipe(recipe));
 });
}
const KEY='borderwars.worlds.v1';
export interface SavedWorld {id:string;recipe:WorldRecipe;savedAt:number}
export function savedWorlds():SavedWorld[]{try{const raw=JSON.parse(localStorage.getItem(KEY)??'[]');return Array.isArray(raw)?raw.slice(0,40).flatMap(v=>{try{return [{id:String(v.id),recipe:validateRecipe(v.recipe),savedAt:Number(v.savedAt)}];}catch{return [];}}):[];}catch{return [];}}
export function saveWorld(recipe:WorldRecipe,id?:string):SavedWorld{const list=savedWorlds(),entry={id:id??crypto.randomUUID(),recipe:validateRecipe(recipe),savedAt:Date.now()};const filtered=list.filter(v=>v.id!==entry.id);if(filtered.length>=40)throw new Error('Your library is full (40 worlds). Export or remove a world first.');localStorage.setItem(KEY,JSON.stringify([entry,...filtered]));return entry;}
export function deleteWorld(id:string){localStorage.setItem(KEY,JSON.stringify(savedWorlds().filter(w=>w.id!==id)));}

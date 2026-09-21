import type {WorldRecipe} from '../map/generator';
import {GameMap,type CountryInfo} from '../core/GameMap';
export function decodeMap(buffer:ArrayBuffer):GameMap{
 const view=new DataView(buffer);const size=view.getUint32(0,true);
 const meta=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,4,size))) as {width:number;height:number;countries:CountryInfo[];generated?:WorldRecipe};
 if(meta.width<16||meta.width>5792||meta.height!==meta.width/2)throw new Error('Invalid map');
 const n=meta.width*meta.height,offset=4+size;
 if(buffer.byteLength!==offset+n*4)throw new Error('Invalid map length');
 const terrain=new Uint8Array(buffer.slice(offset,offset+n));
 const country=new Uint16Array(buffer.slice(offset+n,offset+n*3));
 const map=new GameMap(meta.width,meta.height,terrain,country,meta.countries);
 map.elevation=new Uint8Array(buffer.slice(offset+n*3));map.generated=meta.generated;return map;
}
export async function loadOnlineMap(url:string,hash:string){
 const response=await fetch(url);if(!response.ok)throw new Error('Online map unavailable');
 const packed=await response.arrayBuffer();
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',packed)),b=>b.toString(16).padStart(2,'0')).join('');
 if(digest!==hash)throw new Error('Map version mismatch. Reload the page.');
 const data=await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();return decodeMap(data);
}

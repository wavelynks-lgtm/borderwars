import {GameMap,type CountryInfo} from '../core/GameMap';
import {TerrainType} from '../core/types';
import {PseudoRandom,simpleHash} from '../core/PseudoRandom';
import {FlatBinaryHeap} from '../core/BinaryHeap';
export interface WorldRecipe {version:1;name:string;seed:string;layout:'continents'|'archipelago'|'supercontinent';climate:'temperate'|'desert'|'frozen'|'volcanic';water:number;scale:number;roughness:number;mountains:number;ice:number;countries:number;resolution:number;ground:string;ocean:string;highland:string;mountain:string;border:string;countryTint:number}
export const DEFAULT_RECIPE:WorldRecipe={version:1,name:'New World',seed:'Atlas-1',layout:'continents',climate:'temperate',water:65,scale:3,roughness:50,mountains:45,ice:10,countries:48,resolution:2048,ground:'#70a14d',ocean:'#173d70',highland:'#a38b58',mountain:'#d6d0c7',border:'#26362a',countryTint:30};
export function validateRecipe(input:unknown):WorldRecipe{
 if(!input||typeof input!=='object')throw new Error('Invalid world recipe');const r={...DEFAULT_RECIPE,...input} as WorldRecipe;
 if(r.version!==1)throw new Error('Unsupported world version');
 if(typeof r.name!=='string'||!r.name.trim()||r.name.length>40||typeof r.seed!=='string'||r.seed.length>64)throw new Error('Use a world name up to 40 characters and a seed up to 64 characters');
 if(!['continents','archipelago','supercontinent'].includes(r.layout)||!['temperate','desert','frozen','volcanic'].includes(r.climate))throw new Error('Invalid world type');
 for(const [key,min,max] of [['water',15,90],['scale',1,8],['roughness',0,100],['mountains',0,100],['ice',0,35],['countries',4,160],['countryTint',0,75]] as const){if(typeof r[key]!=='number'||!Number.isFinite(r[key])||r[key]<min||r[key]>max)throw new Error(`Invalid ${key}`);r[key]=Math.round(r[key]);}
 if(![512,1024,2048,4096].includes(r.resolution))throw new Error('Unsupported resolution');
 for(const key of ['ground','ocean','highland','mountain','border'] as const)if(typeof r[key]!=='string'||!/^#[0-9a-f]{6}$/i.test(r[key]))throw new Error('Invalid world color');
 return {version:1,name:r.name.trim(),seed:r.seed,layout:r.layout,climate:r.climate,water:r.water,scale:r.scale,roughness:r.roughness,mountains:r.mountains,ice:r.ice,countries:r.countries,resolution:r.resolution,ground:r.ground,ocean:r.ocean,highland:r.highland,mountain:r.mountain,border:r.border,countryTint:r.countryTint};
}
function hash(x:number,y:number,z:number,seed:number){let n=Math.imul(x,374761393)^Math.imul(y,668265263)^Math.imul(z,2147483647)^seed;n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295;}
const smooth=(t:number)=>t*t*(3-2*t),lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
export function noise3(x:number,y:number,z:number,seed:number):number{
 const i=Math.floor(x),j=Math.floor(y),k=Math.floor(z),u=smooth(x-i),v=smooth(y-j),w=smooth(z-k);
 return lerp(lerp(lerp(hash(i,j,k,seed),hash(i+1,j,k,seed),u),lerp(hash(i,j+1,k,seed),hash(i+1,j+1,k,seed),u),v),lerp(lerp(hash(i,j,k+1,seed),hash(i+1,j,k+1,seed),u),lerp(hash(i,j+1,k+1,seed),hash(i+1,j+1,k+1,seed),u),v),w);
}
function fbm(x:number,y:number,z:number,seed:number){let n=0,a=.57;for(let i=0;i<4;i++){n+=noise3(x,y,z,seed+i*7717)*a;x*=2.07;y*=2.07;z*=2.07;a*=.48;}return n;}
const hex=(s:string)=>[parseInt(s.slice(1,3),16),parseInt(s.slice(3,5),16),parseInt(s.slice(5,7),16)];
export function countryColor(id:number):number[]{const h=(id*.61803398875)%1;return [0,1,2].map(k=>Math.round(125+70*Math.cos((h+k/3)*Math.PI*2)));}
export function generatedColor(r:WorldRecipe,terrain:number,elevation:number,country:number,border=false):number[]{
 if(border)return hex(r.border);
 let c=hex(terrain===TerrainType.Water?r.ocean:terrain===TerrainType.Mountain?r.mountain:terrain===TerrainType.Highland?r.highland:terrain===TerrainType.Impassable?'#e4edf1':r.ground);
 const shade=terrain===TerrainType.Water?.7+.3*elevation/255:.8+.25*elevation/255;c=c.map(v=>v*shade);
 if(country&&terrain!==TerrainType.Water&&terrain!==TerrainType.Impassable){const tint=countryColor(country);c=c.map((v,i)=>lerp(v,tint[i],r.countryTint/100));}return c.map(v=>Math.max(0,Math.min(255,Math.round(v))));
}
/** Spherical noise, area-weighted sea level, and terrain-cost country growth. No seam in the noise domain. */
export function generateWorld(input:WorldRecipe,progress:(message:string,percent:number)=>void=()=>{}):GameMap{
 const r=validateRecipe(input),W=r.resolution,H=W/2,n=W*H,seed=simpleHash(r.seed),rng=new PseudoRandom(seed);
 const heights=new Float32Array(n),terrain=new Uint8Array(n),elevation=new Uint8Array(n),country=new Uint16Array(n),hist=new Float64Array(2048);
 const xs=new Float64Array(W),zs=new Float64Array(W);for(let x=0;x<W;x++){xs[x]=Math.cos((x+.5)/W*Math.PI*2);zs[x]=Math.sin((x+.5)/W*Math.PI*2);}
 let total=0;const frequency=r.layout==='archipelago'?r.scale*1.8:r.layout==='supercontinent'?1.3:r.scale;
 for(let y=0;y<H;y++){
  const lat=(y+.5)/H*Math.PI,ring=Math.sin(lat),sy=Math.cos(lat);total+=W*ring;
  for(let x=0;x<W;x++){
   const sx=xs[x]*ring,sz=zs[x]*ring;
   const warp=noise3(sx*2+7,sy*2-9,sz*2+5,seed+19)-.5;
   let v=fbm(sx*frequency+warp*.7+13,sy*frequency+warp*.5+31,sz*frequency+warp*.8-17,seed);
   v=lerp(v,fbm(sx*frequency*4,sy*frequency*4,sz*frequency*4,seed+999),r.roughness/100*.23);
   if(r.layout==='supercontinent')v=v*.52+(sx*.5+.5)*.48;
   heights[y*W+x]=v;hist[Math.min(2047,Math.max(0,Math.floor(v*2047)))]+=ring;
  }
  if(y%32===0)progress('Shaping continents and coastlines…',Math.round(y/H*35));
 }
 let cumulative=0,sea=.5;for(let i=0;i<hist.length;i++){cumulative+=hist[i];if(cumulative>=total*r.water/100){sea=i/2047;break;}}
 const land:number[]=[];
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const t=y*W+x,v=heights[t],lat=(y+.5)/H*Math.PI,ring=Math.sin(lat),sx=xs[x]*ring,sy=Math.cos(lat),sz=zs[x]*ring;
  if(v<=sea){terrain[t]=TerrainType.Water;elevation[t]=Math.round(Math.min(1,v/Math.max(.01,sea))*200);continue;}
  const ridge=1-Math.abs(noise3(sx*frequency*2+71,sy*frequency*2,sz*frequency*2,seed+333)*2-1);
  const alt=Math.min(1,(v-sea)/Math.max(.1,1-sea)*2.1+Math.pow(ridge,5)*r.mountains/100*.6);
  const frozen=Math.abs(sy)>Math.cos(r.ice/100*Math.PI/2);
  terrain[t]=frozen?TerrainType.Impassable:alt>.70?TerrainType.Mountain:alt>.36?TerrainType.Highland:TerrainType.Plains;
  if(r.climate==='frozen'&&alt>.48)terrain[t]=TerrainType.Mountain;
  elevation[t]=Math.round(alt*255);if(!frozen)land.push(t);
 }
 if(land.length<r.countries*8)throw new Error('Too little playable land. Reduce water or ice.');
 progress('Growing countries along terrain…',42);
 const map=new GameMap(W,H,terrain,country,[]),countries:CountryInfo[]=[{id:0,name:'Ocean',centroid:-1,tiles:0,lat:0,lon:0}],dist=new Float64Array(n).fill(Infinity),heap=new FlatBinaryHeap();
 const prefixes=['Aster','Bel','Cor','Dor','Eld','Fen','Gal','Hel','Iver','Jun','Kel','Lor','Mor','Nor','Or','Pel','Quel','Rav','Sol','Tor','Ul','Val','Wes','Yar','Zan'];
 const suffixes=['avia','land','ora','mere','istan','eria','oria','en','mark','ara'];
 const seeds:number[]=[];
 for(let id=1;id<=r.countries;id++){
  let best=land[rng.nextInt(0,land.length-1)],bestScore=-1;
  for(let attempt=0;attempt<24;attempt++){
   const t=land[rng.nextInt(0,land.length-1)];let nearest=Infinity;
   for(const s of seeds){const dy=(map.y(t)-map.y(s)),dx=Math.min(Math.abs(map.x(t)-map.x(s)),W-Math.abs(map.x(t)-map.x(s)))*map.rowArea[map.y(t)];nearest=Math.min(nearest,dx*dx+dy*dy);}
   const score=nearest*(.7+rng.next()*.6);if(score>bestScore){bestScore=score;best=t;}
  }
  seeds.push(best);country[best]=id;dist[best]=0;heap.enqueue(best,0);
  countries.push({id,parentId:id,name:prefixes[(id+seed)%prefixes.length]+suffixes[Math.floor((id+seed)/prefixes.length)%suffixes.length],centroid:best,tiles:0,lat:90-(map.y(best)+.5)/H*180,lon:(map.x(best)+.5)/W*360-180});
 }
 const buf:number[]=[];let visits=0;
 while(heap.size()){
  const priority=heap.peekPriority(),t=heap.dequeue();if(priority!==dist[t])continue;
  const count=map.neighbors4(t,buf);
  for(let i=0;i<count;i++){
   const nb=buf[i];if(!map.isLand(nb))continue;
   const step=map.y(t)===map.y(nb)?Math.max(.035,map.rowArea[map.y(t)]):1;
   const cost=step*(1+Math.abs(elevation[t]-elevation[nb])/28+elevation[nb]/150)*(0.8+hash(map.x(nb)>>3,map.y(nb)>>3,0,seed)*.4);
   const next=priority+cost;if(next>=dist[nb])continue;dist[nb]=next;country[nb]=country[t];heap.enqueue(nb,next);
  }
  if(++visits%60000===0)progress('Drawing national borders…',45+Math.min(40,Math.round(visits/land.length*40)));
 }
 // Unseeded islands join the nearest country; flood each island, never assign water.
 const queue:number[]=[];
 for(const t of land){if(country[t])continue;let nearest=Infinity,id=1;
  for(let i=0;i<seeds.length;i++){const s=seeds[i],dy=map.y(t)-map.y(s),dx=Math.min(Math.abs(map.x(t)-map.x(s)),W-Math.abs(map.x(t)-map.x(s)))*map.rowArea[map.y(t)];const d=dx*dx+dy*dy;if(d<nearest){nearest=d;id=i+1;}}
  country[t]=id;queue.length=0;queue.push(t);for(let j=0;j<queue.length;j++){const count=map.neighbors4(queue[j],buf);for(let k=0;k<count;k++){const nb=buf[k];if(map.isLand(nb)&&!country[nb]){country[nb]=id;queue.push(nb);}}}
 }
 for(const t of land)countries[country[t]].tiles++;
 map.countries.push(...countries);map.elevation=elevation;map.generated=r;progress('World ready',100);return map;
}

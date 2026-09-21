import type { CountryInfo } from '../core/GameMap';
import { TerrainType } from '../core/types';

/** Fixed gameplay geography, independent of camera zoom. Areas are spherical km². */
export function groupRegions(country: Uint16Array, terrain: Uint8Array, countries: CountryInfo[], width: number, height: number): void {
  const count=countries.length, root=Uint16Array.from({length:count},(_,i)=>i);
  const area=new Float64Array(count), nationArea=new Float64Array(count);
  const members=new Uint16Array(count).fill(1);
  const edges=Array.from({length:count},()=>new Map<number,number>());
  const parent=(id:number)=>countries[id]?.parentId ?? id;
  const land=(t:number)=>terrain[t]>=TerrainType.Plains&&terrain[t]<=TerrainType.Mountain;
  const pixelArea=510_100_000*Math.PI/(2*width*height);
  const connect=(id:number,n:number)=>{
    if(n>=country.length||!land(n))return;
    const other=country[n];if(!other||other===id||parent(other)!==parent(id))return;
    edges[id].set(other,(edges[id].get(other)??0)+1);
    edges[other].set(id,(edges[other].get(id)??0)+1);
  };
  for(let y=0;y<height;y++) {
    const weight=pixelArea*Math.sin(Math.PI*(y+.5)/height);
    for(let x=0;x<width;x++) {
      const t=y*width+x,id=country[t];if(!id||!land(t))continue;
      area[id]+=weight;nationArea[parent(id)]+=weight;
      connect(id,y*width+(x+1)%width);connect(id,t+width);
    }
  }
  const nations=new Map<number,Set<number>>();
  for(let id=1;id<count;id++)if(area[id]>0){const p=parent(id);let set=nations.get(p);if(!set)nations.set(p,set=new Set());set.add(id);}
  for(const [nation,active] of nations) {
    // Keep small countries intact, including their offshore islands.
    if(nationArea[nation]<100_000) {for(const id of active)root[id]=nation;continue;}
    const maxRegions=Math.max(2,Math.ceil(nationArea[nation]/150_000));
    while(active.size>1) {
      const candidates=[...active].filter(id=>edges[id].size>0).sort((a,b)=>area[a]-area[b]||a-b);
      const small=candidates.find(id=>active.size>maxRegions||area[id]<50_000);
      if(small===undefined)break; // Isolated islands are not joined across water.
      let target=-1,best=-Infinity;
      for(const [id,border] of edges[small]) {
        const score=border/Math.sqrt(area[id]);
        if(score>best||(score===best&&id<target)){best=score;target=id;}
      }
      if(target<0)break;
      // Retain the largest constituent's name and representative location.
      let from=small,to=target;if(area[from]>area[to]) [from,to]=[to,from];
      root[from]=to;area[to]+=area[from];members[to]+=members[from];active.delete(from);
      edges[to].delete(from);
      for(const [nb,length] of edges[from]) {
        edges[nb].delete(from);if(nb===to)continue;
        const total=(edges[to].get(nb)??0)+length;
        edges[to].set(nb,total);edges[nb].set(to,total);
      }
      edges[from].clear();
    }
    for(const id of active)if(members[id]>1&&id!==nation){
      const label=countries[id].name.split(' · ')[0];
      countries[id].name=`${label} region · ${countries[nation].name}`;
    }
  }
  const resolve=(id:number):number=>{let r=id;while(root[r]!==r)r=root[r];while(root[id]!==id){const n=root[id];root[id]=r;id=n;}return r;};
  for(let i=0;i<count;i++)resolve(i);
  for(let t=0;t<country.length;t++)country[t]=root[country[t]];
}

/** Internal borders disappear at world view; national borders remain readable. */
export function regionBorderStrength(altitude: number): number {
  const t=Math.max(0,Math.min(1,(altitude-18)/65));
  return .48*(1-t*t*(3-2*t));
}

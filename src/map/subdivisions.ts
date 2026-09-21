import type { CountryInfo } from '../core/GameMap';
import { Rasterizer, largestRingCentroid, type CountryFeature } from './raster';

export type RegionFeature = CountryFeature & { properties: { name: string; admin: string } };

/** Overlay administrative regions, clipped to the existing country's coastline.
 * Match parents by overlap so alternate country spellings cannot drop regions.
 * Fill raster-resolution gaps from neighbors without crossing national borders.
 */
export async function splitRegions(country: Uint16Array, countries: CountryInfo[], regions: RegionFeature[], width: number, height: number, yieldWork: () => Promise<void> = async () => {}): Promise<void> {
  const first = countries.length;
  if (first + regions.length > 65535) throw new Error('Too many map regions');
  const overlay = new Uint16Array(country.length);
  const raster = new Rasterizer(width, height);
  for (let i=0;i<regions.length;i++) {
    const f=regions[i], id=first+i, c=largestRingCentroid(f);
    countries.push({id,name:`${f.properties.name} · ${f.properties.admin}`,centroid:-1,tiles:0,lat:c.lat,lon:c.lon});
    raster.rasterize(f,id,overlay);
    if (i%64===0) await yieldWork();
  }
  const votes = new Map<number, Map<number, number>>();
  for(let t=0;t<country.length;t++) {
    const r=overlay[t], p=country[t];
    if(!r || !p || countries[p].name==='Antarctica') continue;
    let counts=votes.get(r);if(!counts)votes.set(r,counts=new Map());
    counts.set(p,(counts.get(p)??0)+1);
  }
  const parent=new Uint16Array(countries.length);
  for(let i=0;i<first;i++)parent[i]=i;
  for(const [r,counts] of votes) {
    let best=0;
    for(const [p,n] of counts)if(n>best){best=n;parent[r]=p;}
  }
  for(let i=1;i<countries.length;i++) countries[i].parentId = parent[i] || i;
  for(let t=0;t<country.length;t++)if(country[t] && overlay[t] && parent[overlay[t]]===country[t])country[t]=overlay[t];
  const queue:number[]=[];
  const neighbors=(t:number,visit:(n:number)=>void)=>{
    const x=t%width;
    if(t>=width)visit(t-width);
    if(t+width<country.length)visit(t+width);
    visit(t-x+(x+1)%width);visit(t-x+(x+width-1)%width);
  };
  for(let t=0;t<country.length;t++) {
    if(!country[t] || country[t]>=first)continue;
    neighbors(t,n=>{if(country[t]<first && country[n]>=first && parent[country[n]]===country[t]){country[t]=country[n];queue.push(t);}});
  }
  for(let i=0;i<queue.length;i++) {
    const t=queue[i],r=country[t];
    neighbors(t,n=>{if(country[n]===parent[r]){country[n]=r;queue.push(n);}});
  }
}

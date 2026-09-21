import test from 'node:test';
import assert from 'node:assert/strict';
import {groupRegions,regionBorderStrength} from '../src/map/regionGrouping.ts';
function fixture(scale=1,row=350,columns=12,stripe=3,rows=20){
 const width=1440*scale,height=720*scale,country=new Uint16Array(width*height),terrain=new Uint8Array(width*height);
 const countries=[{id:0,name:''},{id:1,name:'Home',parentId:1},{id:2,name:'Neighbor',parentId:2}];
 for(let i=0;i<columns;i++)countries.push({id:i+3,name:`Province ${i} · Home`,parentId:1});
 for(let y=row*scale;y<(row+rows)*scale;y++)for(let x=100*scale;x<(100+columns*stripe)*scale;x++){
  const t=y*width+x;country[t]=3+Math.floor((x-100*scale)/(stripe*scale));terrain[t]=1;
 }
 const other=row*scale*width+(100+columns*stripe)*scale;country[other]=2;terrain[other]=1;
 return {width,height,country,terrain,countries,other};
}
function run(f){groupRegions(f.country,f.terrain,f.countries,f.width,f.height);return new Set([...f.country].filter(id=>id&&id!==2));}
test('medium countries merge adjacent provinces into a few fixed regions without crossing national borders',()=>{
 const f=fixture(),before=f.country.slice(),ids=run(f);
 assert.ok(ids.size>=2&&ids.size<=4,`regions: ${ids.size}`);
 assert.equal(f.country[f.other],2);
 for(let i=0;i<before.length;i++)if(before[i]===0)assert.equal(f.country[i],0);
 // Each merged region must be connected through its own land.
 for(const id of ids){const start=f.country.indexOf(id),seen=new Set([start]),queue=[start];
  for(let i=0;i<queue.length;i++)for(const n of [queue[i]-1,queue[i]+1,queue[i]-f.width,queue[i]+f.width])if(f.country[n]===id&&!seen.has(n)){seen.add(n);queue.push(n);}
  assert.equal(seen.size,f.country.reduce((n,v)=>n+(v===id),0));
 }
});
test('small countries remain whole and large provinces remain separate',()=>{
 assert.deepEqual([...run(fixture(1,350,4,2,5))],[1]);
 assert.equal(run(fixture(1,350,10,20,20)).size,10);
});
test('grouping is deterministic and area-based across resolutions and latitude',()=>{
 const a=fixture(),b=fixture();const count=run(a).size;run(b);assert.deepEqual(a.country,b.country);
 assert.equal(run(fixture(2)).size,count);
 assert.ok(run(fixture(1,20)).size<count);
});
test('regional borders fade smoothly to zero while zoom cannot change map regions',()=>{
 assert.equal(regionBorderStrength(100),0);assert.equal(regionBorderStrength(18),.48);
 let last=1;for(let altitude=0;altitude<200;altitude++){const value=regionBorderStrength(altitude);assert.ok(value<=last&&value>=0);last=value;}
});

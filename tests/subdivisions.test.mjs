import test from 'node:test';
import assert from 'node:assert/strict';
import {splitRegions} from '../src/map/subdivisions.ts';
import {Rasterizer} from '../src/map/raster.ts';
const rect=(name,admin,x0,y0,x1,y1)=>({type:'Feature',properties:{name,admin},geometry:{type:'Polygon',coordinates:[[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]]]}});
test('subdivisions split countries, fill raster gaps, and preserve water and neighboring nations',async()=>{
 const w=360,h=180,country=new Uint16Array(w*h),r=new Rasterizer(w,h);
 r.rasterize(rect('A','A',-40,-20,0,20),1,country);r.rasterize(rect('B','B',0,-20,40,20),2,country);
 const original=country.slice(),countries=[{id:0,name:''},{id:1,name:'A'},{id:2,name:'B'}];
 const regions=[rect('West','A',-45,-25,-21,25),rect('East','A',-19,-25,1,25),rect('Offshore','None',90,0,100,10)];
 await splitRegions(country,countries,regions,w,h);
 for(let t=0;t<country.length;t++){
  if(!original[t])assert.equal(country[t],0,'water was repainted');
  if(original[t]===2)assert.equal(country[t],2,'neighbor was repainted');
  if(original[t]===1)assert.ok(country[t]===3||country[t]===4,'gap not filled');
 }
 assert.equal(countries[3].name,'West · A');
 assert.ok(country.includes(3)&&country.includes(4));
});

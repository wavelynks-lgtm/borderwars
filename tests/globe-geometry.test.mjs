import test from 'node:test';
import assert from 'node:assert/strict';
import { displayColumns, displayTileAtUV } from '../src/map/displayGrid.ts';
import { SurfacePath } from '../src/core/surfacePath.ts';
import { GameMap } from '../src/core/GameMap.ts';
import { frontArrival, frontResistance } from '../src/core/frontGeometry.ts';

test('display cells have almost equal surface width and height at equator and high latitudes',()=>{
  for(const h of [256,2048,2896]) for(const lat of [0,45,70,85,89]) {
    const row=Math.floor((90-lat)/180*h);
    const ratio=2*h*Math.sin(Math.PI*(row+.5)/h)/displayColumns(2*h,h,row);
    assert.ok(Math.abs(ratio-1)<.05,`${h}, ${lat}: ${ratio}`);
  }
});
test('display picking is stable within cells, wraps at the date line, and clamps poles',()=>{
  const w=4096,h=2048,row=31,c=displayColumns(w,h,row),v=(row+.5)/h;
  for(const col of [0,3,c-1]) assert.equal(displayTileAtUV(w,h,(col+.01)/c,v),displayTileAtUV(w,h,(col+.99)/c,v));
  assert.equal(displayTileAtUV(w,h,0,v),displayTileAtUV(w,h,1,v));
  assert.ok(displayTileAtUV(w,h,0,1)<w*h);
});
test('front geometry combines perpendicular steps and resistance has coherent seeded variation',()=>{
 assert.equal(frontArrival(Infinity,Infinity,1,1),Infinity);
 assert.equal(frontArrival(0,Infinity,1,1),1);
 assert.ok(Math.abs(frontArrival(0,0,1,1)-Math.SQRT1_2)<1e-10);
 const cost=(x,y,seed=12)=>frontResistance(x,y,4096,2048,seed);
 assert.equal(cost(123,900),cost(123,900));
 assert.notEqual(cost(123,900),cost(123,900,13));
 assert.ok(Math.abs(cost(4095,900)-cost(0,900))<.2);
 assert.ok(Math.abs(cost(123,900)-cost(124,900))<.2);
 assert.ok(Math.abs(cost(123,900)-cost(170,950))>.1);
});
test('train distance follows rail corners and wraps rather than crossing the globe',()=>{
  const w=128,h=64,map=new GameMap(w,h,new Uint8Array(w*h),new Uint16Array(w*h),[]);
  const path=new SurfacePath(map,[map.ref(127,32),map.ref(0,32),map.ref(0,33),map.ref(0,34)]);
  assert.ok(path.length<3.01&&path.length>2.99);
  const p=path.sample(1.5);assert.equal(p.x,.5);assert.ok(p.y>33&&p.y<33.01);
  const midpoint=path.sample(.5);assert.ok(midpoint.x<.01||midpoint.x>127.99);
  assert.equal(path.sample(-10).x,127.5);assert.equal(path.sample(99).y,34.5);
});
test('train surface speed and carriage spacing account for polar longitude compression',()=>{
  const w=4096,h=2048,map=new GameMap(w,h,new Uint8Array(w*h),new Uint16Array(w*h),[]);
  for(const row of [1024,100]) {
    const tiles=Array.from({length:200},(_,i)=>map.ref(500+i,row));
    const path=new SurfacePath(map,tiles);
    const a=path.sample(15),b=path.sample(11);
    const distance=(a.x-b.x)*Math.sin(Math.PI*(row+.5)/h);
    assert.ok(Math.abs(distance-4)<1e-8);
  }
});

test('boats travel the same surface distance at different latitudes',async()=>{
  const {moveAlongPath}=await import('../src/core/movement.ts');
  const w=4096,h=2048,map=new GameMap(w,h,new Uint8Array(w*h),new Uint16Array(w*h),[]);
  for(const y of [1024,100]) {
    const u={fx:500.5,fy:y+.5,heading:0,tile:map.ref(500,y),path:[map.ref(700,y)],pathIndex:0};
    moveAlongPath(u,3,map);
    assert.ok(Math.abs((u.fx-500.5)*Math.sin(Math.PI*(y+.5)/h)-3)<1e-8);
  }
});

test('invasions prioritize supported pockets and weak terrain over arbitrary variation',async()=>{
  const {invasionResistance:r}=await import('../src/core/frontGeometry.ts');
  assert.ok(r(1,2,1,false)<r(1,1,1,false));
  assert.ok(r(1,3,1,false)<r(1,2,1,false));
  assert.ok(r(1,1,1,false)<r(2,1,1,false));
  assert.ok(r(1,1,1,false)<r(1,1,1,true));
  assert.ok(r(1,1,100,false)<=2.2);
  assert.ok(r(1,1,.001,false)>=.45);
});

test('surface coverage discs include exactly the same tiles as great-circle range checks',()=>{
 const w=128,h=64,map=new GameMap(w,h,new Uint8Array(w*h),new Uint16Array(w*h),[]);
 for(const center of [map.ref(0,32),map.ref(127,3),map.ref(50,0),map.ref(50,63)]){
  const found=[];map.forEachSurfaceTile(center,6,t=>found.push(t));
  const expected=[];for(let t=0;t<w*h;t++)if(map.surfaceDistance(center,t)<=6+1e-8)expected.push(t);
  assert.deepEqual(found.toSorted((a,b)=>a-b),expected);
 }
});

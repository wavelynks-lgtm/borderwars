import test from 'node:test';
import assert from 'node:assert/strict';
import { GameMap } from '../src/core/GameMap.ts';
import { GlobeRenderer } from '../src/render/GlobeRenderer.ts';
import { FLAG_FRONT_OUT, TerrainType } from '../src/core/types.ts';
function renderer(w=64,h=32) {
  const map=new GameMap(w,h,new Uint8Array(w*h).fill(TerrainType.Plains),new Uint16Array(w*h),[]);
  const r=Object.create(GlobeRenderer.prototype);
  Object.assign(r,{map,ownerData:new Uint8Array(w*h*4),frontFlags:new Uint8Array(w*h),ghostRail:new Uint8Array(w*h),frontList:[],previousOut:[],previousIn:[],ownerTex:{}});
  const uploads=[];r.uploadTexRect=(_tex,_data,x0,y0,x1,y1)=>uploads.push({x0,y0,x1,y1});
  return {map,r,uploads};
}
test('isolated changes on distant rows do not upload a world-wide rectangle',()=>{
  const {map,r,uploads}=renderer();
  map.owner[map.ref(1,1)]=1;map.markDirty(map.ref(1,1));map.owner[map.ref(60,30)]=2;map.markDirty(map.ref(60,30));
  r.syncTerritory();assert.equal(map.dirty,false);
  assert.equal(uploads.reduce((n,u)=>n+(u.x1-u.x0+1)*(u.y1-u.y0+1),0),2);
  assert.equal(r.ownerData[map.ref(60,30)*4],2);
});
test('partial uploads finish all rows and retain updates made between frames',()=>{
  const {map,r}=renderer(64,600);
  for(let y=0;y<600;y++){map.owner[map.ref(3,y)]=1;map.markDirty(map.ref(3,y));}
  r.syncTerritory();assert.equal(map.dirty,true);
  map.owner[map.ref(2,0)]=2;map.markDirty(map.ref(2,0));
  for(let i=0;i<10&&map.dirty;i++)r.syncTerritory();assert.equal(map.dirty,false);
  for(let y=0;y<600;y++)assert.equal(r.ownerData[map.ref(3,y)*4],1);
  assert.equal(r.ownerData[map.ref(2,0)*4],2);
});
test('front highlight updates when interior tiles change but endpoints do not',()=>{
  const {r}=renderer();r.setFrontTiles([1,2,5],[]);r.setFrontTiles([1,3,5],[]);
  assert.equal(r.frontFlags[2]&FLAG_FRONT_OUT,0);assert.equal(r.frontFlags[3]&FLAG_FRONT_OUT,FLAG_FRONT_OUT);
});
test('continuously changing northern rows cannot starve southern territory updates',()=>{
  const {map,r}=renderer(64,600);
  for(let y=0;y<600;y++){map.owner[map.ref(3,y)]=1;map.markDirty(map.ref(3,y));}
  for(let f=0;f<4;f++) {
    for(let y=0;y<256;y++)map.markDirty(map.ref(3,y));
    r.syncTerritory();
  }
  assert.equal(r.ownerData[map.ref(3,599)*4],1);
});

test('partial territory uploads preserve Three.js pixel-store cache coherence for newly placed icons',()=>{
 const {r}=renderer();const calls=[];
 const gl={TEXTURE_2D:1,UNPACK_FLIP_Y_WEBGL:2,UNPACK_PREMULTIPLY_ALPHA_WEBGL:3,UNPACK_ALIGNMENT:4,UNPACK_COLORSPACE_CONVERSION_WEBGL:5,NONE:0,UNPACK_ROW_LENGTH:6,UNPACK_SKIP_ROWS:7,UNPACK_SKIP_PIXELS:8,RGBA:9,UNSIGNED_BYTE:10,texSubImage2D(){},pixelStorei(){throw new Error('Direct GL state mutation bypasses Three.js cache');}};
 r.renderer={getContext:()=>gl,properties:{get:()=>({__webglTexture:{}})},state:{bindTexture(){},pixelStorei:(key,value)=>calls.push([key,value])}};
 GlobeRenderer.prototype.uploadTexRect.call(r,{},new Uint8Array(64*32*4),2,3,4,5);
 assert.ok(calls.some(([key,value])=>key===gl.UNPACK_FLIP_Y_WEBGL&&value===0));
 for(const key of [gl.UNPACK_ROW_LENGTH,gl.UNPACK_SKIP_ROWS,gl.UNPACK_SKIP_PIXELS])assert.equal(calls.filter(c=>c[0]===key).at(-1)[1],0);
});

test('distant structure markers batch overlapping buildings and preserve separate owners',async()=>{
 const THREE=await import('three');const {StructureOverview}=await import('../src/render/StructureOverview.ts');
 const overview=new StructureOverview(new THREE.Group()),cam=new THREE.PerspectiveCamera(60,1,.1,1000);
 cam.position.z=10;cam.lookAt(0,0,0);cam.updateMatrixWorld();
 const units=new Map();
 for(let i=0;i<100;i++){
  const mesh=new THREE.Mesh();mesh.position.set(0,0,0);mesh.scale.setScalar(.1);
  units.set({active:true,isStructure:()=>true,owner:{smallID:i<50?1:2,color:i<50?'#ff0000':'#00ff00'}},mesh);
 }
 overview.update(units,cam,1000,1000,10);
 assert.equal(overview.geometry.drawRange.count,2);assert.ok([...units.values()].every(m=>!m.visible));
 for(const mesh of units.values())mesh.visible=true;
 overview.update(units,cam,1000,1000,1000);
 assert.equal(overview.geometry.drawRange.count,0);assert.ok([...units.values()].every(m=>m.visible));
});

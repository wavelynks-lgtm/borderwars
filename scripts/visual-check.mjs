import { chromium } from 'playwright';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1200,height:900}});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await page.route('**/favicon.ico', route=>route.fulfill({status:204}));
await page.goto(process.env.BW_URL??'http://127.0.0.1:5175');
await page.waitForLoadState('networkidle');
await page.evaluate(async()=>{
 const [{GameMap},{Game},{DEFAULT_SETTINGS,TerrainType:T,PlayerType:P,UnitType:U},{GlobeRenderer},{UnitLayer},{AttackExecution},{Station,Railroad},{TrainExecution}]=await Promise.all([
 '/src/core/GameMap.ts','/src/core/Game.ts','/src/core/types.ts','/src/render/GlobeRenderer.ts','/src/render/UnitLayer.ts','/src/core/executions/AttackExecution.ts','/src/core/RailNetwork.ts','/src/core/executions/TrainExecution.ts'].map(p=>import(p)));
 document.body.innerHTML='<canvas id="fixture" style="position:fixed;inset:0;width:100%;height:100%"></canvas>';
 const W=2048,H=1024,terrain=new Uint8Array(W*H).fill(T.Plains);
 const map=new GameMap(W,H,terrain,new Uint16Array(W*H),[]);
 const game=new Game(map,{...DEFAULT_SETTINGS,spawnPhaseSeconds:0,winPercent:101});
 const globe=new GlobeRenderer(document.querySelector('canvas'),map);
 const units=new UnitLayer(globe,game);
 const player=game.addPlayer('Visual fixture',P.Human,'#ef3947');player.hasSpawned=true;player.troops=100000;
 globe.setPlayerColor(player.smallID,{r:.937,g:.224,b:.278});
 window.fixture={map,game,globe,units,player,U,Station,Railroad,TrainExecution,AttackExecution};
 window.sceneAt=(lat)=>{
  const f=window.fixture,{map,game,globe,player,units}=f;
  const y=Math.floor((90-lat)/180*H),cx=1000;
  for(const t of [...player.tiles])game.relinquish(t);
  for(const unit of [...game.units])game.removeUnit(unit);
  game.rail.railroads.clear();game.rail.version++;
  const start=map.ref(cx,y);game.conquer(player,start);
  game.config.attackLogic=()=>({attackerTroopLoss:0,defenderTroopLoss:0,tickFraction:1});
  const attack=new AttackExecution(10000,player,null,map.ref(cx+1,y));attack.init(game);
  for(let i=0;i<3000;i++){attack.tick();game.ticks++;}
  attack.returnUnusedTroops();
  const cos=Math.sin(Math.PI*(y+.5)/H),sx=n=>cx+Math.round(n/cos);
  const points=[];
  for(let x=sx(-22);x<=sx(12);x++)points.push(map.ref(x,y+3));
  for(let row=y+4;row<=y+18;row++)points.push(map.ref(sx(12),row));
  const a=game.addUnit(U.Factory,player,points[0]),b=game.addUnit(U.City,player,points.at(-1));
  a.constructing=false;b.constructing=false;game.onConstructionComplete?.(a);
  const sa=new Station(a),sb=new Station(b),rail=new Railroad(sa,sb,points);
  game.rail.railroads.add(rail);game.rail.version++;
  const train=new TrainExecution(sa,sb,[sa,sb],points.slice(1));train.init(game);
  for(let i=0;i<20;i++)train.tick();
  for(const [i,type] of [U.TransportShip,U.TradeShip,U.Warship].entries())game.addUnit(type,player,map.ref(sx(-16+i*15),y-16));
  for(let i=0;i<10;i++)globe.syncTerritory();
  globe.camera.position.copy(globe.tileToWorld(map.ref(cx,y))).normalize().multiplyScalar(125);
  globe.controls.enableDamping=false;
  globe.controls.minPolarAngle=.001;globe.controls.maxPolarAngle=Math.PI-.001;
  globe.controls.update(); units.update();globe.render();
  return {lat,tiles:player.numTiles,units:game.units.size};
 };
 window.renderFixture=()=>{units.update();globe.render();};
});
await page.waitForTimeout(500);
for(const lat of [0,75,85,-85]) {
 console.log(await page.evaluate(lat=>window.sceneAt(lat),lat));
 await page.evaluate(()=>{
  const {globe,units,map}=fixture;
  globe.setRailGhost([{ref:map.ref(1000,512),type:2}],[]); units.update();
  if(!units.rails.preview?.geometry.attributes.position.count)throw new Error('Rail preview missing');
  globe.setRailGhost([]);units.update();
  if(units.rails.preview)throw new Error('Rail preview did not clear');
  renderFixture();
  for(const [u,mesh] of units.pixels)if(u.isStructure()||u.type===fixture.U.Train){
   if(Math.abs(mesh.quaternion.dot(globe.camera.quaternion))<.99999)throw new Error('Placed icon is not upright');
  }
  const tile=[...fixture.player.tiles][0];
  units.setGhost(fixture.U.MissileSilo,tile,true);
  if(Math.abs(units.ghostDecal.quaternion.dot(globe.camera.quaternion))<.99999)throw new Error('Preview is not upright');
  units.setGhost(null,-1,false);
 });
 await page.evaluate(()=>{
  const {units,game,player}=fixture;
  units.setRangeOverlay([...player.tiles][0],game.config.samRange(3));
  for(const mesh of [units.ghostRange,units.ghostRangeFill]){
   const p=mesh.geometry.getAttribute('position');
   for(let i=0;i<p.count;i++)if(Math.abs(Math.hypot(p.getX(i),p.getY(i),p.getZ(i))-100.015)>.0001)throw new Error('Range circle floats above the globe');
   if(!mesh.material.depthTest||mesh.renderOrder>=12)throw new Error('Range circle draws over structures');
  }
  renderFixture();
 });
 await page.screenshot({path:`/tmp/borderwars-range-${lat}.png`});
 await page.evaluate(()=>{fixture.units.setGhost(null,-1,false);renderFixture();});
 await page.screenshot({path:`/tmp/borderwars-visual-${lat}.png`});
}
await page.evaluate(()=>{
 const {game,map,globe,units,player,U}=fixture;
 for(const u of [...game.units])game.removeUnit(u);
 game.rail.railroads.clear();game.rail.version++;
 const types=[U.City,U.Port,U.Factory,U.DefensePost,U.SAMLauncher,U.MissileSilo];
 for(const [i,type] of types.entries()) {
  const t=map.ref(980+(i%3)*20,504+Math.floor(i/3)*18);
  game.conquer(player,t);
  const u=game.addUnit(type,player,t);u.constructing=false;
 }
 game.onConstructionComplete?.([...game.units][0]);
 globe.camera.position.copy(globe.tileToWorld(map.ref(1000,513))).normalize().multiplyScalar(125);
 globe.controls.update();units.update();globe.render();
 for(const [u,mesh] of units.pixels)if(u.isStructure()&&Math.abs(mesh.quaternion.dot(globe.camera.quaternion))<.99999)throw new Error('Gallery icon is inverted');
});
// Frozen simulation frames should reuse unit appearance work, while ticks and
// camera rotation must immediately refresh it (including upside-down prevention).
console.log('Unit frame reuse',await page.evaluate(()=>{
 const {units,game,globe}=fixture;
 units.update();
 let calls=0;const original=units.pixelMaterial;
 units.pixelMaterial=function(...args){calls++;return original.apply(this,args);};
 for(let i=0;i<60;i++)units.update();
 if(calls!==0)throw new Error(`Repeated appearance work on unchanged frames: ${calls}`);
 game.ticks++;units.update();const tickCalls=calls;
 if(tickCalls===0)throw new Error('Units did not refresh after simulation tick');
 globe.camera.rotateZ(.01);units.update();
 if(calls===tickCalls)throw new Error('Units did not refresh after camera rotation');
 globe.camera.rotateZ(-.01);units.update();
 units.pixelMaterial=original;
 return {unchangedFrames:60,repeatedMaterialChecks:0,tickChecks:tickCalls};
}));
const orientation=await page.evaluate(()=>{
 const {game,globe,units,U}=fixture;
 const silo=[...game.units].find(u=>u.type===U.MissileSilo),mesh=units.pixels.get(silo);
 globe.render();
 const gl=globe.renderer.getContext(),width=gl.drawingBufferWidth,height=gl.drawingBufferHeight;
 const projected=mesh.position.clone().project(globe.camera);
 const view=mesh.position.clone().applyMatrix4(globe.camera.matrixWorldInverse);
 const span=mesh.scale.y*height/(2*-view.z*Math.tan(globe.camera.fov*Math.PI/360));
 const cx=(projected.x+1)*width/2,cy=(projected.y+1)*height/2;
 const count=offset=>{const x=Math.floor(cx-span/2),y=Math.floor(cy+offset*span),w=Math.ceil(span);const data=new Uint8Array(w*4);gl.readPixels(x,y,w,1,gl.RGBA,gl.UNSIGNED_BYTE,data);let red=0;for(let i=0;i<data.length;i+=4)if(data[i]>data[i+1]*1.3&&data[i]>60)red++;return red;};
 return {upper:count(.15),lower:count(-.15)};
});
if(orientation.lower<=orientation.upper*1.5)throw new Error(`Silo was uploaded upside down: ${JSON.stringify(orientation)}`);
console.log('Rendered silo orientation',orientation);
await page.evaluate(()=>{
 const {game,map,globe,units,player,U}=fixture;
 const rocket=game.addUnit(U.AtomBomb,player,map.ref(1000,512));
 const sprite=units.sprites.get(rocket);
 const right=sprite.position.clone().setFromMatrixColumn(globe.camera.matrixWorld,0);
 units.rocketPrev.set(rocket,sprite.position.clone().sub(right));
 units.orientRocket(rocket,sprite);
 if(Math.abs(sprite.material.rotation+Math.PI/2)>1e-6)throw new Error('Rocket icon points against its flight direction');
 if(sprite.material.map.repeat.y!==1)throw new Error('Sprite is flipped');
 game.removeUnit(rocket);renderFixture();
});
await page.screenshot({path:'/tmp/borderwars-openfront-icons.png'});
console.log('Building overview',await page.evaluate(()=>{
 const {game,map,globe,units,player,U}=fixture;
 for(const u of [...game.units])game.removeUnit(u);
 for(let i=0;i<500;i++){
  const tile=map.ref(970+(i%25)*3,480+Math.floor(i/25)*3);
  game.conquer(player,tile);const u=game.addUnit([U.City,U.Factory,U.SAMLauncher][i%3],player,tile);u.constructing=false;u.level=1+i%4;
 }
 globe.camera.position.copy(globe.tileToWorld(map.ref(1006,510))).normalize().multiplyScalar(350);
 globe.controls.update();units.update();globe.render();
 const count=units.overview.geometry.drawRange.count;
 const full=[...units.pixels].filter(([u,m])=>u.isStructure()&&m.visible).length;
 if(full!==0||count<1||count>=500)throw new Error(`Overview did not declutter: ${full} icons, ${count} markers`);
 const calls=globe.renderer.info.render.calls;
 if(calls>20)throw new Error(`Overview still has excessive draw calls: ${calls}`);
 return {buildings:500,fullIcons:full,markers:count,drawCalls:calls};
}));
await page.screenshot({path:'/tmp/borderwars-building-overview.png'});
console.log('Visual errors',errors);
await browser.close();
if(errors.length)process.exitCode=1;

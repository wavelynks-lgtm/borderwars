import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(({world,packed})=>localStorage.setItem('borderwars.settings',JSON.stringify({settingsRev:4,world,devMode:false,randomSpawn:true,numNations:packed?28:10,numBots:packed?71:9})),{world:process.env.BW_WORLD??'earth',packed:process.env.BW_PACKED==='1'});
await page.goto((process.env.BW_URL??'http://127.0.0.1:5173')+'/?dev=0');
await page.getByRole('button',{name:'Single Player'}).click();
await page.getByRole('button',{name:'Start',exact:true}).click();
await page.locator('.world-loading').waitFor({state:'visible'});
await page.screenshot({path:'/tmp/borderwars-world-loading.png'});
await page.evaluate(()=>{
 window.__startupAudit=null;
 new MutationObserver((_records,observer)=>{
  if(!document.querySelector('.world-loading')&&window.__game){
   window.__startupAudit={ticks:__game.ticks,unspawnedAI:__game.allPlayers().filter(p=>p.type!=='human'&&!p.hasSpawned).length};observer.disconnect();
  }
 }).observe(document.getElementById('ui'),{childList:true});
});
await page.waitForFunction(()=>!!window.__game, null, {timeout:120000});
await page.locator('.world-loading').waitFor({state:'detached'});
const startup=await page.evaluate(()=>window.__startupAudit);
console.log('Startup',startup);
if(!startup||startup.ticks!==0||startup.unspawnedAI!==0)throw new Error('Countdown started before roster readiness');
await page.keyboard.press('F3');
await page.waitForTimeout(1100);
if(!(await page.locator('.performance-label').isVisible()))throw new Error('FPS display failed');
console.log('Loaded',await page.evaluate(()=>({map:[__map.width,__map.height],players:__game.allPlayers().length})));
if((process.env.BW_WORLD??'earth')==='earth') {
 const regions=await page.evaluate(()=>Object.fromEntries(['Russia','China','Canada','Brazil','Australia','United States of America','Turkey','Belgium'].map(name=>{
  const parent=__map.countries.find(c=>c.name===name);
  return [name,__map.countries.filter(c=>c.tiles>0&&(c.parentId??c.id)===parent?.id).length];
 })));
 console.log('Gameplay regions',regions);
 for(const name of ['Russia','China','Canada','Brazil','Australia','United States of America'])if(regions[name]<5)throw new Error(`${name} lost its subdivisions: ${regions[name]}`);
 if(regions.Turkey<2||regions.Turkey>12||regions.Belgium!==1)throw new Error('Region grouping failed');
}
await page.evaluate(()=>{
  const g=window.__game; g.skipSpawnPhase();
  window.__globe.flyTo(g.human.spawnTile,100);
});
await page.waitForTimeout(500);
await page.evaluate(()=>{
  const g=window.__game;const t=g.borderContact(g.human,0);
  if(t>=0)window.__app.doAttack(t);
});
await page.waitForTimeout(3000);
await page.keyboard.press('p');
const before=await page.evaluate(()=>__game.ticks);
await page.waitForTimeout(400);
if(await page.evaluate(()=>__game.ticks)!==before)throw new Error('Pause failed');
await page.keyboard.press('p');
const frames=await page.evaluate(()=>new Promise(resolve=>{
  const samples=[];let prev=performance.now();
  const next=t=>{samples.push(t-prev);prev=t;if(samples.length<180)requestAnimationFrame(next);else resolve(samples.slice(10));};requestAnimationFrame(next);
}));
const sorted=frames.toSorted((a,b)=>a-b);
console.log('Frames',JSON.stringify({meanMs:frames.reduce((a,b)=>a+b,0)/frames.length,p95Ms:sorted[Math.floor(sorted.length*.95)]}));
console.log('State',await page.evaluate(()=>({ticks:__game.ticks,tiles:__game.human.numTiles,area:__game.human.landArea,pop:__game.human.population,max:__game.config.maxPopulation(__game.human),glError:__globe.renderer.getContext().getError()})));
if(process.env.BW_PACKED==='1') {
  const timings=[];
  await page.evaluate(()=>{__app.paused=true;});
  if(process.env.BW_TRACE==='1')await page.evaluate(()=>{
    const g=__game;window.__slow=[];
    const wrap=(obj,key,label)=>{const original=obj[key];if(typeof original!=='function'||original.__timed)return;const fn=function(...args){const start=performance.now();try{return original.apply(this,args);}finally{const ms=performance.now()-start;if(ms>20)__slow.push({label,ms,tick:g.ticks});}};fn.__timed=true;obj[key]=fn;};
    for(const key of Object.getOwnPropertyNames(Object.getPrototypeOf(g)))if(key!=='constructor')wrap(g,key,`Game.${key}`);
    for(const e of [...g.executions,...g.pendingExecutions]){const p=Object.getPrototypeOf(e);wrap(p,'tick',`${e.constructor.name}.tick`);wrap(p,'init',`${e.constructor.name}.init`);}
    for(const key of ['findPath','findPathFine'])wrap(g.waterPathfinder,key,`WaterPathfinder.${key}`);
  });
  for(let batch=0;batch<60;batch++) {
    timings.push(...await page.evaluate(()=>{const times=[];for(let i=0;i<30;i++){const t=performance.now();__game.tick();times.push(performance.now()-t);}return times;}));
  }
  if(process.env.BW_TRACE==='1')console.log('Slow calls',await page.evaluate(()=>__slow));
  console.log('Soak',await page.evaluate(()=>{
    const g=__game,m=g.map;let mismatch=0,areaError=0;
    for(const p of g.allPlayers()) {let area=0;for(const t of p.tiles){if(m.owner[t]!==p.smallID)mismatch++;area+=m.tileArea(t);}areaError=Math.max(areaError,Math.abs(area-p.landArea));if(!Number.isFinite(p.population)||p.troops<0||p.workers<0)throw new Error('Invalid population');}
    return {ticks:g.ticks,alive:g.alivePlayers().length,units:g.units.size,claimed:g.allPlayers().reduce((n,p)=>n+p.numTiles,0),mismatch,areaError};
  }));
  timings.sort((a,b)=>a-b);console.log('Simulation ms',{p50:timings[Math.floor(timings.length*.5)],p95:timings[Math.floor(timings.length*.95)],max:timings.at(-1)});
}
if(process.env.BW_SALVO_CHECK==='1') {
 const targets=await page.evaluate(()=>{
  __app.paused=true;const g=__game,p=g.human;g.skipSpawnPhase();p.gold=1e8;
  const home=p.spawnTile,silo=g.addUnit('missile_silo',p,home);silo.constructing=false;silo.cooldownUntil=0;
  const targets=[...p.tiles].filter(t=>g.map.dist(t,home)>2&&g.map.dist(t,home)<8).slice(0,2);
  if(targets.length<2)throw new Error('No missile test targets');
  __globe.camera.position.copy(__globe.tileToWorld(home)).normalize().multiplyScalar(125);__globe.controls.enableDamping=false;__globe.controls.update();
  __app.buildBar.toggle('atom_bomb');return targets;
 });
 await page.getByRole('button',{name:'Mark multiple targets',exact:true}).click();
 for(const tile of targets){
  const pos=await page.evaluate(tile=>{const p={x:0,y:0,scale:1};if(!__globe.projectTile(tile,p))throw new Error('Target is hidden');return p;},tile);
  await page.mouse.click(pos.x,pos.y);
 }
 await page.screenshot({path:'/tmp/borderwars-missile-plan.png'});
 const camera=await page.evaluate(()=>__globe.camera.position.toArray());
 await page.getByRole('button',{name:'Launch salvo',exact:true}).click();
 console.log('Salvo',await page.evaluate(()=>{
  const a=__app;if(!a.salvo||a.salvo.orders.length!==2)throw new Error('Salvo did not queue both markers');
  __game.tick();const waiting=a.salvo.orders.length;
  if(waiting!==1)throw new Error(`Expected one missile waiting for reload, got ${waiting}`);
  return {waiting,marked:a.unitLayer.missileTargets.length};
 }));
 await page.waitForTimeout(250);
 const after=await page.evaluate(()=>__globe.camera.position.toArray());
 if(camera.some((n,i)=>Math.abs(n-after[i])>.00001))throw new Error('Missile launch moved the camera');
 await page.getByRole('button',{name:'Cancel remaining & refund',exact:true}).click();
 if(await page.evaluate(()=>!!__app.salvo))throw new Error('Cancel did not clear pending salvo');
 await page.evaluate(()=>{const s=__game.human.unitsOf('missile_silo').find(s=>s.active);s.cooldownUntil=0;__app.buildBar.toggle('atom_bomb');});
 const directPosition=await page.evaluate(tile=>{const p={x:0,y:0,scale:1};__globe.projectTile(tile,p);return p;},targets[0]);
 const directCamera=await page.evaluate(()=>__globe.camera.position.toArray());
 await page.mouse.click(directPosition.x,directPosition.y);
 await page.waitForTimeout(500);
 const directAfter=await page.evaluate(()=>__globe.camera.position.toArray());
 if(directCamera.some((n,i)=>Math.abs(n-directAfter[i])>.00001))throw new Error('Single missile launch moved the camera');
 if(await page.evaluate(()=>__app.armed!==null))throw new Error('Single missile did not launch');

}
if(process.env.BW_REGION_SCREENSHOTS==='1') {
 for(const altitude of [25,100]) {
  const state=await page.evaluate(altitude=>{
   __app.paused=true;
   const t=__map.latLonToTile(38,39);
   __globe.camera.position.copy(__globe.tileToWorld(t)).normalize().multiplyScalar(100+altitude);
   __globe.controls.enableDamping=false;__globe.controls.update();__globe.render();
   return {altitude,national:__globe.material.uniforms.uBorderStrength.value,regional:__globe.material.uniforms.uRegionBorderStrength.value};
  },altitude);
  if(state.national<.5||(altitude===100&&state.regional!==0)||(altitude===25&&state.regional<.3))throw new Error('Border zoom hierarchy failed');
  console.log('Borders',state);
  await page.waitForTimeout(300);
  await page.screenshot({path:`/tmp/borderwars-regions-${altitude}.png`});
 }
}
await page.screenshot({path:`/tmp/borderwars-${process.env.BW_WORLD??'earth'}-${process.env.BW_PACKED==='1'?'packed':'game'}.png`});
console.log('Errors',errors);
await writeFile(`/tmp/borderwars-${process.env.BW_WORLD??'earth'}-browser-results.json`,JSON.stringify({frames,errors},null,2));
await browser.close();
if(errors.length)process.exitCode=1;

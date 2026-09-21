import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],ads=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/shader|WebGL/.test(m.text()))errors.push(m.text());});page.on('request',r=>{if(/googlesyndication|doubleclick/.test(r.url()))ads.push(r.url());});
 await page.goto('http://127.0.0.1:4174/?dev=0');
 await page.getByRole('button',{name:/Customize/}).click();await page.getByLabel('Flag',{exact:true}).selectOption('BE');await page.getByLabel('Territory pattern').selectOption('stripes');await page.getByLabel('Territory color').fill('#ce405a');await page.getByRole('button',{name:'Save appearance'}).click();
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('borderwars.cosmetics')).flag),'BE');
 await page.getByRole('button',{name:/Store/}).click();await page.getByText('Purchases are not available yet.',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Coming soon'}).count(),2);assert.ok(await page.getByRole('button',{name:'Coming soon'}).first().isDisabled());await page.getByRole('button',{name:'Close',exact:true}).click();
 await page.getByRole('button',{name:/World Forge/}).click();await page.getByRole('button',{name:'Play this world'}).waitFor();
 await page.getByLabel('Resolution (width)').selectOption('1024');await page.getByLabel('World name').fill('Azure Isles');await page.getByLabel('Seed',{exact:true}).fill('Islands-2026');await page.getByLabel('Land layout').selectOption('archipelago');
 await page.getByLabel('Water coverage %').fill('72');await page.getByLabel('Countries',{exact:true}).fill('24');
 await page.getByRole('button',{name:'Generate world',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.creator-actions .btn:nth-child(3)').disabled,null,{timeout:120000});
 await page.getByRole('button',{name:'Save world',exact:true}).click();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export',exact:true}).click();await (await download).saveAs('/tmp/borderwars-saved-world.json');const recipe=JSON.parse(await readFile('/tmp/borderwars-saved-world.json','utf8'));assert.equal(recipe.name,'Azure Isles');assert.equal(recipe.water,72);
 await page.screenshot({path:'/tmp/borderwars-world-forge.png'});
 await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:/World Forge/}).click();await page.locator('.saved-world').getByRole('button',{name:'Load',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.creator-status').textContent.includes('Azure Isles')&&document.querySelector('.creator-status').textContent.includes('ready'),null,{timeout:120000});
 assert.equal(await page.getByLabel('Water coverage %').inputValue(),'72');
 await page.getByRole('button',{name:'Play this world'}).click();await page.waitForFunction(()=>!!window.__game,null,{timeout:120000});
 const state=await page.evaluate(()=>({world:__map.generated,flag:__game.human.flag,pattern:__game.human.cosmetics.pattern,countries:__map.countries.length}));assert.equal(state.world.name,'Azure Isles');assert.equal(state.flag,'🇧🇪');assert.equal(state.pattern,'stripes');assert.equal(state.countries,25);
 await page.evaluate(()=>{const g=__game;g.skipSpawnPhase();__app.paused=true;const t=__map.countries.slice(1).sort((a,b)=>b.tiles-a.tiles)[0].centroid;g.claimAround(g.human,t,60);__globe.flyTo_=null;__globe.flyFrom=null;__globe.controls.enableDamping=false;__globe.camera.position.copy(__globe.tileToWorld(t)).normalize().multiplyScalar(145);__globe.controls.update();});
 await page.waitForTimeout(1200);await page.screenshot({path:'/tmp/borderwars-custom-world-pattern.png'});
 console.log('Generated match',state);console.log('Unconfigured ad requests',ads.length);assert.deepEqual(ads,[]);assert.deepEqual(errors,[]);console.log('Browser errors',errors);
}finally{await browser.close();}

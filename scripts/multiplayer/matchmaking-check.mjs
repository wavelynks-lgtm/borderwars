import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {DEFAULT_RECIPE} from '../../src/map/generator.ts';
import {Store} from '../../server/store.mjs';
const browser=await chromium.launch({channel:'chrome',headless:true});
const ids=[],errors=[];
const store=new Store();
try{
 const pages=[];
 for(let i=0;i<3;i++){
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),p=await context.newPage();pages.push(p);p.on('pageerror',e=>errors.push(e.message));
  if(i<2){const name=`Match${i}_${Date.now().toString(36)}`;const result=await fetch('http://127.0.0.1:8787/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:name,password:'matchmaking verification 123'})}).then(r=>r.json());assert.ok(result.token,JSON.stringify(result));ids.push(result.profile.id);await context.addInitScript(token=>localStorage.setItem('borderwars.session',token),result.token);await context.route('**/api/auth/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(route.request().url().endsWith('/token')?{token:result.token}:{user:{id:result.profile.id,name:result.profile.name,email:'test@example.test'},session:{id:'test',userId:result.profile.id,expiresAt:new Date(Date.now()+3600000).toISOString()}})}));}
  await p.goto('http://127.0.0.1:4174/?dev=0');
 }
 const [a,b,observer]=pages;
 await a.getByRole('button',{name:/Random Match/}).click();await a.locator('.online-code').waitFor();
 await a.getByRole('timer').filter({hasText:'Match starts in'}).waitFor();
 await b.getByRole('button',{name:/Random Match/}).click();await b.locator('.online-code').waitFor();
 assert.equal(await a.locator('.online-code').textContent(),await b.locator('.online-code').textContent());
 await a.waitForFunction(()=>document.querySelector('.online-countdown')?.textContent?.includes('Match starts in'));
 await observer.waitForFunction(()=>[...document.querySelectorAll('.action-card')].find(e=>e.textContent.includes('Random Match'))?.querySelector('.action-badge')?.textContent==='2');
 await a.screenshot({path:'/tmp/borderwars-random-lobby.png'});
 await b.getByRole('button',{name:'Leave',exact:true}).click();await a.getByRole('timer').filter({hasText:'Match starts in'}).waitFor();
 await b.getByRole('button',{name:'Join random match',exact:true}).click();
 await Promise.all([a,b].map(p=>p.waitForFunction(()=>window.__app?.online?.verifiedTick>=20,null,{timeout:120000})));
 for(const p of [a,b])assert.equal(await p.evaluate(()=>__app.online.halted),false);
 console.log('Random queue, live counts, roster, countdown continuity and synchronized match passed');
 for(const p of [a,b]){await p.getByRole('button',{name:'Surrender & leave',exact:true}).click();await p.getByRole('button',{name:/Custom Match/}).waitFor();}
 await a.evaluate(recipe=>localStorage.setItem('borderwars.worlds.v1',JSON.stringify([{id:'test-islands',recipe,savedAt:Date.now()}])),{...DEFAULT_RECIPE,name:'Multiplayer Islands',resolution:512,countries:10,layout:'archipelago'});
 await a.getByRole('button',{name:/Custom Match/}).click();await a.getByRole('button',{name:'Create custom match',exact:true}).click();await a.getByLabel('Match world').selectOption('test-islands');await a.getByLabel('Gold income').selectOption('2');await a.getByRole('button',{name:'Create match',exact:true}).click();await a.locator('.online-code').waitFor({timeout:90000});
 await observer.waitForFunction(()=>[...document.querySelectorAll('.action-card')].find(e=>e.textContent.includes('Custom Match'))?.querySelector('.action-badge')?.textContent==='1');
 await b.getByRole('button',{name:/Custom Match/}).click();await b.locator('.online-room').filter({hasText:'Multiplayer Islands'}).click();
 for(const p of [a,b])await p.getByRole('button',{name:'Ready',exact:true}).click();
 await a.screenshot({path:'/tmp/borderwars-custom-lobby.png'});await a.getByRole('button',{name:'Start match',exact:true}).click();await a.waitForFunction(()=>document.querySelector('.online-countdown')?.textContent?.includes('Match starts in'));
 await Promise.all([a,b].map(p=>p.waitForFunction(()=>window.__app?.online?.verifiedTick>=20,null,{timeout:120000})));
 for(const p of [a,b]){assert.equal(await p.evaluate(()=>__app.online.halted),false);assert.equal(await p.evaluate(()=>__game.map.generated.name),'Multiplayer Islands');assert.equal(await p.evaluate(()=>__game.config.settings.goldMultiplier),2);}
 await a.screenshot({path:'/tmp/borderwars-custom-online.png'});
 console.log('Saved-world custom match listing, counts, settings, shared map and synchronized play passed');
 for(const p of [a,b])await p.getByRole('button',{name:'Surrender & leave',exact:true}).click();
 assert.deepEqual(errors,[]);console.log('Browser errors:',errors);
}finally{
 await browser.close();
 for(const id of ids){await store.query('DELETE FROM sessions WHERE account_id=$1',[id]);await store.query('DELETE FROM cosmetics WHERE account_id=$1',[id]);await store.query('DELETE FROM results WHERE account_id=$1',[id]);await store.query('DELETE FROM accounts WHERE id=$1',[id]);}
 await store.close();
}

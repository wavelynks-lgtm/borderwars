import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
const errors=[];
try{
 const contexts=await Promise.all([browser.newContext(),browser.newContext()]);const pages=await Promise.all(contexts.map(c=>c.newPage()));
 const suffix=Date.now().toString(36);
 for(let i=0;i<2;i++){
  const p=pages[i];p.on('pageerror',e=>errors.push(e.message));await p.goto('http://127.0.0.1:4174/?dev=0');
  await p.getByRole('button',{name:/Custom Match/}).click();
  await p.getByRole('textbox',{name:'Commander name',exact:true}).fill('Player'+i+'_'+suffix);
  await p.getByRole('textbox',{name:'Password',exact:true}).fill('Browser check password 123');
  await p.getByRole('button',{name:'Create account',exact:true}).click();
  await p.getByRole('button',{name:'Create custom match',exact:true}).waitFor();
 }
 await pages[0].getByRole('button',{name:'Create custom match',exact:true}).click();
 await pages[0].getByRole('button',{name:'Create match',exact:true}).click();
 const code=await pages[0].locator('.online-code').textContent();
 await pages[1].getByRole('textbox',{name:'Room code',exact:true}).fill(code);await pages[1].getByRole('button',{name:'Join by code',exact:true}).click();
 for(const p of pages)await p.getByRole('button',{name:'Ready',exact:true}).click();
 await pages[0].screenshot({path:'/tmp/borderwars-online-lobby.png'});
 await pages[0].getByRole('button',{name:'Start match',exact:true}).click();
 await Promise.all(pages.map(p=>p.waitForFunction(()=>window.__game?.ticks>=180,null,{timeout:120000})));
 for(const p of pages){console.log('Client',await p.evaluate(()=>({tick:__game.ticks,verified:__app.online.verifiedTick,name:__game.human.name,halted:__app.online.halted,status:__app.online.status})));assert.equal(await p.evaluate(()=>__app.online.halted),false);}
 await pages[1].evaluate(()=>__app.setRatio('troopRatio',.4));
 await Promise.all(pages.map(p=>p.waitForFunction(()=>__game.allPlayers().find(p=>p.name.startsWith('Player1_')).targetTroopRatio===.4)));
 // Send a real attack after recruitment, then verify the server keeps both clients in sync.
 await pages[0].evaluate(()=>{const g=__game,p=g.human;for(const t of p.borderTiles){const ns=[];g.map.neighbors4(t,ns);for(const n of ns){if(g.map.isLand(n)&&g.map.owner[n]===0){__app.doAttack(n);return;}}}});
 await Promise.all(pages.map(p=>p.waitForFunction(()=>__app.online.verifiedTick>=220)));
 await pages[0].screenshot({path:'/tmp/borderwars-online-match.png'});
 await pages[1].reload();await pages[1].getByRole('button',{name:/Custom Match/}).click();
 await pages[1].waitForFunction(()=>window.__app?.online?.verifiedTick>=230,null,{timeout:120000});
 assert.equal(await pages[1].evaluate(()=>__app.online.halted),false);
 console.log('Reconnected',await pages[1].evaluate(()=>({tick:__game.ticks,verified:__app.online.verifiedTick,players:__game.allPlayers().length})));
 for(const p of pages){await p.getByRole('button',{name:'Surrender & leave',exact:true}).click();await p.getByRole('button',{name:/Custom Match/}).waitFor();}
 await pages[1].getByRole('button',{name:/Custom Match/}).click();await pages[1].getByRole('button',{name:'Create custom match',exact:true}).waitFor();
 assert.deepEqual(errors,[]);console.log('Surrender returned to lobby; browser errors',errors);
}finally{await browser.close();}

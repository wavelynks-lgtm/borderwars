import test from 'node:test';
import assert from 'node:assert/strict';
import {GameMap} from '../src/core/GameMap.ts';
import {DEFAULT_SETTINGS,TerrainType,UnitType} from '../src/core/types.ts';
import {createOnlineGame} from '../src/multiplayer/setup.ts';
import {applyCommand,stateDigest,validCommand} from '../src/multiplayer/protocol.ts';
import {Store} from '../server/store.mjs';
import {Room} from '../server/room.ts';
const map=()=>new GameMap(256,128,new Uint8Array(256*128).fill(TerrainType.Plains),new Uint16Array(256*128),[]);
const members=()=>[{id:'a',name:'Alpha',color:'#ff4d6d',playerId:0,ready:true,connected:true},{id:'b',name:'Beta',color:'#55b8ff',playerId:0,ready:true,connected:true}];
const settings={...DEFAULT_SETTINGS,numNations:0,numBots:2,randomSpawn:true,spawnPhaseSeconds:1};
test('two local perspectives and a server stay deterministic through recruitment, orders, buildings and replay',async()=>{
 const a=await createOnlineGame(map(),settings,members(),'a'),b=await createOnlineGame(map(),settings,members(),'b'),replay=await createOnlineGame(map(),settings,members(),'a');
 const log=[];
 for(let i=0;i<700;i++){
  const commands=[];
  if(i===15)commands.push([1,{kind:'troopRatio',value:.5}]);
  if(i===150){const p=a.player(1);const ns=[];a.map.neighbors4([...p.borderTiles][0],ns);const t=ns.find(t=>a.map.owner[t]===0);if(t!==undefined)commands.push([1,{kind:'attack',tile:t,value:.5}]);}
  if(i===400)commands.push([members()[1].playerId||4,{kind:'attackRatio',value:.3}]);
  for(const [p,c] of commands){const e=applyCommand(a,p,c);assert.equal(applyCommand(b,p,c),e);if(!e)log.push({tick:i,p,c});}
  a.tick();b.tick();assert.equal(stateDigest(a),stateDigest(b),`tick ${i}`);
 }
 for(let i=0;i<700;i++){for(const x of log.filter(x=>x.tick===i))assert.equal(applyCommand(replay,x.p,x.c),null);replay.tick();}
 assert.equal(stateDigest(a),stateDigest(replay));
 const u=a.addUnit(UnitType.City,a.player(1),a.player(1).spawnTile),v=b.addUnit(UnitType.City,b.player(1),b.player(1).spawnTile);assert.equal(u.id,v.id);
});
test('network orders reject invalid quantities, internal units, cheats, and another player’s structures',async()=>{
 const g=await createOnlineGame(map(),settings,members(),'a');
 for(const c of [{kind:'attack',tile:NaN},{kind:'attack',tile:1,value:Infinity},{kind:'attack',tile:1,value:2},{kind:'build',tile:1,type:UnitType.MIRVWarhead},{kind:'gold',value:1e9},{kind:'salvo',type:UnitType.AtomBomb,tiles:Array(21).fill(1)}])assert.equal(validCommand(c),false);
 assert.ok(applyCommand(g,1,{kind:'attack',tile:1,value:1}));
 g.skipSpawnPhase();const p=g.player(1),other=g.allPlayers().find(p=>p.name==='Beta'),u=g.addUnit(UnitType.City,other,other.spawnTile);p.gold=1e9;
 assert.equal(applyCommand(g,p.smallID,{kind:'upgrade',id:u.id}),'Not your unit');assert.equal(u.level,1);
 assert.equal(applyCommand(g,p.smallID,{kind:'build',type:UnitType.AtomBomb,tile:other.spawnTile}),'Requires a Missile Silo');
 assert.equal(applyCommand(g,999,{kind:'attackRatio',value:.5}),'Invalid player');
});
test('room waits for all loaded players, assigns authenticated identity, and replays missed frames',async()=>{
 const receivedA=[],receivedB=[];const r=new Room('test','a',false,map,'hash',async()=>{});
 r.join({id:'a',name:'Alpha',connected:true,send:m=>receivedA.push(m)});r.join({id:'b',name:'Beta',connected:true,send:m=>receivedB.push(m)});
 await assert.rejects(()=>r.start('b'),/host/);await assert.rejects(()=>r.start('a'),/ready/);
 r.setReady('a',true);r.setReady('b',true);await r.start('a');r.tick();assert.equal(r.game.ticks,0);
 r.loaded('a',0);r.tick();assert.equal(r.game.ticks,0);r.loaded('b',0);r.tick();assert.equal(r.game.ticks,1);
 r.enqueue('b',{kind:'troopRatio',value:.25});r.tick();assert.equal(r.game.player(r.members[1].playerId).targetTroopRatio,.25);assert.notEqual(r.game.player(r.members[0].playerId).targetTroopRatio,.25);
 r.leave('b');r.tick();r.join({id:'b',name:'Beta',connected:true,send:m=>receivedB.push(m)});r.loaded('b',1);
 assert.ok(receivedB.some(m=>m.type==='frames'&&m.frames[0]?.tick===1&&m.frames.length===2));
});
test('accounts hash passwords and tokens; completed results are idempotent and private games unranked',async()=>{
 const store=new Store(undefined,':memory:');await store.init();
 try{
  const a=await store.register('Alpha_123','correct horse battery'),b=await store.register('Beta_123','another long password');
  assert.equal((await store.auth(a.token)).name,'Alpha_123');await assert.rejects(()=>store.login('Alpha_123','wrong'),/Invalid/);
  await assert.rejects(()=>store.register('alpha_123','correct horse battery'),/taken/);
  const row=(await store.query('SELECT password FROM accounts WHERE id=$1',[a.profile.id])).rows[0];assert.ok(!row.password.includes('correct'));
  const results=[{id:a.profile.id,land:100},{id:b.profile.id,land:50}];
  await store.finish('one',a.profile.id,600,true,results);await store.finish('one',a.profile.id,600,true,results);
  await store.finish('private',b.profile.id,600,false,results);
  const board=await store.leaderboard();assert.equal(board[0].name,'Alpha_123');assert.equal(Number(board[0].wins),1);assert.equal(Number(board[0].games),1);
  assert.equal((await store.history(a.profile.id)).length,2);await store.logout(a.token);assert.equal(await store.auth(a.token),null);
 }finally{await store.close();}
});
test('result transaction rolls back incomplete awards and local accounts survive a restart',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const dir=await mkdtemp(join(tmpdir(),'bw-store-'));let store=new Store(undefined,join(dir,'state.sqlite'));
 try{
  await store.init();const a=await store.register('Persisted','a memorable long password');
  await assert.rejects(()=>store.finish('broken',a.profile.id,600,true,[{id:a.profile.id,land:100},{id:'nonexistent-account',land:10}]));
  assert.deepEqual(await store.leaderboard(),[]);assert.deepEqual(await store.history(a.profile.id),[]);
  await store.close();store=new Store(undefined,join(dir,'state.sqlite'));await store.init();assert.equal((await store.auth(a.token)).id,a.profile.id);
  assert.equal((await store.login('persisted','a memorable long password')).profile.id,a.profile.id);
 }finally{await store.close();await rm(dir,{recursive:true,force:true});}
});
test('a reconnect receives no live ticks until its replay is requested',async()=>{
 const out=[];const r=new Room('reconnect','a',false,map,'hash',async()=>{});
 for(const id of ['a','b']){r.join({id,name:id,connected:true,send:m=>{if(id==='b')out.push(m);}});r.setReady(id,true);}
 await r.start('a');r.loaded('a',0);r.loaded('b',0);r.tick();r.leave('b');
 r.join({id:'b',name:'b',connected:true,send:m=>out.push(m)});out.length=0;r.tick();assert.equal(out.filter(m=>m.type==='frames').length,0);
 r.loaded('b',0);assert.equal(out.find(m=>m.type==='frames').frames.length,2);
});

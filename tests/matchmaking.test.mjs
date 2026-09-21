import test from 'node:test';
import assert from 'node:assert/strict';
import {customMatch,randomMatch,RANDOM_PRESETS} from '../src/multiplayer/matchmaking.ts';
import {DEFAULT_RECIPE,generateWorld} from '../src/map/generator.ts';
import {Room} from '../server/room.ts';
import {GameMap} from '../src/core/GameMap.ts';
import {decodeMap} from '../src/multiplayer/map.ts';
const map=()=>new GameMap(256,128,new Uint8Array(256*128).fill(1),new Uint16Array(256*128),[]);
const peer=id=>({id,name:id,connected:true,send:()=>{}});
test('random lobbies count down only with two players, reset on departure and transfer host',async()=>{
 const r=new Room('queue','a',false,map,'hash',async()=>{});r.kind='random';r.settings=randomMatch(4).settings;
 r.join(peer('a'));assert.equal(r.countdownAt,0);r.join(peer('b'));assert.ok(r.countdownAt-Date.now()>55000);assert.ok(r.members.every(m=>m.ready));
 r.leave('a');assert.equal(r.host,'b');assert.equal(r.countdownAt,0);r.join(peer('c'));assert.ok(r.countdownAt>Date.now());
 r.countdownAt=Date.now()-1;r.tick();await new Promise(resolve=>setTimeout(resolve,30));assert.equal(r.phase,'loading');assert.equal(r.game.ticks,0);
 r.loaded('b',0);r.tick();assert.equal(r.game.ticks,0);r.loaded('c',0);r.tick();assert.equal(r.game.ticks,1);
});
test('random presets vary but never enable cheats; custom settings are bounded and server-owned',()=>{
 assert.equal(new Set(RANDOM_PRESETS.map((_,i)=>randomMatch(i).name)).size,RANDOM_PRESETS.length);
 for(let i=0;i<10;i++){const s=randomMatch(i).settings;assert.equal(s.devMode,false);assert.equal(s.infiniteGold,false);assert.equal(s.infiniteTroops,false);assert.equal(s.startingGold,0);}
 const c=customMatch({name:'Isles',numBots:3,goldMultiplier:2,devMode:true,infiniteTroops:true,customWorld:{...DEFAULT_RECIPE,resolution:512}});
 assert.equal(c.settings.numBots,3);assert.equal(c.settings.devMode,false);assert.equal(c.settings.infiniteTroops,false);assert.equal(c.recipe.resolution,512);
 for(const input of [{numBots:1000},{numNations:NaN},{goldMultiplier:0},{disableNukes:'false'},{customWorld:{...DEFAULT_RECIPE,resolution:4096}}])assert.throws(()=>customMatch(input));
});
test('shared custom maps retain terrain, borders and palette metadata after transmission',()=>{
 const m=generateWorld({...DEFAULT_RECIPE,resolution:512,countries:8});
 const meta=Buffer.from(JSON.stringify({width:m.width,height:m.height,countries:m.countries,generated:m.generated})),head=Buffer.alloc(4);head.writeUInt32LE(meta.length);
 const buffer=Buffer.concat([head,meta,Buffer.from(m.terrain),Buffer.from(m.country.buffer),Buffer.from(m.elevation)]);
 const out=decodeMap(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength));
 assert.deepEqual(out.generated,m.generated);assert.deepEqual(out.country,m.country);assert.deepEqual(out.terrain,m.terrain);assert.deepEqual(out.elevation,m.elevation);
});
test('custom host countdown requires readiness and cancels when someone unreadies or joins',()=>{
 const r=new Room('custom','a',false,map,'hash',async()=>{});r.join(peer('a'));r.join(peer('b'));
 assert.throws(()=>r.requestStart('a'),/ready/);r.setReady('a',true);r.setReady('b',true);assert.throws(()=>r.requestStart('b'),/host/);
 r.requestStart('a');assert.ok(r.countdownAt>Date.now());r.setReady('b',false);assert.equal(r.countdownAt,0);
 r.setReady('b',true);r.requestStart('a');r.join(peer('c'));assert.equal(r.countdownAt,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {GameMap} from '../src/core/GameMap.ts';
import {createGame} from '../src/app/setup.ts';
import {prepareMatch} from '../src/app/prepareMatch.ts';
import {DEFAULT_SETTINGS,TerrainType,PlayerType} from '../src/core/types.ts';
function game(devMode=false){return createGame(new GameMap(512,256,new Uint8Array(512*256).fill(TerrainType.Plains),new Uint16Array(512*256),[]),{...DEFAULT_SETTINGS,numNations:0,numBots:16,spawnPhaseSeconds:20,randomSpawn:false,devMode});}
test('startup places all AI and initializes executions without consuming countdown or human placement',async()=>{
 const g=game();let yields=0;
 await prepareMatch(g,()=>{},async()=>{yields++;assert.equal(g.ticks,0);});
 assert.ok(yields>=4);assert.equal(g.ticks,0);assert.equal(g.spawnPhaseTicksLeft(),200);
 assert.equal(g.human.hasSpawned,false);
 assert.ok(g.allPlayers().filter(p=>p.type!==PlayerType.Human).every(p=>p.hasSpawned&&p.alive));
 assert.equal(g.pendingExecutions.length,0);
 const initial=g.allPlayers().map(p=>p.spawnTile);
 g.tick();assert.deepEqual(g.allPlayers().map(p=>p.spawnTile),initial);
});
test('startup failure cannot silently start a match with an unplaced roster',async()=>{
 const g=game();g.randomSpawnTile=()=>-1;
 await assert.rejects(()=>prepareMatch(g,()=>{},async()=>{}),/No starting position/);
 assert.equal(g.ticks,0);
});

test('human, nations and bots start empty, stay empty during countdown, then grow from zero',()=>{
 for(const devMode of [false,true]){
  const g=game(devMode);
  const nation=g.addPlayer('Nation',PlayerType.Nation,'#ff0000');
  g.spawnPlayer(g.human,g.map.ref(100,100));
  g.spawnPlayer(nation,g.map.ref(300,100));
  for(const p of g.allPlayers()){assert.equal(p.troops,0);assert.equal(p.workers,0);}
  g.tick();
  for(const p of g.allPlayers())assert.equal(p.population,0);
  g.skipSpawnPhase();g.tick();
  for(const p of g.allPlayers()){
   assert.ok(p.troops>0,`${p.name} should recruit from zero`);
   assert.ok(p.workers>0,`${p.name} should grow workers from zero`);
   assert.ok(p.population<20,'first growth must be incremental');
  }
 }
});

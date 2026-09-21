import test from 'node:test';
import assert from 'node:assert/strict';
import {GameMap} from '../src/core/GameMap.ts';
import {createGame} from '../src/app/setup.ts';
import {prepareMatch} from '../src/app/prepareMatch.ts';
import {DEFAULT_SETTINGS,TerrainType,PlayerType} from '../src/core/types.ts';
import {AI_COLORS} from '../src/core/ai/aiNames.ts';
function game(devMode=false){return createGame(new GameMap(512,256,new Uint8Array(512*256).fill(TerrainType.Plains),new Uint16Array(512*256),[]),{...DEFAULT_SETTINGS,numNations:0,numBots:16,spawnPhaseSeconds:20,randomSpawn:false,devMode});}
const aiOf=g=>g.allPlayers().filter(p=>p.type!==PlayerType.Human);
test('startup warms AI without placing them or consuming countdown',async()=>{
 const g=game();
 await prepareMatch(g,()=>{},async()=>{});
 assert.equal(g.ticks,0);assert.equal(g.spawnPhaseTicksLeft(),200);
 assert.equal(g.human.hasSpawned,false);
 assert.ok(aiOf(g).every(p=>!p.hasSpawned));
 assert.equal(g.pendingExecutions.length,0);
});
test('AI claim land during the spawn countdown',async()=>{
 const g=game();
 await prepareMatch(g,()=>{},async()=>{});
 let seenDuring=0;
 while(g.inSpawnPhase()){
  g.tick();
  seenDuring=Math.max(seenDuring,aiOf(g).filter(p=>p.hasSpawned).length);
 }
 assert.ok(seenDuring>0,'AI should appear before the countdown ends');
 assert.ok(aiOf(g).every(p=>p.hasSpawned&&p.alive));
 assert.equal(g.human.hasSpawned,false);
});
test('missing spawn tiles leave AI unplaced rather than starting the match',async()=>{
 const g=game();g.randomSpawnTile=()=>-1;
 await prepareMatch(g,()=>{},async()=>{});
 assert.equal(g.ticks,0);
 g.skipSpawnPhase();
 assert.ok(aiOf(g).every(p=>!p.hasSpawned));
});

test('human and AI start empty, stay empty during countdown, then grow from zero',()=>{
 for(const devMode of [false,true]){
  const g=game(devMode);
  const other=g.addPlayer('Rival',PlayerType.Nation,'#ff0000');
  g.spawnPlayer(g.human,g.map.ref(100,100));
  g.spawnPlayer(other,g.map.ref(300,100));
  for(const p of g.allPlayers().filter(p=>p.hasSpawned)){assert.equal(p.troops,0);assert.equal(p.workers,0);}
  g.tick();
  for(const p of g.allPlayers().filter(p=>p.hasSpawned))assert.equal(p.population,0);
  g.skipSpawnPhase();g.tick();
  for(const p of g.allPlayers().filter(p=>p.hasSpawned)){
   assert.ok(p.troops>0,`${p.name} should recruit from zero`);
   assert.ok(p.workers>0,`${p.name} should grow workers from zero`);
   assert.ok(p.population<20,'first growth must be incremental');
  }
 }
});
test('AI always uses steel-gray colors and unique joke names',()=>{
 const g=createGame(new GameMap(64,32,new Uint8Array(64*32).fill(TerrainType.Plains),new Uint16Array(64*32),[]),{...DEFAULT_SETTINGS,numNations:40,numBots:59,spawnPhaseSeconds:1});
 const ai=g.allPlayers().filter(p=>p.isAI());
 assert.equal(g.allPlayers().length,100);
 assert.equal(ai.length,99);
 assert.equal(new Set(ai.map(p=>p.name)).size,99);
 assert.ok(ai.every(p=>AI_COLORS.includes(p.color)));
 assert.ok(ai.every(p=>p.type===PlayerType.Nation));
});

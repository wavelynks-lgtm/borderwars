import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { GameMap } from '../src/core/GameMap.ts';
import { Game } from '../src/core/Game.ts';
import { Config } from '../src/core/Config.ts';
import { AttackExecution } from '../src/core/executions/AttackExecution.ts';
import { TransportShipExecution } from '../src/core/executions/TransportShipExecution.ts';
import { NukeExecution } from '../src/core/executions/NukeExecution.ts';
import { WaterPathfinder } from '../src/core/WaterPathfinder.ts';
import { queueMissiles, attackTile, build, upgradeUnit } from '../src/core/actions.ts';
import { DEFAULT_SETTINGS, TerrainType as T, PlayerType as P, UnitType as U } from '../src/core/types.ts';
import { ballisticPoint } from '../src/map/ballistic.ts';
import { GLOBE_RADIUS } from '../src/map/geo.ts';

function world(w = 128, h = 64, terrain = T.Plains, settings = {}) {
  const map = new GameMap(w, h, new Uint8Array(w*h).fill(terrain), new Uint16Array(w*h), []);
  const game = new Game(map, {...DEFAULT_SETTINGS, spawnPhaseSeconds: 0, winPercent: 101, ...settings});
  game.ticks = 100;
  // Small test fixtures should have representative 4K economic/timing constants.
  game.config = new Config(game.config.settings, 2, 652000);
  return {map, game};
}
function player(game, tile, type = P.Human) {
  const p = game.addPlayer(`Player ${game.players.length}`, type, '#ff3344');
  p.hasSpawned = true; p.spawnedAt = 0; p.troops = 100000; p.workers = 0;
  game.conquer(p, tile);
  return p;
}
function close(a,b,eps=1e-8) { assert.ok(Math.abs(a-b) <= eps, `${a} != ${b}`); }

test('invalid tile references are never land or navigable', () => {
  const {map} = world();
  for (const t of [-1, NaN, Infinity, 1.5, map.width * map.height]) {
    assert.equal(map.isLand(t), false); assert.equal(map.isPassable(t), false);
  }
});
test('surface area ownership remains consistent after captures, relinquishing and sinking', () => {
  const {map,game}=world(); const t=map.ref(30,32), polar=map.ref(30,3);
  const a=player(game,t), b=player(game,polar);
  assert.ok(game.landPercent(a)>game.landPercent(b)*4);
  const before=map.landArea;
  game.conquer(b,t); close(a.landArea,0); close(b.landArea,map.tileArea(t)+map.tileArea(polar));
  game.relinquish(polar); close(b.landArea,map.tileArea(t));
  game.sinkTile(t); close(b.landArea,0); close(map.landArea,before-map.tileArea(t));
});
test('population capacity includes workers and survives worker-heavy allocations', () => {
  const cfg=new Config({...DEFAULT_SETTINGS});
  const p={type:P.Human,numTiles:100,landArea:100,cityLevels:0,troops:1000,workers:0,population:0};
  const max=cfg.maxPopulation(p); p.workers=max-p.troops; p.population=max;
  assert.equal(cfg.populationIncrease(p),0);
  p.population=max*1.1; assert.equal(cfg.populationIncrease(p),0);
  p.population=max*0.5; assert.ok(cfg.populationIncrease(p)>0);
});
test('attacks cannot bridge diagonal water gaps', () => {
  const {map,game}=world(128,64,T.Water); const start=map.ref(50,32), diagonal=map.ref(51,33);
  map.terrain[start]=T.Plains; map.terrain[diagonal]=T.Plains;
  const p=player(game,start); const troops=p.troops;
  const a=new AttackExecution(1000,p,null,start); a.init(game);
  for(let i=0;i<30;i++) a.tick();
  assert.equal(map.owner[diagonal],0); assert.equal(p.troops,troops);
});
test('slow fronts accumulate time instead of receiving a free conquest each tick', () => {
  const {map,game}=world(); const start=map.ref(50,32); const p=player(game,start);
  game.config.attackLogic=()=>({attackerTroopLoss:1,defenderTroopLoss:0,tickFraction:5});
  const a=new AttackExecution(1000,p,null,map.ref(51,32)); a.init(game);
  for(let i=0;i<4;i++) a.tick(); assert.equal(p.numTiles,1);
  a.tick(); assert.equal(p.numTiles,2);
});
test('an army cannot buy a tile it cannot afford', () => {
  const {map,game}=world(); const p=player(game,map.ref(50,32)); const before=p.troops;
  game.config.attackLogic=()=>({attackerTroopLoss:100,defenderTroopLoss:0,tickFraction:0.1});
  const a=new AttackExecution(10,p,null,map.ref(51,32)); a.init(game); a.tick();
  assert.equal(p.numTiles,1); assert.equal(p.troops,before); assert.equal(a.isActive(),false);
});
test('fresh small countries are not annexed after losing one tile', () => {
  const {map,game}=world(); const a=player(game,map.ref(50,32)), b=player(game,map.ref(51,32),P.Nation);
  for(let x=52;x<60;x++) game.conquer(b,map.ref(x,32));
  game.config.attackLogic=()=>({attackerTroopLoss:1,defenderTroopLoss:0,tickFraction:1});
  const attack=new AttackExecution(1000,a,b,map.ref(51,32)); attack.init(game); attack.tick(); attack.tick();
  assert.equal(b.numTiles,8);
});
test('attacks on separate neutral countries do not silently merge', () => {
  const {map,game}=world(); const p=player(game,map.ref(50,32));
  const left=map.ref(49,32),right=map.ref(51,32);map.country[left]=1;map.country[right]=2;
  const a=new AttackExecution(100,p,null,left),b=new AttackExecution(100,p,null,right);
  a.init(game);b.init(game); assert.equal(p.outgoingAttacks.length,2);
});
test('crossing the antimeridian remains a connected land attack', () => {
  const {map,game}=world(); const p=player(game,map.ref(0,32));
  game.config.attackLogic=()=>({attackerTroopLoss:1,defenderTroopLoss:0,tickFraction:1});
  map.country[map.ref(127,32)]=1; // isolate the seam crossing from competing fronts
  const a=new AttackExecution(100,p,null,map.ref(127,32));a.init(game);
  assert.ok(a.frontTiles().has(map.ref(127,32)));
  for(let i=0;i<20;i++)a.tick();
  assert.equal(map.owner[map.ref(127,32)],p.smallID);
});
test('attack randomness is repeatable across matches in one process', () => {
  function run() { const {map,game}=world(); const p=player(game,map.ref(50,32));
    const a=new AttackExecution(1000,p,null,map.ref(51,32));a.init(game);
    for(let i=0;i<80;i++) {a.tick();game.ticks++;} return [...p.tiles]; }
  assert.deepEqual(run(),run());
});
test('resolution scaling preserves nominal physical front speed and building ranges', () => {
  const settings={...DEFAULT_SETTINGS};
  const input={terrain:T.Plains, attackTroops:100000, attacker:{type:P.Human,numTiles:1000},defender:null,defenderHasDefensePost:false,falloutRatio:null,borderSize:100,landTiles:1000};
  const a=new Config(settings,1,652000),b=new Config(settings,2,652000*4);
  const t1=a.attackLogic(input).tickFraction;
  const t2=b.attackLogic({...input,borderSize:200,attacker:{...input.attacker,numTiles:4000}}).tickFraction;
  close(t1/t2,4); assert.ok(Math.abs(b.trainStationMaxRange()-2*a.trainStationMaxRange())<=1);
});
test('great-circle distance and antipodal missile arcs stay on the globe', () => {
  const {map}=world(360,180); const a=map.latLonToTile(0,0), b=map.latLonToTile(0,180);
  assert.ok(map.surfaceDistance(a,b)>178);
  assert.ok(map.surfaceDistance(map.latLonToTile(80,0),map.latLonToTile(80,90))<20);
  for(let i=0;i<=100;i++) { const p=ballisticPoint(0,0,0,180,i/100,10,new Vector3());
    assert.ok(Number.isFinite(p.length()) && p.length()>=GLOBE_RADIUS+1); }
});
test('coarse sea routes cannot clip a one-pixel continent', () => {
  const {map}=world(2048,32,T.Water);
  // Ring of land separates two seas. Centres of coarse cells are still water.
  for(let x=0;x<map.width;x++) map.terrain[map.ref(x,15)]=T.Plains;
  const pf=new WaterPathfinder(map);
  assert.equal(pf.findPath(map.ref(50,10),map.ref(50,20),2000),null);
  assert.ok(pf.findPath(map.ref(2046,10),map.ref(2,10)));
});
test('queued boat launches respect the boat cap at execution time', () => {
  const {map,game}=world(128,64,T.Water); const src=map.ref(50,32),dst=map.ref(60,32);
  map.terrain[src]=map.terrain[dst]=T.Plains;const p=player(game,src);
  for(let i=0;i<6;i++) new TransportShipExecution(p,src,dst,100,[src,dst]).init(game);
  assert.equal(p.unitCount(U.TransportShip),3);assert.equal(p.troops,99700);
});
test('completed silos are reserved immediately and free upgrades work', () => {
  const {map,game}=world(128,64,T.Plains,{instantBuild:true,infiniteGold:true});
  const p=player(game,map.ref(50,32)); const silo=game.addUnit(U.MissileSilo,p,map.ref(50,32));
  assert.equal(build(game,p,U.AtomBomb,map.ref(51,32)).ok,true);
  assert.equal(build(game,p,U.AtomBomb,map.ref(51,32)).ok,false);
  assert.ok(silo.cooldownUntil>game.ticks);
  const city=game.addUnit(U.City,p,map.ref(50,32));assert.equal(upgradeUnit(game,p,city).ok,true);assert.equal(city.level,2);
});
test('nukes create fallout or water according to match settings', () => {
  for(const waterNukes of [false,true]) {
    const {map,game}=world(128,64,T.Plains,{instantBuild:true,waterNukes});
    const target=map.ref(50,32);const p=player(game,map.ref(45,32));
    const silo=game.addUnit(U.MissileSilo,p,map.ref(45,32));
    const nuke=new NukeExecution(p,U.AtomBomb,silo,target);nuke.init(game);
    for(let i=0;i<300;i++) nuke.tick();
    assert.equal(map.isWater(target),waterNukes);assert.equal(map.hasFallout(target),!waterNukes);
  }
});
test('boats can navigate a narrow strait missed by coarse map centres',()=>{
  const {map}=world(2048,32,T.Plains);
  for(let x=30;x<=60;x++)map.terrain[map.ref(x,9)]=T.Water;
  const path=new WaterPathfinder(map).findPath(map.ref(30,9),map.ref(60,9),1000);
  assert.ok(path);assert.ok(path.every(t=>map.isWater(t)));
});
test('polar expansion compensates for the smaller longitude pixels',()=>{
  const {map,game}=world(512,256);const start=map.latLonToTile(60,0);const p=player(game,start);
  game.config.attackLogic=()=>({attackerTroopLoss:.01,defenderTroopLoss:0,tickFraction:.01});
  const a=new AttackExecution(10000,p,null,start);a.init(game);
  for(let i=0;i<70;i++){a.tick();game.ticks++;}
  const xs=[...p.tiles].map(t=>map.x(t)),ys=[...p.tiles].map(t=>map.y(t));
  const width=Math.max(...xs)-Math.min(...xs),height=Math.max(...ys)-Math.min(...ys);
  assert.ok(width>height*1.5,`longitude span ${width}, latitude span ${height}`);
});
test('combat troop costs scale with pixel area rather than texture resolution',()=>{
  const settings={...DEFAULT_SETTINGS};
  const input={terrain:T.Plains,attackTroops:100000,attacker:{type:P.Human,numTiles:1000},defender:{type:P.Nation,numTiles:2000,troops:150000,isTraitor:false},defenderHasDefensePost:false,falloutRatio:null,borderSize:100,landTiles:2000};
  const a=new Config(settings,1,652000).attackLogic(input);
  const b=new Config(settings,2,652000*4).attackLogic({...input,borderSize:200,attacker:{...input.attacker,numTiles:4000},defender:{...input.defender,numTiles:8000}});
  close(a.attackerTroopLoss,b.attackerTroopLoss*4);close(a.defenderTroopLoss,b.defenderTroopLoss*4);close(a.tickFraction,b.tickFraction*4);
});
test('very slow attacks can accumulate more than 100 ticks of movement credit',()=>{
  const {map,game}=world();const p=player(game,map.ref(50,32));
  game.config.attackLogic=()=>({attackerTroopLoss:1,defenderTroopLoss:0,tickFraction:150});
  const a=new AttackExecution(1000,p,null,map.ref(51,32));a.init(game);
  for(let i=0;i<151;i++)a.tick();assert.ok(p.numTiles>1);
});
test('workforce slider trades available troops for bounded gold income',()=>{
  const cfg=new Config({...DEFAULT_SETTINGS,infiniteGold:false,goldMultiplier:1});
  const p={type:P.Human,numTiles:100,cityLevels:0,population:100000,troops:60000,workers:40000};
  close(cfg.goldPerTick(p),100);
  assert.ok(cfg.goldPerTick({...p,troops:20000,workers:80000})>100);
  close(cfg.goldPerTick({...p,troops:100000,workers:0}),25);
  close(cfg.goldPerTick({...p,troops:0,workers:100000}),175);
});

test('natural fronts favor open plains over a mountain flank and vary with match seed', () => {
  function run(seed, mountains = true) {
    const {map,game}=world(512,256,T.Plains,{seed}); const cx=256,cy=128;
    if(mountains) for(let y=0;y<256;y++)for(let x=cx+2;x<512;x++)map.terrain[map.ref(x,y)]=T.Mountain;
    const p=player(game,map.ref(cx,cy));
    game.config.attackLogic=()=>({attackerTroopLoss:0,defenderTroopLoss:0,tickFraction:1});
    const a=new AttackExecution(10000,p,null,map.ref(cx+1,cy));a.init(game);
    for(let i=0;i<1800;i++){a.tick();game.ticks++;}
    let east=0;
    for(const t of p.tiles)if(map.x(t)>cx+2)east++;
    return {east,tiles:[...p.tiles].sort((a,b)=>a-b)};
  }
  for(const seed of [123,456]) {
    const rugged=run(seed), flat=run(seed,false);
    assert.ok(rugged.east < flat.east*.85, `mountain flank ${rugged.east}, same flank without mountains ${flat.east}`);
  }
  assert.notDeepEqual(run(123).tiles,run(456).tiles);
});

test('uniform terrain develops uneven lobes instead of a prescribed circle',()=>{
  const {map,game}=world(2048,1024,T.Plains,{seed:123});
  const cx=1000,cy=512,p=player(game,map.ref(cx,cy));
  game.config.attackLogic=()=>({attackerTroopLoss:0,defenderTroopLoss:0,tickFraction:1});
  const attack=new AttackExecution(10000,p,null,map.ref(cx+1,cy));attack.init(game);
  for(let i=0;i<2500;i++){attack.tick();game.ticks++;}
  const radii=Array(16).fill(0);
  for(const t of p.tiles) {
    const dx=map.x(t)-cx,dy=map.y(t)-cy;
    const sector=Math.round((Math.atan2(dy,dx)+2*Math.PI)/(2*Math.PI)*16)%16;
    radii[sector]=Math.max(radii[sector],Math.hypot(dx,dy));
  }
  assert.ok(Math.max(...radii)>Math.min(...radii)*1.2,`too uniform: ${radii}`);
});

test('land invasions activate every shared border and ignore base-country boundaries',()=>{
  const {map,game}=world();
  const a=player(game,map.ref(30,30)),b=player(game,map.ref(31,30),P.Nation);
  game.conquer(a,map.ref(30,42));game.conquer(b,map.ref(31,42));
  map.country[map.ref(31,30)]=1;map.country[map.ref(31,42)]=2;
  const attack=new AttackExecution(1000,a,b,map.ref(31,30));attack.init(game);
  assert.equal(attack.countryId,0);
  assert.ok(attack.frontTiles().has(map.ref(31,30)));
  assert.ok(attack.frontTiles().has(map.ref(31,42)));
  game.config.attackLogic=()=>({attackerTroopLoss:1,defenderTroopLoss:0,tickFraction:1});
  for(let i=0;i<40&&attack.isActive();i++){attack.tick();game.ticks++;}
  assert.equal(map.owner[map.ref(31,30)],a.smallID);
  assert.equal(map.owner[map.ref(31,42)],a.smallID);
});
test('naval invasions stay at their beachhead even with an existing enemy border elsewhere',()=>{
  const {map,game}=world();
  const a=player(game,map.ref(30,30)),b=player(game,map.ref(31,30),P.Nation);
  const beach=map.ref(80,40);game.conquer(a,beach);game.conquer(b,map.ref(81,40));
  const attack=new AttackExecution(1000,a,b,beach,false,true);attack.init(game);
  assert.ok(attack.frontTiles().has(map.ref(81,40)));
  assert.equal(attack.frontTiles().has(map.ref(31,30)),false);
});
test('reinforcements stay one army across countries and include newly established fronts',()=>{
  const {map,game}=world();
  const a=player(game,map.ref(30,30)),b=player(game,map.ref(31,30),P.Nation);
  map.country[map.ref(31,30)]=1;
  const first=new AttackExecution(100,a,b,map.ref(31,30));first.init(game);
  game.conquer(a,map.ref(80,40));game.conquer(b,map.ref(81,40));map.country[map.ref(81,40)]=2;
  const second=new AttackExecution(200,a,b,map.ref(81,40));second.init(game);
  assert.equal(a.outgoingAttacks.length,1);assert.equal(first.troops(),300);
  assert.ok(first.frontTiles().has(map.ref(81,40)));
});

test('strong attacks spend their full movement budget without the old per-front capture cap',()=>{
 const {map,game}=world(512,256);const p=player(game,map.ref(256,128));
 game.config.attackLogic=()=>({attackerTroopLoss:1,defenderTroopLoss:0,tickFraction:.01});
 const before=p.landArea;
 const attack=new AttackExecution(10000,p,null,map.ref(257,128));attack.init(game);attack.tick();
 const takenArea=p.landArea-before;
 assert.ok(takenArea>99&&takenArea<=100+1e-8,`captured ${takenArea} surface tiles instead of spending 100`);
 close(attack.troops(),10000-takenArea);
});
test('a stronger army gains more ground than an outnumbered one with the real combat formula',()=>{
 const run=troops=>{
  const {map,game}=world(256,128);game.config=new Config(game.config.settings,1,652000);
  const a=player(game,map.ref(90,50)),b=player(game,map.ref(91,50),P.Nation);
  for(let y=45;y<85;y++){game.conquer(a,map.ref(90,y));for(let x=91;x<131;x++)game.conquer(b,map.ref(x,y));}
  b.troops=100000;
  const before=a.landArea,attack=new AttackExecution(troops,a,b);attack.init(game);
  for(let i=0;i<20;i++){attack.tick();game.ticks++;}
  return a.landArea-before;
 };
 const weak=run(10000),strong=run(100000);
 assert.ok(strong>weak*3,`weak ${weak}, strong ${strong}`);
});
test('polar frontier length uses physical edges, not the number of compressed longitude cells',()=>{
 const {map,game}=world(512,256);const y=25,p=player(game,map.ref(50,y)),q=player(game,map.ref(50,y+1),P.Nation);
 for(let x=51;x<90;x++){game.conquer(p,map.ref(x,y));game.conquer(q,map.ref(x,y+1));}
 const attack=new AttackExecution(10000,p,q);attack.init(game);
 close(attack.surfaceFrontLength(),40*map.tileArea(map.ref(50,y+1)));
});

test('boat launch attempts share a search budget instead of repeating twelve full searches',async()=>{
 const {sendBoat}=await import('../src/core/actions.ts');
 const {map,game}=world(128,64,T.Water);const p=player(game,map.ref(20,32));
 for(let x=20;x<40;x++){const t=map.ref(x,32);map.terrain[t]=T.Plains;game.conquer(p,t);}
 const dst=map.ref(90,32);map.terrain[dst]=T.Plains;
 game.shoreTiles=()=>Array.from({length:20},(_,i)=>map.ref(20+i,32));
 const budgets=[];
 game.waterPathfinder.findPath=(_a,_b,budget)=>{budgets.push(budget);game.waterPathfinder.lastSearchWork=budget;return null;};
 assert.equal(sendBoat(game,p,dst,100).ok,false);
 assert.deepEqual(budgets,[40000]);
});

// The globe intentionally uses slower enemy pacing than the upstream baseline.
test('enemy captures take twice as long without doubling casualty costs',()=>{
 const {map,game}=world(512,256);
 const a=player(game,map.ref(200,128)),b=player(game,map.ref(201,128),P.Nation);
 for(let x=202;x<240;x++)game.conquer(b,map.ref(x,128));
 game.config.attackLogic=()=>({attackerTroopLoss:10,defenderTroopLoss:0,tickFraction:1});
 const attack=new AttackExecution(10000,a,b);attack.init(game);
 const before=a.landArea;attack.tick();assert.equal(a.numTiles,1);
 attack.tick();assert.equal(a.numTiles,2);
 close(attack.troops(),10000-10*(a.landArea-before));
 attack.tick();assert.equal(a.numTiles,2);attack.tick();assert.equal(a.numTiles,3);
});

test('enemy invasion develops seeded uneven flanks on uniform terrain',()=>{
 const run=seed=>{
  const {map,game}=world(512,256,T.Plains,{seed});
  const a=player(game,map.ref(256,128)),b=player(game,map.ref(257,128),P.Nation);
  for(let y=80;y<177;y++)for(let x=208;x<305;x++)if(x!==256||y!==128)game.conquer(b,map.ref(x,y));
  game.config.attackLogic=()=>({attackerTroopLoss:0,defenderTroopLoss:0,tickFraction:1});
  const attack=new AttackExecution(10000,a,b);attack.init(game);
  for(let i=0;i<2000;i++){attack.tick();game.ticks++;}
  const radii=Array(16).fill(0);
  for(const t of a.tiles){const dx=map.x(t)-256,dy=map.y(t)-128;
   const sector=Math.round((Math.atan2(dy,dx)+2*Math.PI)/(2*Math.PI)*16)%16;
   radii[sector]=Math.max(radii[sector],Math.hypot(dx,dy));}
  assert.ok(Math.max(...radii)>Math.min(...radii)*1.2,`too circular: ${radii}`);
  return [...a.tiles];
 };
 assert.deepEqual(run(123),run(123));assert.notDeepEqual(run(123),run(456));
});

test('building over a matching icon upgrades one structure and uses the same price as the upgrade action',()=>{
 const {map,game}=world(512,256,T.Plains,{instantBuild:true});
 const tile=map.ref(200,128),p=player(game,tile);game.conquer(p,tile+1);p.gold=2e6;
 const city=game.addUnit(U.City,p,tile),before=p.gold,cost=game.config.upgradeCost(U.City,1);
 const maxBefore=game.config.maxPopulation(p);
 assert.equal(build(game,p,U.City,tile+1).ok,true);
 assert.equal(p.unitsOf(U.City).length,1);assert.equal(city.level,2);assert.equal(p.gold,before-cost);
 assert.ok(game.config.maxPopulation(p)>maxBefore);
 const price=game.config.upgradeCost(U.City,2);p.gold-=500000;const balance=p.gold;
 assert.equal(build(game,p,U.City,tile+1,true,500000).ok,true);
 assert.equal(p.gold,balance+500000-price);assert.equal(city.level,3);
});
test('upgrade snapping wraps and compensates for polar longitude compression',()=>{
 const {map,game}=world(512,256,T.Plains,{instantBuild:true});const p=player(game,map.ref(0,10));
 const city=game.addUnit(U.City,p,map.ref(0,10));
 assert.equal(game.stackTarget(p,U.City,map.ref(500,10)),city);
 assert.equal(game.stackTarget(p,U.City,map.ref(490,128)),undefined);
});
test('upgrades reject unfinished, maximum-level, and demolition-pending buildings without spending gold',()=>{
 const {map,game}=world(),tile=map.ref(50,32),p=player(game,tile);p.gold=1e7;
 const city=game.addUnit(U.City,p,tile),gold=p.gold;
 assert.equal(build(game,p,U.City,tile).ok,false);assert.equal(p.gold,gold);
 city.constructing=false;city.level=game.config.maxLevel(U.City);
 assert.equal(build(game,p,U.City,tile).ok,false);assert.equal(p.gold,gold);
 city.level=1;city.deleteAt=game.ticks+30;
 assert.equal(upgradeUnit(game,p,city).ok,false);assert.equal(p.gold,gold);
});
test('tiny administrative regions cannot multiply the fixed conquest bonus',()=>{
 const cfg=new Config(DEFAULT_SETTINGS,1,652000);
 assert.ok(100*cfg.countryClaimGold(10,10)<=cfg.countryClaimGold(1000,1000));
 assert.ok(100*cfg.countryClaimTroops(10,10)<=cfg.countryClaimTroops(1000,1000));
});


test('neutral expansion advances on every shared border of only the clicked region',()=>{
 const {map,game}=world();const p=player(game,map.ref(30,30));game.conquer(p,map.ref(80,40));
 const first=map.ref(31,30),second=map.ref(81,40),other=map.ref(29,30);
 map.country[first]=map.country[second]=7;map.country[other]=8;
 game.config.attackLogic=()=>({attackerTroopLoss:1,defenderTroopLoss:0,tickFraction:1});
 const attack=new AttackExecution(100,p,null,first);attack.init(game);
 assert.deepEqual(new Set(attack.frontTiles()),new Set([first,second]));
 for(let i=0;i<5;i++)attack.tick();
 assert.equal(map.owner[first],p.smallID);assert.equal(map.owner[second],p.smallID);assert.equal(map.owner[other],0);
});
test('neutral reinforcements include new borders while remaining one region-specific army',()=>{
 const {map,game}=world();const p=player(game,map.ref(30,30)),first=map.ref(31,30),second=map.ref(81,40);
 map.country[first]=map.country[second]=7;
 const a=new AttackExecution(100,p,null,first);a.init(game);
 game.conquer(p,map.ref(80,40));const b=new AttackExecution(200,p,null,second);b.init(game);
 assert.equal(p.outgoingAttacks.length,1);assert.equal(a.troops(),300);
 assert.ok(a.frontTiles().has(first)&&a.frontTiles().has(second));
});
test('a deep neutral click selects its region rather than a nearer border in another region',()=>{
 const {map,game}=world();const p=player(game,map.ref(30,30));game.conquer(p,map.ref(80,40));
 const near=map.ref(31,30),far=map.ref(81,40),click=map.ref(40,30);
 map.country[near]=8;map.country[far]=map.country[click]=7;
 assert.equal(attackTile(game,p,click,100).ok,true);
 const attack=game.pendingExecutions.at(-1);attack.init(game);
 assert.equal(attack.countryId,7);assert.ok(attack.frontTiles().has(far));assert.equal(attack.frontTiles().has(near),false);
});
test('neutral naval landings remain local despite existing borders elsewhere',()=>{
 const {map,game}=world();const p=player(game,map.ref(30,30)),beach=map.ref(80,40);
 game.conquer(p,beach);
 const attack=new AttackExecution(100,p,null,beach,false,true);attack.init(game);
 assert.ok(attack.frontTiles().has(map.ref(81,40)));assert.equal(attack.frontTiles().has(map.ref(31,30)),false);
});


test('small armies cannot multiply land capture speed by opening a much wider border',()=>{
 const run=(troops,height)=>{
  const {map,game}=world(512,256);game.config=new Config(game.config.settings,1,652000);
  const p=player(game,map.ref(200,128));
  for(let y=128-height/2;y<128+height/2;y++)game.conquer(p,map.ref(200,y));
  for(let y=0;y<256;y++)for(let x=201;x<300;x++)map.country[map.ref(x,y)]=1;
  const before=p.landArea,attack=new AttackExecution(troops,p,null,map.ref(201,128));attack.init(game);
  for(let i=0;i<10;i++){attack.tick();game.ticks++;}
  return p.landArea-before;
 };
 const narrow=run(500,40),wide=run(500,120),strong=run(50000,120);
 assert.ok(wide<=narrow*1.5+1,`small army gained ${narrow} on short front but ${wide} on wide front`);
 assert.ok(wide<2,`small army swept ${wide} reference area in one second`);
 assert.ok(strong>wide*4+4,`reinforcements should matter: weak ${wide}, strong ${strong}`);
});
test('troop-supported front length scales with resolution and falls as an army is depleted',()=>{
 const a=new Config(DEFAULT_SETTINGS,1,652000),b=new Config(DEFAULT_SETTINGS,2,652000*4);
 assert.equal(a.supportedAttackFront(1000,1000),5);
 assert.equal(b.supportedAttackFront(2000,1000),10);
 assert.ok(a.supportedAttackFront(1000,200)<a.supportedAttackFront(1000,1000));
 assert.equal(a.supportedAttackFront(3,100000),3);
});

test('defense and SAM radii are meaningful at the current resolution and grow with SAM levels',()=>{
 const cfg=new Config(DEFAULT_SETTINGS,5792/2048,652000);
 assert.equal(cfg.defensePostRange(),23);assert.equal(cfg.samRange(1),57);
 assert.ok(cfg.samRange(5)>cfg.samRange(1));
 const low=new Config(DEFAULT_SETTINGS,1,652000);
 close(cfg.defensePostRange()/low.defensePostRange(),5792/2048,.1);
 close(cfg.samRange(1)/low.samRange(1),5792/2048,.1);
});
test('defense coverage follows its spherical circle and clears on removal at the pole and seam',()=>{
 const {map,game}=world(128,64,T.Plains,{instantBuild:true});
 const tile=map.ref(0,3),p=player(game,tile),post=game.addUnit(U.DefensePost,p,tile);
 const radius=game.config.defensePostRange();let covered=0;
 for(let t=0;t<map.width*map.height;t++){
  const inside=map.surfaceDistance(tile,t)<=radius;
  assert.equal(game.defenseCover[t],inside?p.smallID:0);if(inside)covered++;
 }
 assert.ok(covered>radius*radius*4,'polar coverage should include compressed longitude pixels');
 game.removeUnit(post);assert.ok(game.defenseCover.every(id=>id===0));
});
test('SAM intercept coverage includes polar impact sites inside the displayed spherical radius',()=>{
 const {map,game}=world(512,256,T.Plains,{instantBuild:true});
 const a=player(game,map.ref(200,128)),b=player(game,map.ref(0,8),P.Nation);
 const sam=game.addUnit(U.SAMLauncher,b,b.spawnTile>=0?b.spawnTile:map.ref(0,8));
 const target=map.ref(60,8),silo=game.addUnit(U.MissileSilo,a,map.ref(200,128));
 assert.ok(map.dist(sam.tile,target)>game.effectiveSamRange(sam));
 assert.ok(map.surfaceDistance(sam.tile,target)<game.effectiveSamRange(sam));
 const nuke=new NukeExecution(a,U.AtomBomb,silo,target);nuke.init(game);
 game.random.next=()=>0;
 nuke.trySamIntercept(nuke.unit,.3);
 assert.equal(nuke.unit.targetedBySam,true);assert.equal(sam.samAmmo,0);
});


test('missile salvos reserve payment, wait for silo reload, and refund only unlaunched orders',()=>{
 const {map,game}=world(512,256,T.Plains,{instantBuild:true});const tile=map.ref(200,128),p=player(game,tile);p.gold=1e7;
 const silo=game.addUnit(U.MissileSilo,p,tile),price=game.config.unitCost(U.AtomBomb,0);
 p.gold-=price;const paid=p.gold;
 const result=queueMissiles(game,p,U.AtomBomb,[tile+2,tile+3,tile+4],price);
 assert.equal(result.ok,true);assert.equal(p.gold,paid-price*2);
 const salvo=result.salvo;salvo.init(game);salvo.tick();
 assert.equal(salvo.orders.length,2);assert.ok(silo.cooldownUntil>game.ticks);
 salvo.tick();assert.equal(salvo.orders.length,2);
 game.ticks=silo.cooldownUntil;salvo.tick();assert.equal(salvo.orders.length,1);
 const balance=p.gold;salvo.cancel();assert.equal(p.gold,balance+price);assert.equal(salvo.isActive(),false);
 salvo.cancel();assert.equal(p.gold,balance+price);
});
test('salvo validation requires completed reachable silos and never partially charges invalid plans',()=>{
 const {map,game}=world(512,256),tile=map.ref(200,128),p=player(game,tile);p.gold=1e7;
 assert.equal(queueMissiles(game,p,U.AtomBomb,[tile+1]).ok,false);
 const silo=game.addUnit(U.MissileSilo,p,tile);assert.equal(queueMissiles(game,p,U.AtomBomb,[tile+1]).ok,false);
 silo.constructing=false;const balance=p.gold;
 assert.equal(queueMissiles(game,p,U.AtomBomb,[tile+1,map.ref(0,0)]).ok,false);assert.equal(p.gold,balance);
});
test('salvos refund queued missiles when their only silo is destroyed',()=>{
 const {map,game}=world(512,256,T.Plains,{instantBuild:true});const tile=map.ref(200,128),p=player(game,tile);p.gold=1e7;
 const silo=game.addUnit(U.MissileSilo,p,tile);silo.cooldownUntil=game.ticks+100;
 const balance=p.gold,result=queueMissiles(game,p,U.AtomBomb,[tile+1,tile+2]);assert.equal(result.ok,true);
 result.salvo.init(game);game.removeUnit(silo);result.salvo.tick();assert.equal(p.gold,balance);assert.equal(result.salvo.isActive(),false);
});
test('opening pace, troop-dependent throughput and occupation costs apply consistently to humans and bots',()=>{
 const cfg=new Config(DEFAULT_SETTINGS,1,652000);
 const input={terrain:T.Plains,attackTroops:5000,attacker:{type:P.Human,numTiles:1000},defender:null,defenderHasDefensePost:false,falloutRatio:null,borderSize:10000,landTiles:1000,elapsedTicks:0};
 const early=cfg.attackLogic(input),late=cfg.attackLogic({...input,elapsedTicks:900});
 assert.ok(early.tickFraction>=late.tickFraction*3);
 assert.equal(early.attackerTroopLoss,60);
 assert.equal(cfg.attackLogic({...input,attacker:{...input.attacker,type:P.Bot}}).attackerTroopLoss,60);
 assert.ok(cfg.attackLogic({...input,attackTroops:2500}).tickFraction>=early.tickFraction*2);
});
test('an army spends troops taking land and its later advances slow as it depletes',()=>{
 const {map,game}=world(512,256);game.ticks=2000;
 const p=player(game,map.ref(256,128)),attack=new AttackExecution(5000,p,null,map.ref(257,128));attack.init(game);
 const start=p.landArea;let first;
 for(let i=0;i<300;i++){attack.tick();game.ticks++;if(i===99)first=p.landArea-start;}
 const lateStart=p.landArea;
 for(let i=0;i<100;i++){attack.tick();game.ticks++;}
 const later=p.landArea-lateStart;
 assert.ok(first>0&&later<first*.8,`first ${first}, later ${later}`);
 close(attack.troops(),5000-(p.landArea-start)*60,1e-6);
});

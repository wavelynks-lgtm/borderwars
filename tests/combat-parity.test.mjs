import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Config} from '../src/core/Config.ts';
import {DEFAULT_SETTINGS} from '../src/core/types.ts';
const {fixtures}=JSON.parse(readFileSync(new URL('./fixtures/openfront-combat.json',import.meta.url),'utf8'));
const close=(actual,expected,label)=>assert.ok(Math.abs(actual-expected)<Math.max(1e-8,Math.abs(expected)*1e-7),`${label}: ${actual} vs ${expected}`);
test('72 troop-cost and speed scenarios match upstream OpenFront at reference scale',()=>{
 const cfg=new Config(DEFAULT_SETTINGS,1,652000);
 for(const {name,input,expected} of fixtures)for(const [key,value] of Object.entries(expected))close(cfg.attackLogic(input)[key],value,`${name}/${key}`);
});
test('reference combat outcomes survive globe resolution and latitude conversion',()=>{
 for(const scale of [1,2,5792/2048,4])for(const areaPerPixel of [1,.5,.1]) {
  const cfg=new Config(DEFAULT_SETTINGS,scale,652000*scale*scale);
  for(const {name,input,expected} of fixtures) {
   const globeInput={...input,attacker:{...input.attacker,numTiles:input.attacker.numTiles*scale*scale},defender:input.defender?{...input.defender,numTiles:input.defender.numTiles*scale*scale}:null,borderSize:input.borderSize*scale};
   const actual=cfg.attackLogic(globeInput),pixelsPerReference=scale*scale/areaPerPixel;
   for(const [key,value] of Object.entries(expected))close(actual[key]*areaPerPixel*pixelsPerReference,value,`${name}/${scale}/${areaPerPixel}/${key}`);
  }
 }
});

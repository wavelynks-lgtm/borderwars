import test from 'node:test';
import assert from 'node:assert/strict';
import {generateWorld,DEFAULT_RECIPE,validateRecipe,noise3,generatedColor} from '../src/map/generator.ts';
import {TerrainType} from '../src/core/types.ts';
import {sanitizeCosmetics,flagGlyph} from '../src/customization/cosmetics.ts';
const recipe={...DEFAULT_RECIPE,resolution:512,countries:16};
test('generated worlds repeat exactly and every playable tile belongs to a valid country',()=>{
 const a=generateWorld(recipe),b=generateWorld(recipe);assert.deepEqual(a.terrain,b.terrain);assert.deepEqual(a.country,b.country);assert.deepEqual(a.countries,b.countries);
 const counts=new Uint32Array(a.countries.length);let water=0,total=0;
 for(let t=0;t<a.terrain.length;t++){const area=a.tileArea(t);total+=area;if(a.terrain[t]===TerrainType.Water)water+=area;
  if(a.isLand(t)){assert.ok(a.country[t]>0&&a.country[t]<a.countries.length);counts[a.country[t]]++;}else assert.equal(a.country[t],0);
 }
 assert.ok(Math.abs(water/total*100-recipe.water)<1);
 for(const c of a.countries.slice(1)){assert.ok(c.tiles>0);assert.equal(c.tiles,counts[c.id]);assert.equal(a.country[c.centroid],c.id);assert.ok(a.isLand(c.centroid));}
 assert.equal(a.generated.ground,recipe.ground);
});
test('world controls change geography, coverage, palettes and seeds',()=>{
 const land=generateWorld({...recipe,water:30}),sea=generateWorld({...recipe,water:85});assert.ok(land.landArea>sea.landArea*3);
 const alternate=generateWorld({...recipe,seed:'different',layout:'archipelago'});assert.notDeepEqual(land.terrain,alternate.terrain);
 assert.notDeepEqual(generatedColor(recipe,TerrainType.Plains,100,0),generatedColor({...recipe,ground:'#ff0000'},TerrainType.Plains,100,0));
 const phi=.7;assert.ok(Math.abs(noise3(Math.cos(0)*phi,.4,Math.sin(0)*phi,7)-noise3(Math.cos(2*Math.PI)*phi,.4,Math.sin(2*Math.PI)*phi,7))<1e-12);
});
test('world imports reject unsafe sizes, invalid numbers, colors and future formats',()=>{
 for(const bad of [{resolution:100000},{water:NaN},{countries:1e9},{seed:4},{ground:'url(evil)'},{version:2}])assert.throws(()=>validateRecipe({...recipe,...bad}));
});
test('cosmetics sanitize flags and gate premium appearance without changing gameplay',()=>{
 assert.equal(flagGlyph('BE'),'🇧🇪');assert.equal(flagGlyph('<svg>'),'');
 const c=sanitizeCosmetics({flag:'BE',pattern:'checks',color:'url(x)',secondary:'#123abc',badge:'supporter'});
 assert.equal(c.flag,'BE');assert.equal(c.pattern,'solid');assert.equal(c.badge,'none');assert.equal(c.color,'#ff4d6d');
 assert.equal(sanitizeCosmetics({pattern:'checks',badge:'supporter'},true).badge,'supporter');
});

import {h} from './dom';
import {DEFAULT_RECIPE,validateRecipe,generatedColor,type WorldRecipe} from '../map/generator';
import {generateAsync,savedWorlds,saveWorld,deleteWorld} from '../map/generatedWorlds';
import type {GameMap} from '../core/GameMap';
export function showWorldCreator(container:HTMLElement,onPlay:(recipe:WorldRecipe)=>void){
 let recipe={...DEFAULT_RECIPE},savedId:string|undefined,controller:AbortController|null=null,closed=false,ready=false;
 const fields=new Map<keyof WorldRecipe,HTMLInputElement|HTMLSelectElement>();
 const status=h('p',{class:'creator-status',role:'status'},'Choose your world settings, then generate a preview.');
 const canvas=h('canvas',{width:768,height:384,class:'creator-preview','aria-label':'Generated world map'});
 const controls=h('div',{class:'creator-controls'}),library=h('div',{class:'world-library'});
 const play=h('button',{class:'btn btn-primary',disabled:true,onClick:()=>{if(!ready)return;controller?.abort();root.remove();closed=true;onPlay({...recipe});}},'Play this world');
 const save=h('button',{class:'btn',disabled:true,onClick:()=>{try{const entry=saveWorld(recipe,savedId);savedId=entry.id;status.textContent='Saved on this device. Export a copy to keep it elsewhere.';renderLibrary();}catch(e){status.textContent=(e as Error).message;}}},'Save world');
 const exportButton=h('button',{class:'btn',onClick:()=>{try{const r=read();const blob=new Blob([JSON.stringify(r,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=h('a',{href:url,download:r.name.replace(/[^a-z0-9_-]/gi,'_')+'.world.json'});a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){status.textContent=(e as Error).message;}}},'Export');
 const importFile=h('input',{type:'file',accept:'.json,application/json',hidden:true,onChange:async()=>{const file=importFile.files?.[0];if(!file)return;try{if(file.size>16384)throw new Error('World recipes must be under 16 KB');load(validateRecipe(JSON.parse(await file.text())));status.textContent='Recipe imported. Generate it to preview or play.';}catch(e){status.textContent=(e as Error).message;}finally{importFile.value='';}}});
 const generate=h('button',{class:'btn btn-primary',onClick:()=>void run()},'Generate world');
 const root=h('div',{class:'creator-overlay'},h('section',{class:'creator-panel'},h('header',{},h('div',{},h('h2',{},'WORLD FORGE'),h('p',{},'Shape a globe. Draw new borders. Make it yours.')),h('button',{class:'btn',onClick:()=>{closed=true;controller?.abort();root.remove();}},'Close')),h('div',{class:'creator-layout'},controls,h('div',{},canvas,status,h('div',{class:'creator-actions'},generate,h('button',{class:'btn',onClick:()=>{controller?.abort();}},'Cancel generation'),play,save,exportButton,h('button',{class:'btn',onClick:()=>importFile.click()},'Import'),importFile),h('h3',{},'Saved worlds'),library))));
 container.append(root);
 const dirty=()=>{controller?.abort();ready=false;play.disabled=save.disabled=true;status.textContent='Settings changed. Generate to update the preview.';};
 function add(key:keyof WorldRecipe,label:string,type:string,options?:string[],min?:number,max?:number){
  const input=options?h('select',{'aria-label':label},...options.map(v=>h('option',{value:v},v))):h('input',{type,'aria-label':label,min,max,maxLength:key==='name'?40:key==='seed'?64:undefined});
  input.value=String(recipe[key]);fields.set(key,input);
  const value=h('span',{class:'creator-value'},String(recipe[key]));
  input.addEventListener('input',()=>{value.textContent=input.value;dirty();if(key==='climate'){
   const presets:Record<string,string[]>= {temperate:['#70a14d','#173d70','#a38b58','#d6d0c7'],desert:['#c6a269','#174b69','#a06b40','#ddd0ad'],frozen:['#a4c2c8','#1c416b','#839aa5','#ecf4f8'],volcanic:['#705746','#302335','#96503c','#c7a597']};
   ['ground','ocean','highland','mountain'].forEach((k,i)=>{fields.get(k as keyof WorldRecipe)!.value=presets[input.value][i];});
  }});
  controls.append(h('label',{},h('span',{},label,type==='range'?value:null),input));
 }
 add('name','World name','text');add('seed','Seed','text');controls.append(h('button',{class:'btn',onClick:()=>{fields.get('seed')!.value=crypto.randomUUID().slice(0,12);savedId=undefined;dirty();}},'New seed'));
 add('layout','Land layout','select',['continents','archipelago','supercontinent']);add('climate','World type','select',['temperate','desert','frozen','volcanic']);
 add('water','Water coverage %','range',undefined,15,90);add('scale','Continent scale','range',undefined,1,8);add('roughness','Coastline detail','range',undefined,0,100);add('mountains','Mountain intensity','range',undefined,0,100);add('ice','Polar ice extent','range',undefined,0,35);add('countries','Countries','range',undefined,4,160);add('countryTint','Country color strength','range',undefined,0,75);add('resolution','Resolution (width)','select',['1024','2048','4096']);
 for(const [key,label] of [['ground','Ground color'],['ocean','Ocean color'],['highland','Highland color'],['mountain','Mountain color'],['border','Border color']] as const)add(key,label,'color');
 function read(){const next={...recipe};for(const [key,input] of fields)(next as unknown as Record<string,unknown>)[key]=typeof recipe[key]==='number'?Number(input.value):input.value;return validateRecipe(next);}
 function load(r:WorldRecipe,id?:string){controller?.abort();recipe=r;savedId=id;for(const [key,input] of fields){input.value=String(r[key]);const out=input.parentElement?.querySelector('.creator-value');if(out)out.textContent=input.value;}dirty();}
 async function run(){controller?.abort();const control=new AbortController();controller=control;ready=false;play.disabled=save.disabled=true;generate.disabled=true;
  try{recipe=read();const map=await generateAsync(recipe,(m,p)=>{if(!closed)status.textContent=`${m} ${p}%`;},control.signal);if(closed)return;paint(map);ready=true;play.disabled=save.disabled=false;status.textContent=`${recipe.name} · ${map.countries.length-1} countries · ${map.width} × ${map.height} · ready to play solo`;}
  catch(e){if(!closed)status.textContent=(e as Error).name==='AbortError'?'Generation cancelled.':(e as Error).message;}
  finally{if(controller===control){controller=null;generate.disabled=false;}}
 }
 function paint(map:GameMap){const ctx=canvas.getContext('2d')!,image=ctx.createImageData(canvas.width,canvas.height);for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
  const sx=Math.floor(x/canvas.width*map.width),sy=Math.floor(y/canvas.height*map.height),t=sy*map.width+sx,c=map.country[t],right=sy*map.width+(sx+1)%map.width,down=Math.min(map.height-1,sy+1)*map.width+sx;
  const border=!!c&&((map.country[right]&&map.country[right]!==c)||(map.country[down]&&map.country[down]!==c));
  const col=generatedColor(recipe,map.terrain[t],map.elevation![t],c,!!border),i=(y*canvas.width+x)*4;image.data.set([...col,255],i);
 }ctx.putImageData(image,0,0);}
 function renderLibrary(){library.replaceChildren();const worlds=savedWorlds();if(!worlds.length)library.append(h('p',{},'Your saved worlds will appear here.'));
  for(const w of worlds)library.append(h('div',{class:'saved-world'},h('span',{},w.recipe.name),h('button',{class:'btn',onClick:()=>{load(w.recipe,w.id);void run();}},'Load'),h('button',{class:'btn',onClick:()=>{try{deleteWorld(w.id);renderLibrary();if(savedId===w.id)savedId=undefined;}catch(e){status.textContent=(e as Error).message;}}},'Delete')));
 }renderLibrary();void run();
}

import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
// Optional baseline snapshot lets the same browser, map and workload compare both implementations.
const baselinePath=process.argv[2];
let baseline=null;
if(baselinePath){const source=await readFile(baselinePath,'utf8');const a=source.indexOf('  syncTerritory(): void {');const b=source.indexOf('  private packOwnerSpan',a);baseline=stripTypeScriptTypes('function '+source.slice(a,b).trim(),{mode:'transform'});}
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.goto('http://127.0.0.1:5173/?dev=0');
 await page.getByRole('button',{name:'Single Player'}).click();await page.getByRole('button',{name:'Start',exact:true}).click();
 await page.waitForFunction(()=>!!window.__game,{timeout:60000});
 const result=await page.evaluate(({baseline})=>{
  __app.paused=true;__app.running=false;
  const r=__globe,m=__map,gl=r.renderer.getContext();
  const current=r.syncTerritory;
  const old=baseline?new Function(baseline+';return syncTerritory;')():null;
  const run=fn=>{
   const times=[];let pixels=0,calls=0;
   const upload=r.uploadTexRect;
   r.uploadTexRect=function(tex,data,x0,y0,x1,y1){pixels+=(x1-x0+1)*(y1-y0+1);calls++;return upload.call(this,tex,data,x0,y0,x1,y1);};
   for(let trial=0;trial<50;trial++){
    m.dirty=false;m.dirtyRows.fill(0);m.dirtyRowMinX.fill(m.width);m.dirtyRowMaxX.fill(-1);r.uploadCursor=0;
    // Fifty small fronts spread around the globe, each an 8-by-8 patch.
    for(let k=0;k<50;k++){const x=40+(k*719)%(m.width-100),y=20+k*36;
     for(let dy=0;dy<8;dy++)for(let dx=0;dx<8;dx++){const t=m.ref(x+dx,y+dy);m.owner[t]=(trial%2)+1;m.markDirty(t);}}
    const start=performance.now();let guard=0;
    while(m.dirty&&guard++<50)fn.call(r);
    gl.finish();times.push(performance.now()-start);
    if(m.dirty)throw Error('Upload did not finish');
   }
   r.uploadTexRect=upload;times.sort((a,b)=>a-b);
   return {p50ms:times[25],p95ms:times[47],pixelsPerUpdate:pixels/50,callsPerUpdate:calls/50};
  };
  // Warm both paths before measuring; report two rounds in opposite order.
  const first={before:old?run(old):null,after:run(current)};
  const second={after:run(current),before:old?run(old):null};
  return {first,second,glError:gl.getError(),map:[m.width,m.height]};
 },{baseline});
 console.log(JSON.stringify(result,null,2));await writeFile('/tmp/borderwars-territory-benchmark.json',JSON.stringify(result,null,2));
} finally {await browser.close();}

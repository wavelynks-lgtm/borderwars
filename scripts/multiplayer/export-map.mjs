import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage();await page.goto(process.env.BW_DEV_URL??'http://127.0.0.1:5175');
 const result=await page.evaluate(async()=>{
  const {loadWorld}=await import('/src/map/worlds.ts');const m=await loadWorld('earth',()=>{});
  const width=2048,height=1024,n=width*height,terrain=new Uint8Array(n),country=new Uint16Array(n),elevation=new Uint8Array(n);
  const countries=m.countries.map(c=>({...c,tiles:0,centroid:-1}));
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const i=y*width+x,t=Math.min(m.height-1,Math.floor((y+.5)*m.height/height))*m.width+Math.min(m.width-1,Math.floor((x+.5)*m.width/width));
   terrain[i]=m.terrain[t];country[i]=m.country[t];elevation[i]=m.elevation?.[t]??0;
   const c=countries[country[i]];if(c&&m.isLand(t)){c.tiles++;if(c.centroid<0)c.centroid=i;}
  }
  for(const c of countries){if(!c||!c.tiles)continue;const original=m.countries[c.id];const x=Math.floor((m.x(original.centroid)+.5)*width/m.width),y=Math.floor((m.y(original.centroid)+.5)*height/m.height);if(country[y*width+x]===c.id)c.centroid=y*width+x;}
  const base64=a=>{let s='';for(let i=0;i<a.length;i+=8192)s+=String.fromCharCode(...a.subarray(i,i+8192));return btoa(s);};
  return {meta:{width,height,countries},terrain:base64(terrain),country:base64(new Uint8Array(country.buffer)),elevation:base64(elevation)};
 });
 const meta=Buffer.from(JSON.stringify(result.meta)),header=Buffer.alloc(4);header.writeUInt32LE(meta.length);
 const packed=gzipSync(Buffer.concat([header,meta,Buffer.from(result.terrain,'base64'),Buffer.from(result.country,'base64'),Buffer.from(result.elevation,'base64')]));
 await writeFile('public/data/online-earth.bin.gz',packed);console.log('Exported shared online map',packed.length,'bytes');
}finally{await browser.close();}

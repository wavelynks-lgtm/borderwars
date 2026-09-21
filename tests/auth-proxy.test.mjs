import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/neon-auth.mjs';
test('auth proxy forwards session cookies but strips deployment hostname headers',async()=>{
 const original=globalThis.fetch,headers={};let sent;
 globalThis.fetch=async(url,options)=>{sent={url,options};return new Response('null',{headers:{'content-type':'application/json','set-cookie':'session=value; Domain=neon.tech; Path=/neondb/auth; HttpOnly; Secure'}});};
 try{
  await handler({method:'GET',url:'/api/neon-auth?path=get-session',headers:{host:'app.vercel.app','x-forwarded-host':'app.vercel.app',cookie:'session=old',origin:'https://borderwars.vercel.app'}},{setHeader:(k,v)=>headers[k]=v,end:()=>{}});
  assert.equal(sent.options.headers.cookie,'session=old');assert.equal(sent.options.headers.host,undefined);assert.equal(sent.options.headers['x-forwarded-host'],undefined);assert.ok(String(sent.url).endsWith('/neondb/auth/get-session'));assert.equal(headers['Cache-Control'],'no-store');assert.ok(!headers['Set-Cookie'][0].includes('Domain='));assert.ok(headers['Set-Cookie'][0].includes('Path=/;'));
 }finally{globalThis.fetch=original;}
});
test('auth proxy rejects paths that could escape the configured provider',async()=>{
 let status;await handler({method:'GET',url:'/api/neon-auth?path=../elsewhere',headers:{}},{setHeader:()=>{},set statusCode(v){status=v;},end:()=>{}});assert.equal(status,400);
});

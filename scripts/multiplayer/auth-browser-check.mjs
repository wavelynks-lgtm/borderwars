import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext(),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const user={id:'neon-test',name:'Returning Player',email:'player@example.test',emailVerified:true,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
 const matchToken='test.match.jwt';let tokenRequests=0,authenticated=false,connections=0,leaves=0;
 const session={id:'session',token:'test',userId:user.id,expiresAt:new Date(Date.now()+86400000).toISOString(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
 await page.route('**/api/auth/**',async route=>{
  const path=new URL(route.request().url()).pathname,cookies=await context.cookies(),signed=cookies.some(c=>c.name==='test-session');let response=null;
  if(path.endsWith('/sign-in/email')){await context.addCookies([{name:'test-session',value:'yes',url:'http://127.0.0.1:4180',httpOnly:true}]);response={user,session,token:'test',redirect:false};}
  else if(path.endsWith('/get-session'))response=signed?{user,session}:null;
  else if(path.endsWith('/sign-out')){await context.clearCookies();response={success:true};}
  else if(path.endsWith('/token')){tokenRequests++;response={token:signed?matchToken:null};}
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(response)});
 });
 await page.routeWebSocket('**/ws',ws=>{connections++;ws.onMessage(raw=>{
  const message=JSON.parse(String(raw));
  if(message.type==='leave')leaves++;
  if(message.type==='auth'){assert.equal(message.token,matchToken);authenticated=true;ws.send(JSON.stringify({type:'welcome',profile:{id:user.id,name:user.name},rooms:[]}));}
  if(message.type==='queue')ws.send(JSON.stringify({type:'room',room:{id:'TESTROOM',name:'Random test lobby',kind:'random',phase:'lobby',countdownAt:Date.now()+60000,serverTime:Date.now(),capacity:8,host:user.id,members:[{id:user.id,name:user.name,color:'#ff0000',connected:true,ready:true}],settings:{numNations:6,numBots:4,goldMultiplier:1,maxTimerMinutes:30}}}));
 });});
 await page.goto('http://127.0.0.1:4180');await page.getByRole('button',{name:'▣ Sign in',exact:true}).click();
 await page.getByLabel('Email address').fill(user.email);await page.getByLabel('Password',{exact:true}).fill('a long test password');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'Returning Player'}).waitFor();await page.reload();await page.getByRole('button',{name:'Returning Player'}).waitFor();
 await page.getByRole('button',{name:/Random Match/}).click();await page.locator('.online-code').waitFor();
 assert.equal(authenticated,true);assert.ok(tokenRequests>0,'JWT endpoint must bypass the cached session');
 await page.getByRole('timer').filter({hasText:'Match starts in'}).waitFor();
 await page.getByRole('button',{name:'Close',exact:true}).click();
 await page.getByRole('button',{name:/Return to lobby/}).waitFor();assert.equal(leaves,0);
 await page.getByRole('button',{name:/Random Match/}).click();await page.locator('.online-code').waitFor({state:'visible'});
 assert.equal(connections,1);assert.equal(leaves,0);
 await page.getByRole('button',{name:'Close',exact:true}).click();
 await page.getByRole('button',{name:/Return to lobby/}).click();await page.locator('.online-code').waitFor({state:'visible'});
 await page.getByRole('button',{name:'Leave',exact:true}).click();await page.waitForTimeout(100);assert.equal(leaves,1);
 await page.getByRole('button',{name:'Close',exact:true}).click();
 await page.getByRole('button',{name:'Returning Player'}).click();await page.getByText('Signed in as Returning Player',{exact:true}).waitFor();await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.getByRole('button',{name:'Close',exact:true}).click();await page.reload();await page.getByRole('button',{name:'▣ Sign in',exact:true}).waitFor();
 assert.deepEqual(errors,[]);console.log('Mocked Neon SDK sign-in, HttpOnly-cookie restoration after reload, JWT retrieval after cached session, authenticated random lobby entry and sign-out passed.');
}finally{await browser.close();}

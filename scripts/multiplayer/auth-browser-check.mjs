import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext(),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const user={id:'neon-test',name:'Returning Player',email:'player@example.test',emailVerified:true,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
 const session={id:'session',token:'test',userId:user.id,expiresAt:new Date(Date.now()+86400000).toISOString(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
 await page.route('**/api/auth/**',async route=>{
  const path=new URL(route.request().url()).pathname,cookies=await context.cookies(),signed=cookies.some(c=>c.name==='test-session');let response=null;
  if(path.endsWith('/sign-in/email')){await context.addCookies([{name:'test-session',value:'yes',url:'http://127.0.0.1:4180',httpOnly:true}]);response={user,session,token:'test',redirect:false};}
  else if(path.endsWith('/get-session'))response=signed?{user,session}:null;
  else if(path.endsWith('/sign-out')){await context.clearCookies();response={success:true};}
  else if(path.endsWith('/token'))response={token:null};
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(response)});
 });
 await page.goto('http://127.0.0.1:4180');await page.getByRole('button',{name:'▣ Sign in',exact:true}).click();
 await page.getByLabel('Email address').fill(user.email);await page.getByLabel('Password',{exact:true}).fill('a long test password');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'Returning Player'}).waitFor();await page.reload();await page.getByRole('button',{name:'Returning Player'}).waitFor();
 await page.getByRole('button',{name:'Returning Player'}).click();await page.getByText('Signed in as Returning Player',{exact:true}).waitFor();await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.getByRole('button',{name:'Close',exact:true}).click();await page.reload();await page.getByRole('button',{name:'▣ Sign in',exact:true}).waitFor();
 assert.deepEqual(errors,[]);console.log('Mocked Neon SDK sign-in, HttpOnly-cookie restoration after reload, account display and sign-out passed.');
}finally{await browser.close();}

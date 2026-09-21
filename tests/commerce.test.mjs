import test from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import {Store} from '../server/store.mjs';
import {Commerce} from '../server/commerce.mjs';
const secret='whsec_test_secret';
function setupStripe(){
 const real=new Stripe('sk_test_not_a_real_key');let session={id:'cs_test',status:'open',url:'https://checkout.stripe.com/test',payment_status:'unpaid',amount_total:999,currency:'eur',payment_intent:null};let creates=0;
 const stripe={webhooks:real.webhooks,prices:{retrieve:async()=>({id:'price_test',active:true,type:'one_time',unit_amount:999,currency:'eur'})},checkout:{sessions:{create:async p=>{creates++;session={...session,client_reference_id:p.client_reference_id,metadata:p.metadata};return session;},retrieve:async()=>session,list:async()=>({data:[session]})}},disputes:{list:async()=>({data:[{status:'needs_response'}]})}};
 return {stripe,get session(){return session;},set session(v){session=v;},get creates(){return creates;}};
}
async function context(){const store=new Store(undefined,':memory:');await store.init();const fake=setupStripe(),commerce=new Commerce(store,{COMMERCE_ENABLED:'true',STRIPE_SECRET_KEY:'test',STRIPE_WEBHOOK_SECRET:secret,STRIPE_PRICE_SUPPORTER:'price_test',PUBLIC_APP_URL:'https://example.com'},fake.stripe);await commerce.init();const a=await store.register('Buyer_123','good long password');return {store,commerce,fake,account:a.profile};}
async function send(c,type,object){const raw=JSON.stringify({id:'evt_test',type,data:{object}}),signature=c.fake.stripe.webhooks.generateTestHeaderString({payload:raw,secret});return c.commerce.webhook(Buffer.from(raw),signature);}
test('store stays disabled without setup and premium cosmetics cannot be self-granted',async()=>{
 const s=new Store(undefined,':memory:');await s.init();const c=new Commerce(s,{});await c.init();try{
  assert.ok((await c.catalog()).every(p=>!p.available));await assert.rejects(()=>c.checkout({id:'x'},'supporter','x'),/not available/);
  const a=await s.register('Free_123','another good password');const cosmetic=await c.saveAppearance(a.profile.id,{pattern:'checks',badge:'supporter',flag:'BE'});assert.equal(cosmetic.pattern,'solid');assert.equal(cosmetic.badge,'none');assert.equal(cosmetic.flag,'BE');
 }finally{await s.close();}
});
test('signed paid checkout unlocks once, pending and forged events do not, refund revokes access',async()=>{
 const c=await context();try{
  await c.commerce.checkout(c.account,'supporter','11111111-1111-1111-1111-111111111111');
  await c.commerce.checkout(c.account,'supporter','22222222-2222-2222-2222-222222222222');assert.equal(c.fake.creates,1,'reuse open checkout');
  await assert.rejects(()=>c.commerce.webhook(Buffer.from('{}'),'bad-signature'));
  await send(c,'checkout.session.completed',{id:'cs_test'});assert.equal((await c.commerce.entitlements(c.account.id)).supporter,false);
  c.fake.session={...c.fake.session,status:'complete',payment_status:'paid',payment_intent:{id:'pi_test',status:'succeeded',latest_charge:{id:'ch_test',refunded:false,amount_refunded:0,disputed:false}}};
  await send(c,'checkout.session.completed',{id:'cs_test'});await send(c,'checkout.session.completed',{id:'cs_test'});assert.deepEqual(await c.commerce.entitlements(c.account.id),{supporter:true,adFree:true});
  assert.equal((await c.commerce.saveAppearance(c.account.id,{pattern:'checks',badge:'supporter'})).pattern,'checks');
  c.fake.session.payment_intent.latest_charge.refunded=true;
  await send(c,'charge.refunded',{payment_intent:'pi_test'});await send(c,'checkout.session.completed',{id:'cs_test'});
  assert.deepEqual(await c.commerce.entitlements(c.account.id),{supporter:false,adFree:false});assert.equal((await c.commerce.appearance(c.account.id)).pattern,'solid');
 }finally{await c.store.close();}
});
test('wrong amount, wrong account and disputed payments do not grant purchases',async()=>{
 const c=await context();try{
  await c.commerce.checkout(c.account,'supporter','11111111-1111-1111-1111-111111111111');
  c.fake.session={...c.fake.session,payment_status:'paid',amount_total:1,payment_intent:{id:'pi',status:'succeeded',latest_charge:{id:'ch',disputed:true,amount_refunded:0}}};
  await assert.rejects(()=>send(c,'checkout.session.completed',{id:'cs_test'}),/does not match/);c.fake.session.amount_total=999;
  const id=c.fake.session.client_reference_id;c.fake.session.client_reference_id='someone_else';await assert.rejects(()=>send(c,'checkout.session.completed',{id:'cs_test'}),/does not match/);c.fake.session.client_reference_id=id;
  await send(c,'checkout.session.completed',{id:'cs_test'});assert.equal((await c.commerce.entitlements(id)).supporter,false);
 }finally{await c.store.close();}
});

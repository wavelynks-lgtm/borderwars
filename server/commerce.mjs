import Stripe from 'stripe';
import {sanitizeCosmetics} from '../src/customization/cosmetics.ts';
export const PRODUCTS=[
 {id:'ad_free',name:'Ad-free',description:'Remove banner ads on this signed-in account.',priceEnv:'STRIPE_PRICE_AD_FREE'},
 {id:'supporter',name:'Supporter',description:'Ad-free play, a Supporter star badge, and checks, chevrons and crosshatch territory patterns. Cosmetic only.',priceEnv:'STRIPE_PRICE_SUPPORTER'},
];
export class Commerce {
 processing=Promise.resolve();
 constructor(store,env=process.env,stripe){this.store=store;this.env=env;this.stripe=stripe??(env.STRIPE_SECRET_KEY?new Stripe(env.STRIPE_SECRET_KEY):null);}
 async init(){for(const sql of [
  'CREATE TABLE IF NOT EXISTS purchases(session_id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), product TEXT NOT NULL, price_id TEXT NOT NULL, amount INTEGER NOT NULL, currency TEXT NOT NULL, payment_intent TEXT, status TEXT NOT NULL, updated BIGINT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS purchases_account ON purchases(account_id)',
  'CREATE TABLE IF NOT EXISTS cosmetics(account_id TEXT PRIMARY KEY REFERENCES accounts(id), value TEXT NOT NULL)'
 ])await this.store.query(sql);}
 enabled(){return !!(this.stripe&&this.env.STRIPE_WEBHOOK_SECRET&&this.env.PUBLIC_APP_URL&&this.env.COMMERCE_ENABLED==='true');}
 async entitlements(id){const rows=(await this.store.query("SELECT product FROM purchases WHERE account_id=$1 AND status='paid'",[id])).rows;const supporter=rows.some(r=>r.product==='supporter');return {supporter,adFree:supporter||rows.some(r=>r.product==='ad_free')};}
 async appearance(id){const e=await this.entitlements(id),row=(await this.store.query('SELECT value FROM cosmetics WHERE account_id=$1',[id])).rows[0];let value={};try{value=JSON.parse(row?.value??'{}');}catch{}return sanitizeCosmetics(value,e.supporter);}
 async saveAppearance(id,value){const e=await this.entitlements(id),safe=sanitizeCosmetics(value,e.supporter);await this.store.query('INSERT INTO cosmetics(account_id,value) VALUES($1,$2) ON CONFLICT(account_id) DO UPDATE SET value=excluded.value',[id,JSON.stringify(safe)]);return safe;}
 async catalog(){const entries=[];for(const product of PRODUCTS){let price=null;const id=this.env[product.priceEnv];if(this.enabled()&&id){try{const p=await this.stripe.prices.retrieve(id);if(p.active&&p.type==='one_time'&&p.unit_amount!==null&&p.unit_amount>0)price={amount:p.unit_amount,currency:p.currency};}catch{}}
  entries.push({id:product.id,name:product.name,description:product.description,price,available:!!price});}return entries;}
 async checkout(account,productId,requestId){
  if(!this.enabled())throw new Error('Purchases are not available yet');
  const product=PRODUCTS.find(p=>p.id===productId),priceId=product&&this.env[product.priceEnv];if(!product||!priceId)throw new Error('Unknown product');
  if(typeof requestId!=='string'||!/^[a-f0-9-]{36}$/.test(requestId))throw new Error('Invalid checkout request');
  const ent=await this.entitlements(account.id);if((product.id==='ad_free'&&ent.adFree)||(product.id==='supporter'&&ent.supporter))throw new Error('You already own this product');
  const price=await this.stripe.prices.retrieve(priceId);if(!price.active||price.type!=='one_time'||price.unit_amount===null||price.unit_amount<=0)throw new Error('Product price unavailable');
  const pending=(await this.store.query("SELECT session_id FROM purchases WHERE account_id=$1 AND product=$2 AND status='pending' ORDER BY updated DESC LIMIT 1",[account.id,product.id])).rows[0];
  if(pending){const previous=await this.stripe.checkout.sessions.retrieve(pending.session_id);if(previous.status==='open'&&previous.url)return {url:previous.url};if(previous.status==='complete'){await this.fulfill(previous.id);throw new Error('Your previous payment is being verified. Refresh your account before buying again.');}}
  const base=new URL(this.env.PUBLIC_APP_URL);if(base.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(base.hostname))throw new Error('Checkout requires HTTPS');
  const session=await this.stripe.checkout.sessions.create({mode:'payment',line_items:[{price:priceId,quantity:1}],client_reference_id:account.id,metadata:{app:'borderwars',account:account.id,product:product.id},payment_intent_data:{metadata:{app:'borderwars',account:account.id,product:product.id}},success_url:new URL('/?purchase=success',base).href,cancel_url:new URL('/?purchase=cancelled',base).href},{idempotencyKey:`checkout:${account.id}:${requestId}`});
  await this.store.query('INSERT INTO purchases(session_id,account_id,product,price_id,amount,currency,status,updated) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(session_id) DO NOTHING',[session.id,account.id,product.id,priceId,price.unit_amount,price.currency,'pending',Date.now()]);
  return {url:session.url};
 }
 async webhook(raw,signature){
  if(!this.stripe||!this.env.STRIPE_WEBHOOK_SECRET)throw new Error('Payments not configured');
  const event=this.stripe.webhooks.constructEvent(raw,signature,this.env.STRIPE_WEBHOOK_SECRET);
  const allowed=['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','charge.refunded','charge.dispute.created','charge.dispute.closed'];
  if(!allowed.includes(event.type))return;
  // Serialize retrieval + write so out-of-order events cannot restore refunded access.
  const work=this.processing.then(async()=>{
   const object=event.data.object;
   if(event.type.startsWith('checkout.'))return this.fulfill(object.id);
   let intent=object.payment_intent;
   if(!intent&&object.charge){const charge=await this.stripe.charges.retrieve(typeof object.charge==='string'?object.charge:object.charge.id);intent=charge.payment_intent;}
   if(intent){const list=await this.stripe.checkout.sessions.list({payment_intent:typeof intent==='string'?intent:intent.id,limit:100});for(const session of list.data)await this.fulfill(session.id);}
  });this.processing=work.catch(()=>{});await work;
 }
 async fulfill(sessionId){
  const row=(await this.store.query('SELECT * FROM purchases WHERE session_id=$1',[sessionId])).rows[0];
  const session=await this.stripe.checkout.sessions.retrieve(sessionId,{expand:['payment_intent.latest_charge']});
  if(!row){if(session.metadata?.app==='borderwars')throw new Error('Checkout record not ready; retry webhook');return;}
  if(session.client_reference_id!==row.account_id||session.metadata?.product!==row.product||session.amount_total!==Number(row.amount)||session.currency!==row.currency)throw new Error('Payment does not match the order');
  const intent=session.payment_intent,charge=typeof intent==='object'?intent?.latest_charge:null;
  let disputed=false;if(charge&&typeof charge==='object'&&charge.disputed){const disputes=await this.stripe.disputes.list({charge:charge.id,limit:100});disputed=disputes.data.some(d=>!['won','warning_closed'].includes(d.status));}
  let state='pending';if(session.payment_status==='paid'&&intent?.status==='succeeded'&&charge&&typeof charge==='object')state=disputed?'disputed':charge.refunded||charge.amount_refunded>0?'refunded':'paid';
  await this.store.query('UPDATE purchases SET payment_intent=$1,status=$2,updated=$3 WHERE session_id=$4',[typeof intent==='string'?intent:intent?.id??null,state,Date.now(),sessionId]);
 }
}

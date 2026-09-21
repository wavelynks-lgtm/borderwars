import {hasAccount} from '../auth/session';
import {h} from './dom';
import {api} from '../multiplayer/Client';
const FALLBACK=[{id:'ad_free',name:'Ad-free',description:'Remove banner ads on your signed-in account.',available:false,price:null},{id:'supporter',name:'Supporter',description:'Ad-free play, a Supporter star badge and three extra territory patterns. Cosmetic only.',available:false,price:null}];
export function showStore(container:HTMLElement){
 const content=h('div',{class:'store-products'}),status=h('p',{role:'status'},'Loading store…');
 const root=h('div',{class:'creator-overlay'},h('section',{class:'appearance-panel store-panel'},h('h2',{},'SUPPORT BORDERWARS'),h('p',{},'Personalize your empire. Every player has the same combat rules.'),status,content,h('button',{class:'btn',onClick:()=>root.remove()},'Close')));container.append(root);
 async function load(){let products=FALLBACK,ent={adFree:false,supporter:false},signedIn=false;
  try{products=(await api('/api/store')).products;}catch{}
  if(hasAccount())try{const me=await api('/api/me');ent=me.entitlements??ent;signedIn=true;}catch{}
  if(!root.isConnected)return;status.textContent=products.some(p=>p.available)?(signedIn?'One-time purchases. Access is linked to your account.':'Sign in through Play Online to purchase.'):'Purchases are not available yet. No payments are being taken.';
  content.replaceChildren();for(const p of products){const owned=p.id==='ad_free'?ent.adFree:ent.supporter;const price=p.price?new Intl.NumberFormat(undefined,{style:'currency',currency:(p.price as {currency:string}).currency}).format((p.price as {amount:number}).amount/(["bif","clp","djf","gnf","jpy","kmf","krw","mga","pyg","rwf","ugx","vnd","vuv","xaf","xof","xpf"].includes((p.price as {currency:string}).currency)?1:100)):null;
   const buy=h('button',{class:'btn btn-primary',disabled:owned||!p.available||!signedIn,onClick:async()=>{buy.disabled=true;try{const result=await api('/api/checkout',{product:p.id,requestId:crypto.randomUUID()});const url=new URL(result.url);if(url.protocol!=='https:'||url.hostname!=='checkout.stripe.com')throw new Error('Checkout unavailable');location.assign(url.href);}catch(e){status.textContent=(e as Error).message;buy.disabled=false;}}},owned?'Owned':p.available?`Buy · ${price}`:'Coming soon');
   content.append(h('article',{class:'store-product'},h('h3',{},p.name),h('p',{},p.description),buy));
  }
 }void load();
}

import {hasAccount} from '../auth/session';
import {h} from './dom';
import {DEFAULT_COSMETICS,FLAG_CODES,PATTERNS,PREMIUM_PATTERNS,flagGlyph,localCosmetics,patternCSS,sanitizeCosmetics,type Cosmetics} from '../customization/cosmetics';
import {api} from '../multiplayer/Client';
export function showCustomization(container:HTMLElement,onSave:(c:Cosmetics)=>void){
 let current=localCosmetics(),premium=false,account=false;
 const preview=h('div',{class:'appearance-preview'}),status=h('p',{role:'status'},'Choose your flag and the pattern shown on conquered land.');
 const flag=h('select',{'aria-label':'Flag'},h('option',{value:''},'No flag'),...['star','crown','globe',...FLAG_CODES].map(c=>h('option',{value:c},`${flagGlyph(c)} ${/^[A-Z]{2}$/.test(c)?new Intl.DisplayNames([navigator.language],{type:"region"}).of(c):c}`)));
 const pattern=h('select',{'aria-label':'Territory pattern'},...PATTERNS.map(p=>h('option',{value:p},`${p}${PREMIUM_PATTERNS.includes(p)?' · Supporter':''}`)));
 const primary=h('input',{type:'color','aria-label':'Territory color'}),secondary=h('input',{type:'color','aria-label':'Pattern color'}),badge=h('input',{type:'checkbox','aria-label':'Supporter badge'});
 const save=h('button',{class:'btn btn-primary',onClick:async()=>{
  save.disabled=true;try{let c=read();if(account)c=(await api('/api/cosmetics',c)).cosmetics;localStorage.setItem('borderwars.cosmetics',JSON.stringify(c));onSave(c);root.remove();}catch(e){status.textContent=(e as Error).message;}finally{save.disabled=false;}
 }},'Save appearance');
 const root=h('div',{class:'creator-overlay'},h('section',{class:'appearance-panel'},h('h2',{},'YOUR BANNER'),status,preview,h('div',{class:'appearance-fields'},h('label',{},'Flag',flag),h('label',{},'Territory pattern',pattern),h('label',{},'Territory color',primary),h('label',{},'Pattern color',secondary),h('label',{},badge,' Supporter badge')),h('div',{class:'creator-actions'},save,h('button',{class:'btn',onClick:()=>root.remove()},'Close'))));container.append(root);
 function read(){return sanitizeCosmetics({flag:flag.value,pattern:pattern.value,color:primary.value,secondary:secondary.value,badge:badge.checked?'supporter':'none'},premium);}
 function paint(){const c=read();preview.style.background=patternCSS(c);preview.textContent=`${flagGlyph(c.flag)} Commander${c.badge==='supporter'?' ★':''}`;}
 function set(){flag.value=current.flag;pattern.value=current.pattern;primary.value=current.color;secondary.value=current.secondary;badge.checked=current.badge==='supporter';badge.disabled=!premium;for(const o of pattern.options)o.disabled=PREMIUM_PATTERNS.includes(o.value as Cosmetics['pattern'])&&!premium;paint();}
 for(const input of [flag,pattern,primary,secondary,badge])input.addEventListener('input',paint);set();
 if(hasAccount()){save.disabled=true;void api('/api/me').then(result=>{if(!root.isConnected)return;account=true;premium=!!result.entitlements?.supporter;current=result.cosmetics??{...DEFAULT_COSMETICS};set();status.textContent='Your appearance is saved to your account and used in future online matches.';}).catch(()=>{status.textContent='Account unavailable. Changes can be saved on this device for solo play.';}).finally(()=>{save.disabled=false;});}
}

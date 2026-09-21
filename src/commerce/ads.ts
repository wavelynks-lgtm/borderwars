import {hasAccount} from '../auth/session';
import {api} from '../multiplayer/Client';
type Consent={eventStatus?:string;purpose?:{consents?:Record<string,boolean>};vendor?:{consents?:Record<string,boolean>};listenerId?:number};
type AdWindow=Window&{__tcfapi?:(command:string,version:number,callback:(data:Consent,success:boolean)=>void,param?:unknown)=>void;adsbygoogle?:unknown[]};
/** Ads exist only in the menu, after a configured certified CMP grants consent. */
export function mountMenuAd(container:HTMLElement):void{
 const publisher=import.meta.env.VITE_ADSENSE_CLIENT as string|undefined,slot=import.meta.env.VITE_ADSENSE_SLOT as string|undefined;
 if(import.meta.env.VITE_ADS_ENABLED!=='true'||!/^ca-pub-\d+$/.test(publisher??'')||!/^\d+$/.test(slot??''))return;
 const w=window as AdWindow;let consent=false,adFree=true,requested=false,disposed=false,listenerId:number|undefined;
 const host=document.createElement('aside');host.className='menu-ad';host.hidden=true;container.append(host);
 const clear=()=>{host.hidden=true;host.replaceChildren();requested=false;};
 const update=()=>{
  if(disposed||!container.isConnected||adFree||!consent){clear();return;}if(requested)return;requested=true;host.hidden=false;
  const label=document.createElement('span');label.textContent='Advertisement';const ins=document.createElement('ins');ins.className='adsbygoogle';ins.style.display='block';ins.dataset.adClient=publisher;ins.dataset.adSlot=slot;ins.dataset.adFormat='auto';ins.dataset.fullWidthResponsive='true';host.append(label,ins);
  const request=()=>{if(!disposed&&consent&&!adFree&&container.isConnected&&host.contains(ins))(w.adsbygoogle??=[]).push({});};
  let script=document.querySelector<HTMLScriptElement>('script[data-borderwars-ads]');if(!script){script=document.createElement('script');script.async=true;script.crossOrigin='anonymous';script.dataset.borderwarsAds='true';script.src=`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${publisher}`;script.onload=()=>{script!.dataset.loaded='true';request();};script.onerror=clear;document.head.append(script);}else if(script.dataset.loaded)request();else script.addEventListener('load',request,{once:true});
 };
 const account=async()=>{adFree=true;update();if(!hasAccount())adFree=false;else try{adFree=!!(await api('/api/me')).entitlements?.adFree;}catch{return;}update();};
 let attempts=0;const poll=window.setInterval(()=>{if(++attempts>40||disposed){clearInterval(poll);return;}if(w.__tcfapi){clearInterval(poll);w.__tcfapi('addEventListener',2,(tc,ok)=>{listenerId=tc.listenerId;consent=!!(ok&&['tcloaded','useractioncomplete'].includes(tc.eventStatus??'')&&tc.purpose?.consents?.['1']&&tc.purpose?.consents?.['3']&&tc.purpose?.consents?.['4']&&tc.vendor?.consents?.['755']);update();});}},500);
 window.addEventListener('borderwars-account-change',account);void account();
 const observer=new MutationObserver(()=>{if(container.isConnected)return;disposed=true;clearInterval(poll);window.removeEventListener('borderwars-account-change',account);if(listenerId!==undefined)w.__tcfapi?.('removeEventListener',2,()=>{},listenerId);clear();observer.disconnect();});observer.observe(container.parentNode??document.body,{childList:true});
}
export function privacyChoices(){(window as AdWindow).__tcfapi?.('displayConsentUi',2,()=>{});}

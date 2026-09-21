import {neonAuth,sessionUser,authToken,signOut} from '../auth/session';
import {showAccount} from './Account';
import {h} from './dom';
import {api,OnlineClient,serverURL} from '../multiplayer/Client';
import type {MatchInfo} from '../multiplayer/protocol';
import {savedWorlds} from '../map/generatedWorlds';
export type LobbyView='lobby'|'leaderboard'|'random'|'custom';
const lobbies=new WeakMap<HTMLElement,{root:HTMLElement;open:()=>void;dispose:()=>void}>();
export function closeOnlineLobby(container:HTMLElement){lobbies.get(container)?.dispose();}
export function showOnlineLobby(container:HTMLElement,onMatch:(info:MatchInfo,client:OnlineClient)=>void,initialView:LobbyView='lobby'){
 const existing=lobbies.get(container);if(existing){existing.open();return existing.root;}
 let client:OnlineClient|null=null,room:any=null,started=false,view:LobbyView=initialView,creating=false,queued=false,offset=0;
 const status=h('p',{class:'online-status',role:'status'},'Sign in to play online.');
 const content=h('div',{class:'online-content'});
 const title=h('h2',{},initialView==='custom'?'CUSTOM MATCHES':initialView==='random'?'RANDOM MATCH':'BORDERWARS ONLINE');
 const onAccountChange=()=>{void sessionUser().then(user=>{if(neonAuth&&!user)dispose();}).catch(()=>{});};
 const open=()=>{root.style.display='';resume.style.display='none';};
 const dispose=()=>{client?.send({type:'leave'});client?.close();root.remove();resume.remove();lobbies.delete(container);clearInterval(timer);clearInterval(poll);window.removeEventListener('borderwars-account-change',onAccountChange);};
 const close=()=>{if(client){root.style.display='none';resume.style.display='';}else dispose();};
 const resume=h('button',{class:'online-resume',style:'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:1000;display:none',onClick:open},'Return to lobby');
 const root=h('div',{class:'online-overlay'},h('section',{class:'online-panel'},h('div',{class:'online-heading'},title,h('button',{onClick:close},'Close')),status,content));
 container.append(root,resume);window.addEventListener('borderwars-account-change',onAccountChange);lobbies.set(container,{root,open,dispose});
 const error=(e:unknown)=>{status.textContent=e instanceof Error?e.message:String(e);};
 const run=(fn:()=>Promise<void>)=>()=>{void fn().catch(error);};
 const timer=window.setInterval(()=>{
  if(!root.isConnected){clearInterval(timer);resume.remove();if(lobbies.get(container)?.root===root)lobbies.delete(container);window.removeEventListener('borderwars-account-change',onAccountChange);if(!started)client?.close();return;}
  resume.textContent=room?.countdownAt?`Return to lobby · ${Math.max(0,Math.ceil((room.countdownAt-Date.now()-offset)/1000))}s`:'Return to lobby';
  const clock=content.querySelector('.online-countdown');
  if(clock&&room){const seconds=Math.max(0,Math.ceil((room.countdownAt-Date.now()-offset)/1000));clock.textContent=room.phase==='loading'?'Preparing everyone’s world…':room.countdownAt?`Match starts in ${seconds}s`:room.kind==='random'?'Preparing countdown…':'Waiting for the host';}
 },250);
 const poll=window.setInterval(()=>{if(!root.isConnected){clearInterval(poll);return;}if(client?.connected&&!room&&!creating&&view!=='leaderboard')client.send({type:'list'});},3000);
 function authForm(){
  if(neonAuth){status.textContent='Sign in to join this lobby.';content.replaceChildren(h('button',{onClick:()=>showAccount(container,()=>{void restore();})},'Sign in'));showAccount(container,()=>{void restore();});return;}

  const name=h('input',{placeholder:'Commander name',maxLength:20,autocomplete:'username','aria-label':'Commander name'});
  const password=h('input',{type:'password',placeholder:'Password (10+ characters)',maxLength:128,autocomplete:'current-password','aria-label':'Password'});
  const submit=(path:string)=>run(async()=>{status.textContent='Signing in…';const result=await api(path,{username:name.value,password:password.value});localStorage.setItem('borderwars.session',result.token);window.dispatchEvent(new Event('borderwars-account-change'));connect(result.token);});
  content.replaceChildren(h('p',{},'Sign in to join real players and save your results.'),name,password,h('div',{class:'online-actions'},h('button',{onClick:submit('/api/login')},'Sign in'),h('button',{onClick:submit('/api/register')},'Create account')),h('button',{onClick:run(leaderboard)},'View leaderboard'));
 }
 async function leaderboard(){
  view='leaderboard';const {entries}=await api('/api/leaderboard');const table=h('table',{class:'online-table'},h('thead',{},h('tr',{},...['Rank','Commander','Wins','Matches'].map(t=>h('th',{},t)))));
  const rows=h('tbody',{});entries.forEach((e:any,i:number)=>rows.append(h('tr',{},h('td',{},i+1),h('td',{},e.name),h('td',{},e.wins),h('td',{},e.games))));table.append(rows);
  content.replaceChildren(h('h3',{},'Global leaderboard'),h('p',{},'Random public matches lasting at least 5 minutes count toward rankings. Custom matches are unranked.'),entries.length?table:h('p',{},'No ranked matches yet.'),h('button',{onClick:()=>{view='lobby';client?client.send({type:'list'}):authForm();}},'Back'));
 }
 function createForm(){
  creating=true;title.textContent='CREATE CUSTOM MATCH';
  const worlds=savedWorlds(),world=h('select',{'aria-label':'Match world'},h('option',{value:''},'Earth'),...worlds.map(w=>h('option',{value:w.id,disabled:w.recipe.resolution>2048},`${w.recipe.name} · ${w.recipe.resolution}px${w.recipe.resolution>2048?' (solo only)':''}`)));
  const name=h('input',{'aria-label':'Match name',placeholder:'My custom match',maxLength:40});
  const field=(label:string,node:HTMLElement)=>h('label',{class:'online-field'},h('span',{},label),node);
  const nations=h('input',{type:'number',min:0,max:20,value:6,'aria-label':'AI nations'}),bots=h('input',{type:'number',min:0,max:20,value:4,'aria-label':'AI tribes'});
  const minutes=h('select',{'aria-label':'Match duration'},...[15,30,45,60].map(n=>h('option',{value:n,selected:n===30},`${n} minutes`)));
  const gold=h('select',{'aria-label':'Gold income'},...[1,1.5,2,3].map(n=>h('option',{value:n},`${n}×`)));
  const nukes=h('input',{type:'checkbox',checked:true}),privacy=h('input',{type:'checkbox'});
  const create=h('button',{onClick:()=>{
   if(!client?.connected)return;const recipe=worlds.find(w=>w.id===world.value)?.recipe;
   create.disabled=true;status.textContent=recipe?'Generating the shared world…':'Creating lobby…';
   client.send({type:'create',private:privacy.checked,settings:{name:name.value||recipe?.name||'Custom Earth',customWorld:recipe,numNations:Number(nations.value),numBots:Number(bots.value),maxTimerMinutes:Number(minutes.value),goldMultiplier:Number(gold.value),disableNukes:!nukes.checked}});
  }},'Create match');
  content.replaceChildren(field('Match name',name),field('World',world),h('p',{},'Saved World Forge maps appear here. Online worlds support up to 2048px. Everyone receives the same generated world.'),field('AI nations',nations),field('AI tribes',bots),field('Duration',minutes),field('Gold income',gold),field('Allow nukes',nukes),field('Private · join by code',privacy),h('div',{class:'online-actions'},create,h('button',{onClick:()=>{creating=false;client?.send({type:'list'});}},'Back')));
 }
 function list(rooms:any[]){
  if(room||creating||view==='leaderboard')return;
  if(view==='random'&&!queued){queued=true;status.textContent='Finding a random match…';client?.send({type:'queue'});return;}
  title.textContent=view==='custom'?'CUSTOM MATCHES':'ONLINE MATCHES';status.textContent=`Signed in as ${client?.profile?.name??'Commander'}`;
  const visible=rooms.filter(r=>view==='custom'?r.kind==='custom':true),code=h('input',{placeholder:'Room code',maxLength:8,'aria-label':'Room code'});
  content.replaceChildren(h('div',{class:'online-actions'},h('button',{onClick:()=>{view='random';queued=true;client?.send({type:'queue'});}},'Join random match'),h('button',{onClick:createForm},'Create custom match')),h('div',{class:'online-actions'},code,h('button',{onClick:()=>client?.send({type:'join',id:code.value.trim()})},'Join by code')),h('h3',{},`${visible.length} open ${view==='custom'?'custom ':''}matches`));
  if(!visible.length)content.append(h('p',{},'No matches waiting yet. Create one and invite friends.'));
  for(const r of visible)content.append(h('button',{class:'online-room',onClick:()=>client?.send({type:'join',id:r.id})},`${r.name} · ${r.members.filter((m:any)=>m.connected).length}/${r.capacity} players · ${r.settings.customWorld?.name??'Earth'}${r.countdownAt?' · Starting soon':''}`));
  content.append(h('div',{class:'online-actions'},h('button',{onClick:run(leaderboard)},'Leaderboard'),h('button',{onClick:run(async()=>{creating=true;const {history}=await api('/api/me');content.replaceChildren(h('h3',{},'Your matches'),...history.map((r:any)=>h('p',{},`${new Date(Number(r.ended)).toLocaleDateString()} · ${r.won?'Victory':'Defeat'} · ${Math.round(r.duration/60)} min · ${r.ranked?'Ranked':'Unranked'}`)),h('button',{onClick:()=>{creating=false;client?.send({type:'list'});}},'Back'));if(!history.length)content.prepend(h('p',{},'No completed matches yet.'));})},'Match history'),h('button',{onClick:run(async()=>{if(!neonAuth)await api('/api/logout',{});await signOut();client?.close();client=null;queued=false;authForm();})},'Sign out')));
 }
 function showRoom(r:any){
  room=r;creating=false;offset=r.serverTime-Date.now();const me=r.members.find((m:any)=>m.id===client?.profile?.id);title.textContent=r.name;
  status.textContent=`${r.private?'Private':'Public'} · ${r.kind==='random'?'Random matchmaking':'Custom · unranked'} · ${r.members.length}/${r.capacity} players`;
  const s=r.settings;
  content.replaceChildren(h('div',{class:'online-countdown',role:'timer'},r.countdownAt?'Starting soon…':'Waiting for players…'),h('p',{class:'online-rules'},`${s.customWorld?.name??'Earth'} · ${s.numNations} nations · ${s.numBots} tribes · ${s.goldMultiplier}× gold · ${s.disableNukes?'No nukes':'Nukes on'} · ${s.maxTimerMinutes} min`),h('p',{},'Invite friends with this room code'),h('div',{class:'online-code'},r.id),h('div',{class:'online-roster'},...r.members.map((m:any)=>h('div',{class:'online-player'},h('span',{class:'online-player-dot',style:`background:${m.color}`}),h('strong',{},m.name),h('span',{},`${m.id===r.host?'Host · ':''}${m.connected?(m.ready?'Ready':'Not ready'):'Disconnected'}`)))));
  if(r.phase==='lobby')content.append(h('div',{class:'online-actions'},...(r.kind==='custom'?[h('button',{onClick:()=>client?.send({type:'ready',ready:!me?.ready})},me?.ready?'Not ready':'Ready'),h('button',{disabled:r.host!==client?.profile?.id||r.members.length<1||r.members.some((m:any)=>!m.ready||!m.connected),onClick:()=>client?.send({type:'start'})},'Start match')]:[]),h('button',{onClick:()=>client?.send({type:'leave'})},'Leave')));
  if(r.kind==='random')content.append(h('p',{},'Starts 60 seconds after the first player joins. AI opponents fill empty player slots. Closing this window keeps you in the lobby.'));
 }
 function connect(token:string){
  if(!root.isConnected)return;client?.close();client=new OnlineClient(token);status.textContent='Connecting to the match server…';
  client.on(m=>{
   if(m.type==='welcome'||m.type==='rooms')list(m.rooms);
   if(m.type==='room')showRoom(m.room);
   if(m.type==='left'){room=null;queued=false;view=initialView==='random'?'lobby':initialView;client?.send({type:'list'});}
   if(m.type==='error'){status.textContent=m.message;content.querySelectorAll('button').forEach(b=>{if(b.textContent==='Create match')b.disabled=false;});}
   if(m.type==='connection')status.textContent=m.status;
   if(m.type==='aborted'){room=null;queued=false;view='lobby';status.textContent=m.message;client?.send({type:'list'});}
   if(m.type==='match'&&!started){started=true;root.remove();resume.remove();lobbies.delete(container);clearInterval(timer);clearInterval(poll);window.removeEventListener('borderwars-account-change',onAccountChange);onMatch(m.info,client!);}
  });
 }
 async function restore(){
  try{
   if(neonAuth){const user=await sessionUser();if(!user){authForm();return;}if(!serverURL){status.textContent=`Signed in as ${user.name}. The public match server has not been connected yet.`;content.replaceChildren(h('button',{onClick:()=>showAccount(container)},'Your account'));return;}const token=await authToken();if(!token)throw new Error('Your account is signed in, but a match access token could not be obtained. Retry, or sign out and back in.');connect(token);return;}
   if(!serverURL){status.textContent='Online play is awaiting server deployment. Single player is available now.';return;}
   const token=await authToken();if(token){await api('/api/me');connect(token);}else authForm();
  }catch(e){status.textContent=`Could not connect. Your saved sign-in has not been removed. ${e instanceof Error?e.message:String(e)}`;content.replaceChildren(h('button',{onClick:()=>void restore()},'Retry'),h('button',{onClick:authForm},'Sign in'));}
 }
 if(initialView==='leaderboard'){void leaderboard().catch(error);return root;}
 void restore();return root;
}

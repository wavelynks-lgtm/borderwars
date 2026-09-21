import {authToken} from '../auth/session';
import {PROTOCOL,applyCommand,stateDigest,type Command,type Frame,type MatchInfo} from './protocol';
import type {Game} from '../core/Game';
export const serverURL=(import.meta.env.VITE_MULTIPLAYER_URL as string|undefined)?.replace(/\/$/,'')??(location.hostname==='localhost'||location.hostname==='127.0.0.1'?'http://127.0.0.1:8787':'');
export class OnlineClient {
 private ws:WebSocket|null=null;private closed=false;private retry=0;private attempts=0;
 private queue:Frame[]=[];private received=0;private game:Game|null=null;private halted=false;
 private ratioTimer=0;private ratios=new Map<string,Command>();
 private listeners=new Set<(m:any)=>void>();
 verifiedTick=0;
 info:MatchInfo|null=null;connected=false;status='Connecting…';
 profile:{id:string;name:string}|null=null;
 constructor(private token:string){this.connect();}
 on(fn:(m:any)=>void){this.listeners.add(fn);return()=>this.listeners.delete(fn);}
 private emit(m:any){for(const fn of this.listeners)fn(m);}
 private connect(){
  if(this.closed)return;this.status='Connecting…';this.emit({type:'connection',status:this.status});
  const url=new URL('/ws',serverURL);url.protocol=url.protocol==='https:'?'wss:':'ws:';
  this.ws=new WebSocket(url);
  this.ws.onopen=()=>{void authToken().then(token=>{this.send({type:'auth',token:token??this.token,protocol:PROTOCOL});}).catch(()=>{this.status='Please sign in again';this.emit({type:'connection',status:this.status});});};
  this.ws.onmessage=e=>{
   const m=JSON.parse(e.data);
   if(m.type==='welcome'){this.profile=m.profile;this.connected=true;this.attempts=0;this.status='Connected';}
   if(m.type==='match'){
    if(this.info?.id===m.info.id){if(this.game)this.send({type:'loaded',tick:this.received});return;}
    this.info=m.info;this.received=0;this.queue=[];
   }
   if(m.type==='frames'){
    for(const frame of m.frames as Frame[]){if(frame.tick<this.received)continue;if(frame.tick!==this.received){this.halted=true;this.status='Connection out of sync. Reload to recover.';this.emit({type:'error',message:this.status});return;}this.queue.push(frame);this.received++;}
   }
   if(m.type==='aborted'){this.halted=true;this.status=m.message;}
   this.emit(m);
  };
  this.ws.onclose=e=>{
   this.connected=false;this.status=e.code===4009?'Match opened in another tab.':e.code===4001?'Session ended. Sign in again.':'Disconnected — reconnecting…';
   this.emit({type:'connection',status:this.status});
   if(!this.closed&&![4001,4009].includes(e.code))this.retry=window.setTimeout(()=>this.connect(),Math.min(10000,500*2**this.attempts++));
  };
  this.ws.onerror=()=>{};
 }
 send(data:unknown){if(this.ws?.readyState===WebSocket.OPEN)this.ws.send(JSON.stringify(data));}
 command(command:Command){if(this.halted)return;if(!this.connected){this.emit({type:'error',message:'Wait for the server connection'});return;}if(command.kind==='attackRatio'||command.kind==='troopRatio'){this.ratios.set(command.kind,command);if(!this.ratioTimer)this.ratioTimer=window.setTimeout(()=>{this.ratioTimer=0;for(const c of this.ratios.values())this.send({type:'command',command:c});this.ratios.clear();},200);return;}this.send({type:'command',command});}
 attach(game:Game){this.game=game;this.send({type:'loaded',tick:game.ticks});}
 advance():void{
  if(!this.game||this.halted)return;
  const deadline=performance.now()+8;let count=0;
  while(this.queue.length&&(count===0||performance.now()<deadline)&&count++<30){
   const frame=this.queue.shift()!;if(frame.tick!==this.game.ticks){this.failSync();return;}
   for(const {player,command} of frame.commands){const error=applyCommand(this.game,player,command);if(error){this.failSync();return;}}
   this.game.tick();
   if(frame.digest){if(stateDigest(this.game)!==frame.digest){this.failSync();return;}this.verifiedTick=this.game.ticks;}
  }
 }
 private failSync(){this.halted=true;this.status='Match state differs from the server. Reload to safely reconnect.';this.emit({type:'error',message:this.status});}
 close(){this.closed=true;clearTimeout(this.retry);clearTimeout(this.ratioTimer);this.ws?.close();}
}
export async function api(path:string,body?:unknown){
 if(!serverURL)throw new Error('Online server is not connected yet.');
 const token=['/api/matchmaking','/api/leaderboard','/api/store','/api/login','/api/register'].includes(path)?null:await authToken();
 const response=await fetch(serverURL+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});
 const data=await response.json();if(!response.ok)throw new Error(data.error??'Server unavailable');return data;
}

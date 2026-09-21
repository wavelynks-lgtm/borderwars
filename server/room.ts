import type {Cosmetics} from "../src/customization/cosmetics";
import type {Game} from '../src/core/Game';
import {DEFAULT_SETTINGS,MAX_HUMANS,clampAi,type GameSettings} from '../src/core/types';
import {createOnlineGame} from '../src/multiplayer/setup';
import {fillRandomRoster} from '../src/multiplayer/matchmaking';
import {applyCommand,stateDigest,type Command,type Frame,type MatchInfo,type Member} from '../src/multiplayer/protocol';
import type {GameMap} from '../src/core/GameMap';
export interface Peer {id:string;name:string;send:(data:unknown)=>void;connected:boolean;cosmetics?:Cosmetics}
export class Room {
 forfeited=new Set<string>();
 members:Member[]=[];peers=new Map<string,Peer>();phase:'lobby'|'loading'|'playing'|'finished'='lobby';
 game:Game|null=null;info:MatchInfo|null=null;frames:Frame[]=[];pending:{id:string;command:Command}[]=[];
 private nextSaveAt=0;
 private ready=new Set<string>();private saving=false;private ended=false;
 kind:'random'|'custom'='custom';name='Custom Earth';countdownAt=0;settings:GameSettings={...DEFAULT_SETTINGS,seed:Math.floor(Math.random()*2**30),numNations:0,numBots:19,spawnPhaseSeconds:15,maxTimerMinutes:30,randomSpawn:true,devMode:false,genericAi:true};mapURL='/data/online-earth.bin.gz';
 created=Date.now();lastActive=Date.now();loadingAt=0;finishedAt=0;
 constructor(readonly id:string,public host:string,readonly privateRoom:boolean,private mapFactory:()=>GameMap,private mapHash:string,private onFinish:(r:Room)=>Promise<void>){ }
 summary(){return {id:this.id,host:this.host,private:this.privateRoom,phase:this.phase,kind:this.kind,name:this.name,settings:this.settings,countdownAt:this.countdownAt,serverTime:Date.now(),members:this.members.map(m=>({...m,connected:!!this.peers.get(m.id)?.connected})),capacity:MAX_HUMANS};}
 broadcast(data:unknown){for(const p of this.peers.values())if(p.connected)p.send(data);}
 update(){this.broadcast({type:'room',room:this.summary()});}
 join(peer:Peer){
  if(this.forfeited.has(peer.id))throw new Error('You have left this match');
  const existing=this.members.find(m=>m.id===peer.id);
  if(!existing){if(this.phase!=='lobby')throw new Error('Match already started');if(this.members.length>=MAX_HUMANS)throw new Error('Room is full');
   if(this.kind==='custom')this.countdownAt=0;
   const colors=['#ff4d6d','#55b8ff','#f8d35e','#a780ff','#62da9b','#f69b52','#ee79cf','#83d9dd'];
   const requested=peer.cosmetics?.color??colors[this.members.length];const color=this.members.some(m=>m.color.toLowerCase()===requested.toLowerCase())?(colors.find(c=>!this.members.some(m=>m.color===c))??colors[this.members.length]):requested;
   this.members.push({id:peer.id,name:peer.name,color,cosmetics:peer.cosmetics?{...peer.cosmetics,color}:undefined,playerId:0,ready:false,connected:true});}
  if(this.kind==='random'){const m=this.members.find(m=>m.id===peer.id);if(m)m.ready=true;}
  this.ready.delete(peer.id);
  this.peers.set(peer.id,peer);this.lastActive=Date.now();this.reconcileCountdown();this.update();
  if(this.info)peer.send({type:'match',info:this.info,resume:true});
 }
 leave(id:string){this.ready.delete(id);const p=this.peers.get(id);if(p)p.connected=false;
  if(this.phase==='lobby'){this.members=this.members.filter(m=>m.id!==id);this.peers.delete(id);}
  if(this.phase==='lobby'&&this.kind==='custom')this.countdownAt=0;
  if(this.phase==='lobby'&&id===this.host)this.host=this.members[0]?.id??'';
  this.reconcileCountdown();this.update();}
 reconcileCountdown(){if(this.kind!=='random'||this.phase!=='lobby')return;const n=this.members.filter(m=>this.peers.get(m.id)?.connected).length;if(n<1)this.countdownAt=0;else if(!this.countdownAt)this.countdownAt=Date.now()+60000;}
 setReady(id:string,on:boolean){if(this.phase!=='lobby'||this.kind==='random')return;const m=this.members.find(m=>m.id===id);if(m)m.ready=on;if(!on)this.countdownAt=0;this.update();}
 requestStart(id:string){
  if(id!==this.host||this.phase!=='lobby')throw new Error('Only the host can start the lobby');
  if(this.members.length<1||this.members.some(m=>!m.ready||!this.peers.get(m.id)?.connected))throw new Error('At least one connected player must be ready');
  if(!this.countdownAt)this.countdownAt=Date.now()+5000;this.update();
 }
 async start(id:string){
  if(id!==this.host||this.phase!=='lobby')throw new Error('Only the host can start the lobby');
  if(this.members.length<1||this.members.some(m=>!m.ready||!this.peers.get(m.id)?.connected))throw new Error('At least one connected player must be ready');
  this.phase='loading';this.loadingAt=Date.now();this.update();
  try{
   // Preserve each preset's AI population while filling vacant human slots.
   // Send these final settings to every client for deterministic simulation.
   const settings={...this.settings};
   if(this.kind==='random')Object.assign(settings,fillRandomRoster(settings,this.members.length));
   else{
    const configured=1+settings.numNations+settings.numBots;
    const total=Math.max(this.members.length,configured,this.members.length===1&&configured<=1?2:configured);
    Object.assign(settings,clampAi(total-this.members.length,this.members.length),{genericAi:true});
   }
   this.settings=settings;
   this.game=await createOnlineGame(this.mapFactory(),settings,this.members,this.members[0].id);
   if(this.phase!=='loading')return;
   this.info={id:this.id,settings,members:this.members,mapHash:this.mapHash,mapURL:this.mapURL};
   this.broadcast({type:'match',info:this.info});
  }catch(e){this.phase='lobby';this.game=null;this.update();throw e;}
 }
 loaded(id:string,fromTick:number){
  if(!this.game||!Number.isInteger(fromTick)||fromTick<0||fromTick>this.frames.length)return;
  const peer=this.peers.get(id);if(!peer)return;
  for(let i=fromTick;i<this.frames.length;i+=100)peer.send({type:'frames',frames:this.frames.slice(i,i+100)});
  this.ready.add(id);peer.send({type:'synced',tick:this.game.ticks});
  if(this.phase==='loading'&&this.members.every(m=>this.ready.has(m.id))){this.phase='playing';this.update();}
 }
 enqueue(id:string,command:Command){if(this.phase!=='playing'||!this.ready.has(id)||this.pending.length>=128)throw new Error('Match is not ready');this.pending.push({id,command});}
 tick(){
  if(this.phase==='lobby'&&this.countdownAt&&Date.now()>=this.countdownAt){this.countdownAt=0;void this.start(this.host).catch(()=>{this.reconcileCountdown();this.update();});return;}
  if(this.phase==='loading'&&Date.now()-this.loadingAt>120000){this.abort('A player did not finish loading. Match cancelled.');return;}
  if(this.phase!=='playing'||!this.game)return;
  const g=this.game,frame:Frame={tick:g.ticks,commands:[]};
  for(const {id,command} of this.pending.splice(0)){
   const player=this.members.find(m=>m.id===id)?.playerId??0;
   const error=applyCommand(g,player,command);
   if(error)this.peers.get(id)?.send({type:'error',message:error});else frame.commands.push({player,command});
  }
  g.tick();g.events.length=0;if(g.ticks%10===0)frame.digest=stateDigest(g);
  this.frames.push(frame);for(const [id,peer] of this.peers)if(peer.connected&&this.ready.has(id))peer.send({type:'frames',frames:[frame]});
  if(g.winner){this.phase='finished';this.finishedAt=Date.now();this.update();void this.save();}
 }
 async save(){if(this.saving||this.ended||Date.now()<this.nextSaveAt)return;this.saving=true;try{await this.onFinish(this);this.ended=true;this.broadcast({type:'result',message:'Match saved. View your results in match history.'});}catch(e){this.nextSaveAt=Date.now()+10000;console.error('Result save failed',e);this.broadcast({type:'error',message:'Results are waiting for the database. Retrying shortly.'});}finally{this.saving=false;}}
 abort(message:string){this.phase='finished';this.finishedAt=Date.now();this.broadcast({type:'aborted',message});}
}

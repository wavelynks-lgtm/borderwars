import {createAuthenticator} from './auth.mjs';
import {Worker} from 'node:worker_threads';
import {customMatch,randomMatch} from '../src/multiplayer/matchmaking.ts';
import {Commerce} from "./commerce.mjs";
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash,randomBytes} from 'node:crypto';
import {WebSocketServer} from 'ws';
import {Store} from './store.mjs';
import {Room} from './room.ts';
import {decodeMap} from '../src/multiplayer/map.ts';
import {PROTOCOL,validCommand} from '../src/multiplayer/protocol.ts';

const port=Number(process.env.PORT??8787);
const origins=new Set((process.env.ALLOWED_ORIGINS??'http://127.0.0.1:4174,http://localhost:4174,http://127.0.0.1:5175,http://localhost:5175').split(',').map(s=>s.trim()));
if(process.env.NODE_ENV==='production'&&!process.env.DATABASE_URL)throw new Error('Production requires DATABASE_URL: local disks on free hosting are ephemeral');
const packed=await readFile(new URL('../public/data/online-earth.bin.gz',import.meta.url));
const mapHash=createHash('sha256').update(packed).digest('hex');
const raw=gunzipSync(packed);const mapFactory=()=>decodeMap(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));
const store=new Store();await store.init();
const authenticate=createAuthenticator(store);
const commerce=new Commerce(store);await commerce.init();
const rooms=new Map(),sockets=new Map(),limits=new Map();
const maxRooms=Number(process.env.MAX_ROOMS??4);
function limit(key,count,ms){const now=Date.now();let l=limits.get(key);if(!l||now>l.until){l={n:0,until:now+ms};limits.set(key,l);}return ++l.n<=count;}
function reply(res,status,data){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(text.length>4096)throw new Error('Request too large');}return JSON.parse(text||'{}');}
const bearer=req=>req.headers.authorization?.replace(/^Bearer /,'')??'';
const server=http.createServer(async(req,res)=>{
 const origin=req.headers.origin;if(origin&&!origins.has(origin)){reply(res,403,{error:'Origin not allowed'});return;}
 if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');}
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
 const path=new URL(req.url,'http://localhost').pathname,ip=req.socket.remoteAddress??'unknown';
 if(path==='/api/payments/webhook'&&req.method==='POST'){
  try{const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>262144)throw new Error('Payload too large');chunks.push(c);}await commerce.webhook(Buffer.concat(chunks),req.headers['stripe-signature']);reply(res,200,{received:true});}
  catch(e){console.error('Payment webhook rejected:',e.message);reply(res,400,{error:'Webhook rejected'});}return;
 }
 try{
  if(!limit('http:'+ip,120,60000)){reply(res,429,{error:'Too many requests. Try again shortly.'});return;}
  if(path==='/health'){reply(res,200,{ok:true,protocol:PROTOCOL,rooms:rooms.size});return;}
  if(path==='/data/online-earth.bin.gz'){res.writeHead(200,{'Content-Type':'application/octet-stream','Cache-Control':'public,max-age=300'});res.end(packed);return;}
  if(path==='/api/register'||path==='/api/login'){
   if(req.method!=='POST'){reply(res,405,{error:'POST required'});return;}
   if(!limit('auth:'+ip,10,60000)){reply(res,429,{error:'Too many login attempts. Wait a minute.'});return;}
   const b=await body(req);reply(res,200,await (path.endsWith('register')?store.register(b.username,b.password):store.login(b.username,b.password)));return;
  }
  if(path==='/api/matchmaking'){const open=list();reply(res,200,{rooms:open,randomPlayers:open.filter(r=>r.kind==='random').reduce((n,r)=>n+r.members.filter(m=>m.connected).length,0),customMatches:open.filter(r=>r.kind==='custom').length,serverTime:Date.now()});return;}
  if(path.startsWith('/data/rooms/')){const id=path.slice('/data/rooms/'.length).replace(/\.bin\.gz$/,'');const r=rooms.get(id);if(!r?.packed){reply(res,404,{error:'World unavailable'});return;}res.writeHead(200,{'Content-Type':'application/octet-stream','Cache-Control':'no-store'});res.end(r.packed);return;}
  if(path==='/api/store'){reply(res,200,{products:await commerce.catalog()});return;}
  if(path==='/api/leaderboard'){reply(res,200,{entries:await store.leaderboard()});return;}
  const profile=await authenticate(bearer(req));if(!profile){reply(res,401,{error:'Please sign in'});return;}
  if(path==='/api/me'){reply(res,200,{profile,history:await store.history(profile.id),entitlements:await commerce.entitlements(profile.id),cosmetics:await commerce.appearance(profile.id)});return;}
  if(path==='/api/cosmetics'&&req.method==='POST'){reply(res,200,{cosmetics:await commerce.saveAppearance(profile.id,await body(req))});return;}
  if(path==='/api/checkout'&&req.method==='POST'){if(!limit('checkout:'+profile.id,4,60000)){reply(res,429,{error:'Please wait before trying checkout again'});return;}const b=await body(req);reply(res,200,await commerce.checkout(profile,b.product,b.requestId));return;}
  if(path==='/api/logout'&&req.method==='POST'){await store.logout(bearer(req));sockets.get(profile.id)?.close(4001,'Signed out');reply(res,200,{ok:true});return;}
  reply(res,404,{error:'Not found'});
 }catch(e){console.error('API request failed:',e.message);reply(res,400,{error:/password|Name|name|taken|characters|Request too large/.test(e.message)?e.message:'Request failed. Please try again.'});}
});
const wss=new WebSocketServer({noServer:true,maxPayload:4096,perMessageDeflate:false});
server.on('upgrade',(req,socket,head)=>{
 if(!origins.has(req.headers.origin)||new URL(req.url,'http://localhost').pathname!=='/ws'||wss.clients.size>=100||!limit('ws:'+req.socket.remoteAddress,20,60000)){socket.destroy();return;}
 wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
});
function list(){return [...rooms.values()].filter(r=>!r.privateRoom&&r.phase==='lobby').map(r=>r.summary());}
let preparing=0;
async function createRoom(profile,kind,isPrivate,input){
 if([...rooms.values()].filter(r=>r.phase!=='finished').length+preparing>=maxRooms)throw new Error('Server is full. Join an existing lobby or try again later.');
 const seed=randomBytes(4).readUInt32LE(0),config=kind==='random'?randomMatch(seed):customMatch(input);
 const id=randomBytes(4).toString('hex').toUpperCase();let factory=mapFactory,hash=mapHash,customPacked;
 preparing++;
 try{
  if(config.recipe){
   customPacked=await new Promise((resolve,reject)=>{const worker=new Worker(new URL('./generated-map.mjs',import.meta.url),{workerData:config.recipe});const timeout=setTimeout(()=>{void worker.terminate();reject(new Error('World generation timed out'));},60000);worker.once('message',data=>{clearTimeout(timeout);resolve(Buffer.from(data));});worker.once('error',e=>{clearTimeout(timeout);reject(e);});worker.once('exit',code=>{clearTimeout(timeout);if(code!==0)reject(new Error('World generation failed'));});});
   hash=createHash('sha256').update(customPacked).digest('hex');const decoded=gunzipSync(customPacked);factory=()=>decodeMap(decoded.buffer.slice(decoded.byteOffset,decoded.byteOffset+decoded.byteLength));
  }
  const r=new Room(id,profile.id,isPrivate,factory,hash,async r=>{
   const winner=r.members.find(p=>p.playerId===r.game.winner?.smallID)?.id??null;
   const ranked=r.kind==='random'&&!r.privateRoom&&r.members.length>=2&&r.game.ticks>=3000;
   await store.finish(r.id,winner,Math.floor(r.game.ticks/10),ranked,r.members.map(m=>({id:m.id,land:r.game.player(m.playerId)?.landArea??0})));
  });
  r.kind=kind;r.name=config.name;r.settings={...config.settings,seed};
  if(customPacked){r.packed=customPacked;r.mapURL='/data/rooms/'+id+'.bin.gz';}
  rooms.set(id,r);return r;
 }finally{preparing--;}
}
function send(ws,data){if(ws.readyState===1){if(ws.bufferedAmount>4*1024*1024){ws.close(4008,'Connection too slow');return;}ws.send(JSON.stringify(data));}}
wss.on('connection',(ws,req)=>{
 let profile=null,room=null,busy=Promise.resolve(),alive=true;
 const authTimeout=setTimeout(()=>{if(!profile)ws.close(4001,'Sign in required');},10000);
 ws.on('pong',()=>{alive=true;});ws.checkAlive=()=>{if(!alive){ws.terminate();return;}alive=false;ws.ping();};
 ws.on('message',data=>{busy=busy.then(async()=>{
  if(!limit('message:'+req.socket.remoteAddress,100,1000)){ws.close(4008,'Too many messages');return;}
  let m;try{m=JSON.parse(data.toString());}catch{ws.close(4002,'Invalid message');return;}
  try{
   if(!profile){
    if(m.type!=='auth'||m.protocol!==PROTOCOL)throw new Error('Game version mismatch. Reload.');
    profile=await authenticate(m.token);if(profile)profile.cosmetics=await commerce.appearance(profile.id);if(!profile)throw new Error('Please sign in again');
    clearTimeout(authTimeout);sockets.get(profile.id)?.close(4009,'Opened in another tab');sockets.set(profile.id,ws);
    send(ws,{type:'welcome',profile,rooms:list()});
    for(const r of rooms.values())if(r.members.some(p=>p.id===profile.id)&&!r.forfeited.has(profile.id)&&(r.phase==='loading'||r.phase==='playing')){room=r;room.join({id:profile.id,name:profile.name,cosmetics:profile.cosmetics,send:d=>send(ws,d),connected:true});break;}
    return;
   }
   const peer=()=>({id:profile.id,name:profile.name,cosmetics:profile.cosmetics,send:d=>send(ws,d),connected:true});
   switch(m.type){
   case 'list':send(ws,{type:'rooms',rooms:list()});break;
   case 'queue':{
    if(room)throw new Error('Leave your current room first');
    room=[...rooms.values()].find(r=>r.kind==='random'&&r.phase==='lobby'&&r.members.length<8)??await createRoom(profile,'random',false,{});
    room.join(peer());break;
   }
   case 'create':{
    if(room)throw new Error('Leave your current room first');
    if(!limit('create:'+profile.id,6,60000))throw new Error('Please wait before creating another match');
    room=await createRoom(profile,'custom',m.private===true,m.settings);if(ws.readyState!==1){rooms.delete(room.id);room=null;break;}room.join(peer());break;
   }
   case 'join':{
    if(room)throw new Error('Leave your current room first');
    const r=rooms.get(String(m.id).toUpperCase());if(!r)throw new Error('Room not found');r.join(peer());room=r;break;
   }
   case 'leave':
    if(room?.phase==='lobby'){room.leave(profile.id);if(!room.members.length)rooms.delete(room.id);room=null;send(ws,{type:'left'});}else if(room){
     if(room.phase==='playing')room.pending.push({id:profile.id,command:{kind:'surrender'}});
     room.forfeited.add(profile.id);room.leave(profile.id);
     if(room.phase==='loading'||room.members.every(m=>room.forfeited.has(m.id))){rooms.delete(room.id);room.abort('All players left or a player left during loading. Match cancelled.');}
     room=null;send(ws,{type:'left'});
    }break;
   case 'ready':room?.setReady(profile.id,m.ready===true);break;
   case 'start':room?.requestStart(profile.id);break;
   case 'loaded':room?.loaded(profile.id,m.tick);break;
   case 'command':if(!validCommand(m.command))throw new Error('Invalid order');if(!room)throw new Error('Join a match first');if(!limit('orders:'+profile.id,12,1000))throw new Error('Too many orders');room.enqueue(profile.id,m.command);break;
   case 'ping':send(ws,{type:'pong',at:m.at});break;
   default:throw new Error('Unknown request');
   }
  }catch(e){send(ws,{type:'error',message:e.message});}
 }).catch(e=>{console.error('Socket failure',e);ws.close(1011,'Server error');});});
 ws.on('close',()=>{clearTimeout(authTimeout);if(profile&&sockets.get(profile.id)===ws){sockets.delete(profile.id);room?.leave(profile.id);if(room?.phase==='lobby'&&!room.members.length)rooms.delete(room.id);}});
 ws.on('error',()=>{});
});
const timer=setInterval(()=>{for(const room of rooms.values()){
 try{room.tick();if(room.phase==='finished'&&room.game?.winner)void room.save();
 const connected=[...room.peers.values()].some(p=>p.connected);if(connected)room.lastActive=Date.now();
 if((!connected&&Date.now()-room.lastActive>120000)||(room.phase==='finished'&&Date.now()-room.finishedAt>120000)){room.abort('Room closed');rooms.delete(room.id);}
 }catch(e){console.error('Match failed',e);room.abort('Match interrupted. No rankings awarded.');}
}},100);
const heartbeat=setInterval(()=>{for(const ws of wss.clients)ws.checkAlive?.();for(const [key,l] of limits)if(Date.now()>l.until)limits.delete(key);},30000);
server.listen(port,'0.0.0.0',()=>console.log(`BorderWars multiplayer listening on ${port}`));
async function shutdown(){clearInterval(timer);clearInterval(heartbeat);for(const r of rooms.values())r.abort('Server restarting. Unfinished matches do not affect rankings.');for(const ws of wss.clients)ws.close(1012,'Server restarting');wss.close();server.close();await store.close();}
process.once('SIGTERM',()=>void shutdown());process.once('SIGINT',()=>void shutdown());

import {DatabaseSync} from 'node:sqlite';
import pg from 'pg';
import {Pool as NeonPool,neonConfig} from '@neondatabase/serverless';
import WebSocket from 'ws';
import {randomBytes,randomUUID,scrypt as scryptCallback,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
const scrypt=promisify(scryptCallback);
neonConfig.webSocketConstructor=WebSocket;
const hash=t=>createHash('sha256').update(t).digest('hex');
export class Store {
 writes=Promise.resolve();
 constructor(url=process.env.DATABASE_URL,path=process.env.SQLITE_PATH??'.local/multiplayer.sqlite'){
  if(url){const Pool=new URL(url).hostname.endsWith('.neon.tech')?NeonPool:pg.Pool;this.pool=new Pool({connectionString:url,max:3,connectionTimeoutMillis:15000});}
  else{mkdirSync(dirname(path),{recursive:true});this.sqlite=new DatabaseSync(path);this.sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');}
 }
 async query(sql,values=[]){
  if(this.pool)return this.pool.query(sql,values);
  const params=[];sql=sql.replace(/\$(\d+)/g,(_,n)=>{params.push(values[Number(n)-1]);return '?';});
  const stmt=this.sqlite.prepare(sql);return /^\s*(SELECT|WITH)/i.test(sql)?{rows:stmt.all(...params)}:{rows:[],rowCount:stmt.run(...params).changes};
 }
 async init(){for(const sql of [
  'CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password TEXT NOT NULL, created BIGINT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), expires BIGINT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS matches(id TEXT PRIMARY KEY, ended BIGINT NOT NULL, winner TEXT, duration INTEGER NOT NULL, ranked INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS results(match_id TEXT NOT NULL REFERENCES matches(id), account_id TEXT NOT NULL REFERENCES accounts(id), won INTEGER NOT NULL, land REAL NOT NULL, PRIMARY KEY(match_id,account_id))',
  'CREATE INDEX IF NOT EXISTS results_account ON results(account_id)',
  'CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires)'
 ])await this.query(sql);await this.query('DELETE FROM sessions WHERE expires < $1',[Date.now()]);}
 async register(username,password){
  if(typeof username!=='string'||!/^[a-zA-Z0-9_]{3,20}$/.test(username))throw new Error('Name must be 3–20 letters, numbers or underscores');
  if(typeof password!=='string'||password.length<10||password.length>128)throw new Error('Use a password of 10–128 characters');
  const salt=randomBytes(16).toString('hex'),derived=await scrypt(password,salt,64),id=randomUUID();
  try{await this.query('INSERT INTO accounts(id,username,name,password,created) VALUES($1,$2,$3,$4,$5)',[id,username.toLowerCase(),username,`${salt}:${derived.toString('hex')}`,Date.now()]);}
  catch(e){if(e.code==='23505'||e.code==='ERR_SQLITE_ERROR')throw new Error('That name is already taken');throw e;}
  return this.session({id,name:username});
 }
 async login(username,password){
  if(typeof username!=='string'||typeof password!=='string'||password.length>128)throw new Error('Invalid name or password');
  const a=(await this.query('SELECT * FROM accounts WHERE username=$1',[username.toLowerCase()])).rows[0];
  const [salt,key]=(a?.password??'00000000000000000000000000000000:'+ '00'.repeat(64)).split(':');
  const actual=await scrypt(password,salt,64);if(!a||!timingSafeEqual(actual,Buffer.from(key,'hex')))throw new Error('Invalid name or password');
  return this.session(a);
 }
 async session(a){const token=randomBytes(32).toString('hex');await this.query('INSERT INTO sessions(token,account_id,expires) VALUES($1,$2,$3)',[hash(token),a.id,Date.now()+30*86400000]);return {token,profile:{id:a.id,name:a.name}};}
 async auth(token){if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return null;return (await this.query('SELECT a.id,a.name FROM accounts a JOIN sessions s ON s.account_id=a.id WHERE s.token=$1 AND s.expires>$2',[hash(token),Date.now()])).rows[0]??null;}
 async logout(token){await this.query('DELETE FROM sessions WHERE token=$1',[hash(token)]);}
 async finish(id,winner,duration,ranked,results){
  const operation=this.writes.then(()=>this.writeFinish(id,winner,duration,ranked,results));
  this.writes=operation.catch(()=>{});return operation;
 }
 async writeFinish(id,winner,duration,ranked,results){
  // One transaction and a unique match id prevent duplicated wins after retries.
  const client=this.pool?await this.pool.connect():null;
  const q=client?client.query.bind(client):this.query.bind(this);
  try{await q('BEGIN');const inserted=await q('INSERT INTO matches(id,ended,winner,duration,ranked) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING',[id,Date.now(),winner,duration,ranked?1:0]);
   if(inserted.rowCount)for(const r of results)await q('INSERT INTO results(match_id,account_id,won,land) VALUES($1,$2,$3,$4)',[id,r.id,r.id===winner?1:0,r.land]);
   await q('COMMIT');
  }catch(e){await q('ROLLBACK');throw e;}finally{client?.release();}
 }
 async leaderboard(){return (await this.query(`SELECT a.name, COUNT(*) AS games, SUM(r.won) AS wins, MAX(r.land) AS best_land FROM results r JOIN accounts a ON a.id=r.account_id JOIN matches m ON m.id=r.match_id WHERE m.ranked=1 GROUP BY a.id,a.name ORDER BY SUM(r.won) DESC, COUNT(*) DESC, a.name ASC LIMIT 100`)).rows;}
 async history(id){return (await this.query('SELECT m.id,m.ended,m.duration,m.ranked,r.won,r.land FROM matches m JOIN results r ON r.match_id=m.id WHERE r.account_id=$1 ORDER BY m.ended DESC LIMIT 20',[id])).rows;}
 async close(){if(this.pool)await this.pool.end();else this.sqlite.close();}
}

import {createRemoteJWKSet,jwtVerify} from 'jose';
import {createHash,randomBytes} from 'node:crypto';
export function createAuthenticator(store,env=process.env,keys){
 const base=env.NEON_AUTH_BASE_URL;
 const jwks=base?(keys??createRemoteJWKSet(new URL(env.NEON_AUTH_JWKS_URL??`${base.replace(/\/$/,'')}/.well-known/jwks.json`))):null;
 return async token=>{
  if(typeof token!=='string'||token.length>16384)return null;
  if(/^[a-f0-9]{64}$/.test(token))return store.auth(token);
  if(!jwks)return null;
  let payload;
  try{({payload}=await jwtVerify(token,jwks,{issuer:new URL(base).origin,audience:new URL(base).origin,algorithms:['EdDSA'],maxTokenAge:'15m',clockTolerance:5}));}catch{return null;}
  if(!payload.sub||payload.sub.length>256||payload.banned===true||payload.role!=='authenticated')return null;
  const id=`neon:${payload.sub}`,username=`neon_${createHash('sha256').update(payload.sub).digest('hex')}`,name=typeof payload.name==='string'?payload.name.trim().slice(0,20)||'Commander':'Commander';
  // Identity is the verified provider subject, never a matching display name or email.
  await store.query('INSERT INTO accounts(id,username,name,password,created) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET name=excluded.name',[id,username,name,randomBytes(32).toString('hex'),Date.now()]);
  return {id,name};
 };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,SignJWT,createLocalJWKSet,exportJWK} from 'jose';
import {createAuthenticator} from '../server/auth.mjs';
import {Store} from '../server/store.mjs';
test('Neon identity requires verified issuer, audience, role and expiry; same names never merge accounts',async()=>{
 const store=new Store(undefined,':memory:');await store.init();const {privateKey,publicKey}=await generateKeyPair('EdDSA');
 const jwk=await exportJWK(publicKey);jwk.kid='test';const origin='https://auth.example.test';const auth=createAuthenticator(store,{NEON_AUTH_BASE_URL:origin+'/db/auth'},createLocalJWKSet({keys:[jwk]}));
 const token=(subject,claims={},issuer=origin,audience=origin,expiry='15m')=>new SignJWT({name:'Commander',role:'authenticated',...claims}).setProtectedHeader({alg:'EdDSA',kid:'test'}).setSubject(subject).setIssuer(issuer).setAudience(audience).setIssuedAt().setExpirationTime(expiry).sign(privateKey);
 try{
  const a=await auth(await token('alice')),b=await auth(await token('bob'));assert.notEqual(a.id,b.id);assert.equal((await auth(await token('alice'))).id,a.id);
  assert.equal(await auth(await token('alice',{},'https://wrong.test')),null);assert.equal(await auth(await token('alice',{},origin,'other')),null);assert.equal(await auth(await token('alice',{role:'anonymous'})),null);assert.equal(await auth(await token('alice',{banned:true})),null);assert.equal(await auth(await token('alice',{},origin,origin,'-1h')),null);assert.equal(await auth('forged'),null);
  const legacy=await store.register('LegacyPlayer','long test password');assert.equal((await auth(legacy.token)).id,legacy.profile.id);
 }finally{await store.close();}
});

const base=process.env.NEON_AUTH_BASE_URL??'https://ep-polished-morning-b2lw6jvf.neonauth.c-6.eu-central-1.aws.neon.tech/neondb/auth';
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(!['GET','POST'].includes(req.method)){res.statusCode=405;res.end();return;}
 const incoming=new URL(req.url,'https://borderwars.vercel.app');const path=incoming.searchParams.get('path')??'';
 if(!/^[a-zA-Z0-9_/-]+$/.test(path)||path.includes('..')){res.statusCode=400;res.end('Invalid auth path');return;}
 const target=new URL(base.replace(/\/$/,'')+'/'+path);for(const [key,value] of incoming.searchParams)if(key!=='path')target.searchParams.append(key,value);
 // Do not forward Vercel's Host/X-Forwarded-Host headers to Neon's gateway.
 const headers={accept:'application/json'};
 for(const key of ['cookie','content-type','origin','referer'])if(typeof req.headers[key]==='string')headers[key]=req.headers[key];
 try{
  const response=await fetch(target,{method:req.method,headers,redirect:'manual',body:req.method==='POST'?(typeof req.body==='string'?req.body:JSON.stringify(req.body??{})):undefined,signal:AbortSignal.timeout(15000)});
  res.statusCode=response.status;res.setHeader('Content-Type',response.headers.get('content-type')??'application/json');
  const cookies=response.headers.getSetCookie();if(cookies.length)res.setHeader('Set-Cookie',cookies.map(cookie=>cookie.replace(/;\s*Domain=[^;]+/ig,'').replace(/;\s*Path=[^;]+/ig,'; Path=/')));
  const jwt=response.headers.get('set-auth-jwt');if(jwt)res.setHeader('set-auth-jwt',jwt);
  res.end(await response.text());
 }catch{res.statusCode=502;res.end(JSON.stringify({message:'Sign-in service temporarily unavailable. Please retry.'}));}
}

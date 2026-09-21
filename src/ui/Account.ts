import {h} from './dom';
import {neonAuth,sessionUser,signOut,accountChanged} from '../auth/session';
export function showAccount(container:HTMLElement,onSignedIn:()=>void=()=>{}){
 const status=h('p',{role:'status'},'Restoring your account…'),body=h('div',{});
 const root=h('div',{class:'online-overlay'},h('section',{class:'online-panel'},h('div',{class:'online-heading'},h('h2',{},'YOUR ACCOUNT'),h('button',{onClick:()=>root.remove()},'Close')),status,body));container.append(root);
 const fail=(e:unknown)=>{status.textContent=e instanceof Error?e.message:String(e);};
 const run=(fn:()=>Promise<void>)=>async()=>{try{await fn();}catch(e){fail(e);}};
 const email=h('input',{type:'email',autocomplete:'email',placeholder:'Email address','aria-label':'Email address'}),password=h('input',{type:'password',autocomplete:'current-password',placeholder:'Password (10+ characters)',minLength:10,'aria-label':'Password'}),name=h('input',{placeholder:'Commander name',maxLength:20,'aria-label':'Commander name'});
 async function signedIn(){accountChanged();root.remove();onSignedIn();}
 function form(){
  status.textContent='Sign in with your Neon account for this game. Your session is restored when you return.';
  const submit=(register:boolean)=>run(async()=>{if(!email.validity.valid||!email.value)throw new Error('Enter a valid email address');status.textContent='Signing in…';const r=register?await neonAuth!.signUp.email({email:email.value.trim(),password:password.value,name:name.value.trim()||'Commander'}):await neonAuth!.signIn.email({email:email.value.trim(),password:password.value});if(r.error)throw new Error(r.error.message??'Sign-in failed');if(await sessionUser())await signedIn();else verify(true);});
  body.replaceChildren(name,email,password,h('div',{class:'online-actions'},h('button',{onClick:submit(false)},'Sign in'),h('button',{onClick:submit(true)},'Create account')),h('button',{onClick:run(async()=>{const r=await neonAuth!.emailOtp.sendVerificationOtp({email:email.value,type:'sign-in'});if(r.error)throw new Error(r.error.message??'Could not send code');verify();})},'Email me a sign-in code'));
 }
 function verify(verification=false){status.textContent='Check your email for a code. You can request a new sign-in code below.';const code=h('input',{placeholder:'Email code',autocomplete:'one-time-code','aria-label':'Email code'});body.replaceChildren(email,code,h('button',{onClick:run(async()=>{const r=verification?await neonAuth!.emailOtp.verifyEmail({email:email.value,otp:code.value}):await neonAuth!.signIn.emailOtp({email:email.value,otp:code.value});if(r.error)throw new Error(r.error.message??'Invalid code');if(verification){const login=await neonAuth!.signIn.email({email:email.value,password:password.value});if(login.error)throw new Error(login.error.message??'Please sign in');}await signedIn();})},'Verify & sign in'),h('button',{onClick:run(async()=>{const r=await neonAuth!.emailOtp.sendVerificationOtp({email:email.value,type:'sign-in'});if(r.error)throw new Error(r.error.message??'Could not send code');verification=false;status.textContent='A new sign-in code was sent.';})},'Send sign-in code'),h('button',{onClick:form},'Back'));}
 if(!neonAuth){status.textContent='Neon sign-in is not configured on this website yet.';return root;}
 void sessionUser().then(user=>{if(!root.isConnected)return;if(!user){form();return;}status.textContent=`Signed in as ${user.name}`;body.replaceChildren(h('p',{},user.email),h('button',{onClick:run(async()=>{await signOut();form();})},'Sign out'));}).catch(fail);
 return root;
}

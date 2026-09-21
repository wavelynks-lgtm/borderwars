import {createAuthClient} from '@neondatabase/auth';
import {BetterAuthVanillaAdapter} from '@neondatabase/auth/vanilla/adapters';
const url=(import.meta.env.VITE_NEON_AUTH_URL as string|undefined)??'/api/auth';
export const neonAuth=url?createAuthClient(new URL(url,location.origin).href,{adapter:BetterAuthVanillaAdapter({fetchOptions:{credentials:'include'}})}):null;
export const hasAccount=()=>!!neonAuth||!!localStorage.getItem('borderwars.session');
export async function sessionUser(){if(!neonAuth)return null;const result=await neonAuth.getSession();if(result.error)throw new Error(result.error.message??'Could not restore your account');return result.data?.user??null;}
export async function authToken(){if(!neonAuth)return localStorage.getItem('borderwars.session');const {data,error}=await neonAuth.token();if(error){if(error.status===401)return null;throw new Error(error.message??'Please sign in again');}return data?.token??null;}
export function accountChanged(){window.dispatchEvent(new Event('borderwars-account-change'));}
export async function signOut(){if(neonAuth){const r=await neonAuth.signOut();if(r.error)throw new Error(r.error.message??'Sign out failed');}localStorage.removeItem('borderwars.session');accountChanged();}

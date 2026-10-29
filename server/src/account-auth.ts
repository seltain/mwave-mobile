import {keyOk} from './guard.js';
export type MusicIdentity={kind:'legacy';id:string}|{kind:'account';id:string};
export class AuthUnavailable extends Error{}
/** Passwords and refresh tokens never reach the music service. No positive cache after revocation. */
export function accountAuth(options:{legacyKey:string;allowLegacy?:boolean;base?:string;fetch?:typeof fetch}){
 const base=options.base||'http://127.0.0.1:8782/account-api/v1';
 if(!/^http:\/\/127\.0\.0\.1:\d+\/account-api\/v1$/.test(base))throw Error('Account introspection must use loopback');
 return async(header:string|undefined):Promise<MusicIdentity|null>=>{
  if(options.allowLegacy!==false&&keyOk(header,options.legacyKey))return{kind:'legacy',id:'legacy'};
  if(!/^Bearer [A-Za-z0-9_-]{40,160}$/.test(header||''))return null;
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),2000);
  try{const r=await(options.fetch||fetch)(base+'/me',{headers:{Authorization:header!},signal:ctrl.signal});
   if(r.status===401||r.status===403)return null;if(!r.ok)throw new AuthUnavailable();
   const data=await r.json();if(!/^[a-f0-9-]{36}$/.test(data?.id))throw new AuthUnavailable();return{kind:'account',id:data.id};
  }catch(e){if(e instanceof AuthUnavailable)throw e;throw new AuthUnavailable('Account service unavailable');}finally{clearTimeout(timer);}
 };
}

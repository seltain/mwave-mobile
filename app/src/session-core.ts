import type {AccountInfo,AccountSession} from './pc/shared/accounts';import {randomUUID} from './pc/platform/crypto';
export interface SecretStore{get():Promise<string|null>;set(value:string):Promise<void>;delete():Promise<void>;}
/** Access stays in memory; refresh and identity are stored only through the OS secret store. */
export class MobileSessionStore {
 private session:AccountSession|null=null;private account:AccountInfo|null=null;private sequence=Promise.resolve();private epoch=0;private listeners=new Set<()=>void>();private state:{account:AccountInfo|null;generation:number;secure:boolean}={account:null,generation:0,secure:true};
 constructor(private secrets:SecretStore,readonly base='https://mwave.swiftsuper.online:8781/account-api/v1'){}
 snapshot=()=>this.state;
 subscribe=(cb:()=>void)=>{this.listeners.add(cb);return()=>{this.listeners.delete(cb);};};
 private emit(newGeneration=false){this.state={account:this.account,generation:this.state.generation+Number(newGeneration),secure:this.state.secure};this.listeners.forEach(cb=>cb());}
 async hydrate(){try{const value=await this.secrets.get();if(value){const s=JSON.parse(value) as AccountSession;if(!/^[a-f0-9-]{36}$/.test(s.account?.id||''))throw Error('Invalid identity');this.account=s.account;this.session=s.refresh?{...s,access:'',accessExpires:0}:null;}}catch{this.state={...this.state,secure:false};}this.emit();}
 async read(){return this.session;}
 async write(s:AccountSession){if(!this.account||s.account.id!==this.account.id)throw Error('Аккаунт изменился');this.session=s;const epoch=this.epoch;const {access,accessExpires,...persistent}=s;const payload=JSON.stringify(persistent);this.sequence=this.sequence.catch(()=>{}).then(async()=>{if(epoch!==this.epoch)return;try{await this.secrets.set(payload);}catch{this.state={...this.state,secure:false};}});await this.sequence;}
 async authenticate(login:string,password:string,inviteCode?:string){const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),15000);try{const response=await fetch(this.base+(inviteCode?'/auth/register':'/auth/login'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login:login.trim(),password,inviteCode,name:login.trim(),deviceId:this.session?.deviceId||randomUUID(),deviceName:'mwave на iPhone'}),signal:ctrl.signal});const result=await response.json();if(!response.ok)throw Error(result.message||'Не удалось войти');const s=result as AccountSession;if(!/^[a-f0-9-]{36}$/.test(s.account?.id||''))throw Error('Неверный ответ сервера');this.epoch++;this.account=s.account;await this.write(s);this.emit(true);return s.account;}catch(e){if(ctrl.signal.aborted)throw Error('Сервер не ответил вовремя');throw e;}finally{clearTimeout(timer);}}
 /** Revoked credentials do not erase the already open offline library. */
 async remove(){this.epoch++;this.session=null;const account=this.account;this.sequence=this.sequence.catch(()=>{}).then(async()=>{if(this.account?.id!==account?.id)return;try{if(account)await this.secrets.set(JSON.stringify({account,refresh:''}));else await this.secrets.delete();}catch{}});await this.sequence;}
 async logoutLocal(){this.epoch++;this.session=null;this.account=null;this.sequence=this.sequence.catch(()=>{}).then(()=>this.secrets.delete()).catch(()=>{});await this.sequence;this.emit(true);}
}

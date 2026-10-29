import type {AccountSession} from '../../shared/accounts';
export interface SessionStorage{read():Promise<AccountSession|null>;write(s:AccountSession):Promise<void>;remove():Promise<void>;}
export class AccountVault {
 constructor(private storage:SessionStorage,readonly accountId:string){}
 async read(_uid:number):Promise<AccountSession|null>{const s=await this.storage.read();return s?.account.id===this.accountId?s:null;}
 async write(_uid:number,s:AccountSession):Promise<boolean>{if(s.account.id!==this.accountId)throw Error('Аккаунт изменился');await this.storage.write(s);return true;}
 remove(_uid:number):void{void this.storage.read().then(s=>s?.account.id===this.accountId?this.storage.remove():undefined).catch(()=>undefined);}
}

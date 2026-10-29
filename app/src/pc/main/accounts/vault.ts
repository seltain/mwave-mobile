import type {AccountSession} from '../../shared/accounts';
export interface SessionStorage{read():Promise<AccountSession|null>;write(s:AccountSession):Promise<void>;remove():Promise<void>;}
export class AccountVault {
 private last:AccountSession|null=null;
 constructor(private storage:SessionStorage,readonly accountId:string){}
 async read(_uid:number):Promise<AccountSession|null>{const s=await this.storage.read();return this.last=s?.account.id===this.accountId?s:null;}
 async write(_uid:number,s:AccountSession):Promise<boolean>{if(s.account.id!==this.accountId)throw Error('Аккаунт изменился');await this.storage.write(s);this.last=s;return true;}
 remove(_uid:number):void{const expected=this.last;void this.storage.read().then(s=>s&&s===expected?this.storage.remove():undefined).catch(()=>undefined);}
}

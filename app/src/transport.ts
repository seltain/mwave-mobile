export type Authorization=(force?:boolean)=>Promise<Record<string,string>>;
let authorize:Authorization=async()=>{throw Error('Войдите в аккаунт mwave');};
export const setAuthorization=(provider:Authorization)=>{authorize=provider;};
export const authorization=(force=false)=>authorize(force);

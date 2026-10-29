// Mobile authenticates through the account service. Desktop local-password methods are never used.
export async function hashPassword(_password:string):Promise<string>{throw Error('Используйте вход в аккаунт mwave');}
export async function verifyPassword(_password:string,_hash:string):Promise<boolean>{return false;}

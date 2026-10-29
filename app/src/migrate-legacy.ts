import {importLegacy} from './legacy-import';
import {backupDatabaseAsync,openDatabaseSync,defaultDatabaseDirectory} from 'expo-sqlite';import * as FileSystem from 'expo-file-system/legacy';import type {Profile} from './profile';
/** Explicit, once per account; the legacy file is never used as the account database. */
export async function migrateLegacy(profile:Profile){if(profile.db.prepare("SELECT 1 FROM settings WHERE key='mobile.legacy.imported'").get())throw Error('Пробный профиль уже перенесён');
 const sourceFile=defaultDatabaseDirectory+'/mwave.db';const exists=await FileSystem.getInfoAsync(sourceFile);if(!exists.exists)throw Error('Пробного профиля на этом iPhone нет');
 const old=openDatabaseSync('mwave.db'),copyName='mwave-before-account-'+Date.now()+'.db',copy=openDatabaseSync(copyName);
 try{await backupDatabaseAsync({sourceDatabase:old,destDatabase:copy});if(copy.getFirstSync<{integrity_check:string}>('PRAGMA integrity_check')?.integrity_check!=='ok')throw Error('Копия не прошла проверку');
 return importLegacy(profile,{all:(query,...params)=>old.getAllSync(query,params)},copyName);
 }finally{copy.closeSync();old.closeSync();}}

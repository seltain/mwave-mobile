import type {DB} from './pc/main/profile/db';import {installSchema} from './pc/main/profile/db';
export type SqlValue=string|number|null;
export interface Sql {exec(sql:string):void;run(sql:string,...params:any[]):{changes:number;lastId:number};all<T>(sql:string,...params:any[]):T[];get<T>(sql:string,...params:any[]):T|undefined;close?():void;}
/** Same synchronous transaction boundaries on expo-sqlite and node:sqlite. */
export function desktopDb(sql:Sql):DB {
 let depth=0;
 function bind(query:string,args:unknown[]):[string,any[]]{
  const first=args[0];if(args.length===1&&first&&typeof first==='object'&&!Array.isArray(first)){
   const values:any[]=[];const record=first as Record<string,unknown>;
   const text=query.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|[@:$]([A-Za-z_][A-Za-z0-9_]*)/g,(token,key:string)=>{if(!key)return token;values.push(record[key]??null);return '?';});return [text,values];
  }return [query,args.map(v=>v===undefined?null:v)];
 }
 const db:DB={
  exec:q=>sql.exec(q),
  prepare:query=>({get:(...p)=>{const[q,a]=bind(query,p);return sql.get(q,...a);},all:(...p)=>{const[q,a]=bind(query,p);return sql.all(q,...a);},run:(...p)=>{const[q,a]=bind(query,p),r=sql.run(q,...a);return {changes:r.changes,lastInsertRowid:r.lastId};}}),
  pragma:(q,o)=>{const rows=sql.all<Record<string,unknown>>('PRAGMA '+q);return o?.simple?Object.values(rows[0]||{})[0]:rows[0];},
  transaction:fn=>(...args)=>{const n=depth++;sql.exec(n?'SAVEPOINT mobile_'+n:'BEGIN IMMEDIATE');try{const value=fn(...args);sql.exec(n?'RELEASE SAVEPOINT mobile_'+n:'COMMIT');return value;}catch(e){sql.exec(n?'ROLLBACK TO SAVEPOINT mobile_'+n:'ROLLBACK');if(n)sql.exec('RELEASE SAVEPOINT mobile_'+n);throw e;}finally{depth--; }},
  close:()=>sql.close?.(),
 };installSchema(db);return db;
}

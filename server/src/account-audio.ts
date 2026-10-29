import {randomBytes} from 'node:crypto';import {Readable} from 'node:stream';import type http from 'node:http';
type Entry={owner:string;url:string;expires:number;playlist:boolean;local:boolean};
/** Every playlist, encryption key and segment is account-bound. Provider credentials never go to clients. */
export class AccountAudio {
 private entries=new Map<string,Entry>();private ids=new Map<string,string>();
 constructor(private fetcher:typeof fetch=fetch,private now=Date.now){}
 private validRemote(url:string){const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.port||!/(^|\.)(sndcdn\.com|soundcloud\.cloud)$/.test(u.hostname))throw Error('Invalid audio CDN');return u.href;}
 register(owner:string,url:string,expires:number,playlist=false,local=false):string{
  if(local){if(!/^http:\/\/127\.0\.0\.1:\d+\/s\/[a-f0-9]{24}$/.test(url))throw Error('Invalid local stream');}else url=this.validRemote(url);
  const key=owner+'|'+url,previous=this.ids.get(key);if(previous&&this.entries.get(previous)!.expires>this.now()+30000)return '/account-s/'+previous;
  this.sweep();const id=randomBytes(18).toString('hex');this.entries.set(id,{owner,url,expires,playlist,local});this.ids.set(key,id);
  while(this.entries.size>4096){const first=this.entries.keys().next().value!;const old=this.entries.get(first)!;this.entries.delete(first);if(this.ids.get(old.owner+'|'+old.url)===first)this.ids.delete(old.owner+'|'+old.url);}
  return '/account-s/'+id;
 }
 private sweep(){for(const[id,e]of this.entries)if(e.expires<this.now()){this.entries.delete(id);if(this.ids.get(e.owner+'|'+e.url)===id)this.ids.delete(e.owner+'|'+e.url);}}
 lookup(id:string,owner:string){const e=this.entries.get(id);return e&&e.owner===owner&&e.expires>this.now()?e:null;}
 rewrite(text:string,parent:Entry):string{
  const child=(relative:string)=>{const url=this.validRemote(new URL(relative,parent.url).href);return this.register(parent.owner,url,parent.expires,/\.m3u8(?:\?|$)/i.test(url));};
  return text.split(/\r?\n/).map(line=>line.startsWith('#')?line.replace(/URI="([^"]+)"/g,(_m,url)=>`URI="${child(url)}"`):line.trim()?child(line.trim()):line).join('\n');
 }
 async serve(req:http.IncomingMessage,res:http.ServerResponse,id:string,owner:string){
  const e=this.lookup(id,owner);if(!e){res.writeHead(404).end();return;}
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),15000);res.on('close',()=>ctrl.abort());
  try{const headers:Record<string,string>={};if(req.headers.range&&!e.playlist)headers.Range=req.headers.range;
   let target=e.url,r=await this.fetcher(target,{method:req.method,headers,redirect:'manual',signal:ctrl.signal});
   for(let redirects=0;[301,302,303,307,308].includes(r.status)&&redirects<3;redirects++){if(e.local)throw Error('Unexpected local redirect');const location=r.headers.get('location');if(!location)break;await r.body?.cancel();target=this.validRemote(new URL(location,target).href);r=await this.fetcher(target,{method:req.method,headers,redirect:'manual',signal:ctrl.signal});}clearTimeout(timer);
   if(!r.ok){res.writeHead(r.status===403?502:r.status).end();return;}
   const out:Record<string,string>={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
   const playlist=e.playlist||/mpegurl/i.test(r.headers.get('content-type')||'');
   if(playlist&&req.method!=='HEAD'){const limited=setTimeout(()=>ctrl.abort(),10000);try{const chunks:Uint8Array[]=[];let size=0;for await(const chunk of r.body as any){size+=chunk.length;if(size>512*1024)throw Error('Playlist too large');chunks.push(chunk);}const body=this.rewrite(Buffer.concat(chunks).toString('utf8'),{...e,url:target});res.writeHead(200,{...out,'Content-Type':'application/vnd.apple.mpegurl'}).end(body);}finally{clearTimeout(limited);}return;}
   for(const h of ['content-type','content-length','content-range','accept-ranges'])if(r.headers.has(h))out[h]=r.headers.get(h)!;
   res.writeHead(r.status,out);if(req.method==='HEAD'||!r.body){res.end();return;}Readable.fromWeb(r.body as any).on('error',()=>res.destroy()).pipe(res);
  }catch{if(!res.headersSent)res.writeHead(502).end();else res.destroy();}finally{clearTimeout(timer);}
 }
}

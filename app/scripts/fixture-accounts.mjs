// Disposable local server with the desktop 2.0 implementation. Never contacts YouTube.
import {AccountStore} from '../test/fixtures/accounts/store.mjs';import {createAccountServer} from '../test/fixtures/accounts/server.mjs';import {mkdtempSync,rmSync} from 'node:fs';import os from 'node:os';import path from 'node:path';
const dir=mkdtempSync(path.join(os.tmpdir(),'mwave-preview-')),store=new AccountStore(dir);await store.bootstrap('preview','Preview','fixture-pass-8');const server=createAccountServer(store);
server.prependListener('request',(req,res)=>{res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,PATCH,DELETE,OPTIONS');});
// The API requires a JSON body, so preflight is handled before its request listener.
const handlers=server.listeners('request');server.removeAllListeners('request');server.on('request',(req,res)=>{if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type,Authorization','Access-Control-Allow-Methods':'GET,POST,PUT,PATCH,DELETE,OPTIONS'}).end();return;}for(const h of handlers)h(req,res);});
server.listen(18782,'127.0.0.1',()=>console.log('Fixture accounts ready on 127.0.0.1:18782. Login preview / fixture-pass-8'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.close();store.db.close();rmSync(dir,{recursive:true,force:true});process.exit(0);});

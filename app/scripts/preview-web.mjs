// Expo serves HTML before Metro middleware. Add isolation to HTML too for SQLite WASM.
import http from 'node:http';
http.createServer((req,res)=>{const up=http.request({hostname:'127.0.0.1',port:18081,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,{...r.headers,'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'credentialless'});r.pipe(res);});up.on('error',()=>res.writeHead(502).end('Start Expo on port 18081'));req.pipe(up);}).listen(18080,'127.0.0.1',()=>console.log('SQLite web preview http://localhost:18080'));

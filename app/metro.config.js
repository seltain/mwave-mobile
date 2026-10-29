const {getDefaultConfig}=require('expo/metro-config');
const config=getDefaultConfig(__dirname);config.watchFolders=[require('path').resolve(__dirname,'..')];config.resolver.assetExts.push('wasm');
const original=config.server.enhanceMiddleware;config.server.enhanceMiddleware=(middleware,server)=>{const inner=original?original(middleware,server):middleware;return(req,res,next)=>{res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','credentialless');inner(req,res,next);};};
module.exports=config;

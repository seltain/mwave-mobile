import {readFileSync,writeFileSync} from 'node:fs';
// Expo SQLite 16.0.10 writes a uint32 byte length through a Uint8Array.set conversion.
// Rows over 255 bytes get truncated in synchronous web calls. Native SQLite is unaffected.
const file=new URL('../node_modules/expo-sqlite/web/WorkerChannel.ts',import.meta.url),version=JSON.parse(readFileSync(new URL('../node_modules/expo-sqlite/package.json',import.meta.url))).version;
if(version!=='16.0.10')throw Error('Review SQLite web patch for '+version);
const before='resultArray.set(new Uint32Array([length]), 0);',after='new Uint32Array(resultBuffer, 0, 1)[0] = length;';let source=readFileSync(file,'utf8');
if(!source.includes(after)){if(!source.includes(before))throw Error('SQLite web patch target changed');writeFileSync(file,source.replace(before,after));}
console.log('SQLite web uint32 serialization checked');

// Portable SHA256 and UUID. Native entropy is installed from expo-crypto before creating a profile.
import {sha256} from '@noble/hashes/sha256';import {bytesToHex,utf8ToBytes,concatBytes} from '@noble/hashes/utils';
let fill=(bytes:Uint8Array)=>globalThis.crypto.getRandomValues(bytes);
export function configureRandom(source:(bytes:Uint8Array)=>Uint8Array):void{fill=source;}
export const byteLength=(text:string)=>utf8ToBytes(text).length;
export function randomUUID():string{const b=fill(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const s=bytesToHex(b);return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;}
export function createHash(algorithm:string){if(algorithm!=='sha256')throw Error('Unsupported digest');const chunks:Uint8Array[]=[];return {update(value:string|Uint8Array){chunks.push(typeof value==='string'?utf8ToBytes(value):value);return this;},digest(format:string){if(format!=='hex')throw Error('Unsupported encoding');return bytesToHex(sha256(concatBytes(...chunks)));}};}

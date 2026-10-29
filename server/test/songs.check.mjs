// Compatibility entry point: offline fixtures only. Live check: scripts/live-sources-manual.mjs (explicit MWAVE_LIVE=1).
import{spawnSync}from'node:child_process';import{readdirSync}from'node:fs';import{fileURLToPath}from'node:url';import path from'node:path';
const dir=path.dirname(fileURLToPath(import.meta.url));const tests=readdirSync(dir).filter(x=>x.endsWith('.test.ts')).map(x=>path.join(dir,x));
const result=spawnSync(process.execPath,['--import','tsx','--test',...tests],{stdio:'inherit',cwd:path.dirname(dir)});process.exit(result.status??1);

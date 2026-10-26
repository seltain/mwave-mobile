// Сборка сервиса в один файл dist/mwave-server.mjs (его запускает deno на сервере).
import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/mwave-server.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'es2022',
  legalComments: 'none',
  logLevel: 'info',
});

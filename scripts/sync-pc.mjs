// Копирует нужный код из проекта ПК (../music-circle-v2) в mwave-mobile без изменений.
// Проект ПК при этом не трогается. Запуск: node scripts/sync-pc.mjs
//   server/src/pc: поиск, сопоставление, карточка артиста, альбомы, волна, кэш ссылок, прокси звука
//   app/src/pc:    порядок поиска, очередь, подписи по-русски (для приложения, этап 2)
// В начало каждого файла дописывается строка, откуда он взят: менять копии руками не нужно,
// правки делаются в проекте ПК и переносятся этим скриптом заново.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const here = path.resolve(import.meta.dirname, '..');
const pc = path.resolve(here, '..', 'music-circle-v2');
if (!existsSync(path.join(pc, 'src'))) {
  console.error(`Нет проекта ПК: ${pc}`);
  process.exit(1);
}

const SERVER = [
  'main/resolver/types.ts',
  'main/resolver/match.ts',
  'main/resolver/resolver.ts',
  'main/resolver/tools.ts',
  'main/resolver/ytdlpStream.ts',
  'main/resolver/index.ts',
  'main/resolver/providers/innertube.ts',
  'main/resolver/providers/ytmusic.ts',
  'main/resolver/providers/soundcloud.ts',
  'main/artist/artistService.ts',
  'main/artist/logic.ts',
  'main/artist/types.ts',
  'main/artist/ytmArtist.ts',
  'main/radio.ts',
  'main/streamCache.ts',
  'main/streamProxy.ts',
  'shared/artistNames.ts',
];
const APP = [
  'main/resolver/types.ts',
  'main/resolver/match.ts',
  'main/artist/types.ts',
  'main/artist/ytmArtist.ts',
  'main/resolver/providers/innertube.ts',
  'shared/artistNames.ts',
  'shared/searchRank.ts',
  'shared/format.ts',
  'renderer/src/queueLogic.ts',
  'shared/theme.ts',
];

function sync(list, target) {
  rmSync(target, { recursive: true, force: true });
  for (const rel of list) {
    const from = path.join(pc, 'src', rel);
    const to = path.join(target, rel);
    mkdirSync(path.dirname(to), { recursive: true });
    copyFileSync(from, to);
    const text = readFileSync(to, 'utf8');
    writeFileSync(to, `// Копия из проекта ПК: music-circle-v2/src/${rel} (scripts/sync-pc.mjs). Не править здесь.\n${text}`);
  }
  console.log(`${list.length} файлов -> ${path.relative(here, target)}`);
}

sync(SERVER, path.join(here, 'server', 'src', 'pc'));
if (existsSync(path.join(here, 'app'))) sync(APP, path.join(here, 'app', 'src', 'pc'));

// Сервис mwave для телефона. Логика из проекта ПК (src/pc, копия): поиск YouTube Music и SoundCloud,
// сопоставление, карточка артиста и альбомы, подборка волны, ссылки на звук с кэшем и подготовкой заранее.
// Звук YouTube сервис передаёт сам (ссылки YouTube привязаны к IP сервера), с перемоткой (Range).
// Звук SoundCloud (HLS) телефон берёт напрямую: эти ссылки к IP не привязаны (проверено на этапе 0).
// Доступ только с ключом (Authorization: Bearer ...). Слушает 127.0.0.1, наружу через nginx (HTTPS).
import http from 'node:http';
import {accountAuth,AuthUnavailable,type MusicIdentity} from './account-auth.js';
import {AccountAudio} from './account-audio.js';
import {playbackFallback} from './pc/main/playbackFallback.js';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { ArtistService } from './pc/main/artist/artistService.js';
import type { AlbumRef, ArtistRef } from './pc/main/artist/types.js';
import { searchAlbums, searchArtists } from './pc/main/artist/ytmArtist.js';
import { getRadio, pickRadio, skipListOf } from './pc/main/radio.js';
import { match, wantedFromCandidate } from './pc/main/resolver/match.js';
import { Resolver } from './pc/main/resolver/resolver.js';
import { SoundCloudProvider } from './pc/main/resolver/providers/soundcloud.js';
import { YouTubeMusicProvider } from './pc/main/resolver/providers/ytmusic.js';
import type { ToolPaths } from './pc/main/resolver/tools.js';
import type { Candidate, Source, StreamInfo } from './pc/main/resolver/types.js';
import { StreamCache } from './pc/main/streamCache.js';
import { StreamProxy } from './pc/main/streamProxy.js';
import { artistRefsOf } from './pc/shared/artistNames.js';
import { keyOk, RateLimit, Semaphore, signStream, streamOk } from './guard.js';
import { setupLog } from './log.js';

const env = process.env;
const PORT = Number(env.MWAVE_PORT ?? 8780);
const HOST = env.MWAVE_HOST ?? '127.0.0.1';
const VERSION = '2.0.0';
setupLog(env.MWAVE_LOG_DIR);

/** Секретный ключ: файл на сервере (права 600, владелец mwave). Без ключа сервис не запускается. */
const TOKEN = readFileSync(env.MWAVE_TOKEN_FILE ?? '/opt/mwave/secret/token', 'utf8').trim();
if (TOKEN.length < 32) throw new Error('Ключ слишком короткий (нужно не меньше 32 символов)');

const allowLegacy=env.MWAVE_ALLOW_LEGACY_KEY!=='0';
const authenticate=accountAuth({legacyKey:TOKEN,allowLegacy,base:env.MWAVE_ACCOUNTS_URL});
const identities=new WeakMap<http.IncomingMessage,MusicIdentity>();
const accountAudio=new AccountAudio();
const audioRate=new RateLimit(600,60000);
const tools: ToolPaths = {
  ytdlp: env.YTDLP_PATH ?? '/opt/mwave/bin/yt-dlp',
  ffmpeg: 'ffmpeg',
  ffprobe: 'ffprobe',
  // На сервере скрипты YouTube выполняет deno (на ПК это Node.js из Electron)
  jsRuntime: env.YTDLP_JS_RUNTIME ?? 'deno:/opt/mwave/bin/deno',
  env: env.YTDLP_ENV ? JSON.parse(env.YTDLP_ENV) : undefined,
  pluginDir: env.YTDLP_PLUGINS ?? '/opt/mwave/yt-dlp-plugins',
};
const fetchFn = (url: string, init?: RequestInit) => fetch(url, init);

/** yt-dlp одновременно не больше 2 раз: каждый запуск до 70 МБ, запасной путь YouTube до 370 МБ. */
const ytdlpSlots = new Semaphore(Number(env.MWAVE_YTDLP_PARALLEL ?? 2));
const ytProvider = new YouTubeMusicProvider(tools, fetchFn);
const scProviderRaw = new SoundCloudProvider(tools);
// Поиск SoundCloud тоже запускает yt-dlp: через те же места
const scProvider = new Proxy(scProviderRaw, {
  get(target, prop, recv) {
    const v = Reflect.get(target, prop, recv);
    if (prop === 'search' || prop === 'getStream') return (...a: unknown[]) => ytdlpSlots.run(() => (v as (...x: unknown[]) => Promise<unknown>).apply(target, a));
    return typeof v === 'function' ? v.bind(target) : v;
  },
}) as SoundCloudProvider;
const ytStreams = new Proxy(ytProvider, {
  get(target, prop, recv) {
    const v = Reflect.get(target, prop, recv);
    if (prop === 'getStream') return (...a: unknown[]) => ytdlpSlots.run(() => (v as (...x: unknown[]) => Promise<unknown>).apply(target, a));
    return typeof v === 'function' ? v.bind(target) : v;
  },
}) as YouTubeMusicProvider;
const resolver = new Resolver([ytProvider, scProvider], [ytStreams, scProvider]);
const streams = new StreamCache((c) => resolver.getStream(c));
const artists = new ArtistService(fetchFn, scProvider);
const proxy = new StreamProxy(fetchFn);

/** Ссылки на звук для телефона живут 6 часов (ссылка YouTube внутри обновляется сама при 403). */
const STREAM_TTL_MS = 6 * 3600_000;

// ---------- проверка входных данных ----------
const SOURCES = new Set(['ytmusic', 'soundcloud']);
const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.slice(0, max) : '');
/** Песня от телефона: только известные источники и https-ссылки на их страницы. */
function cleanCandidate(c: unknown): Candidate | null {
  const x = c as Partial<Candidate> | null;
  if (!x || !SOURCES.has(String(x.source)) || !/^https:\/\/(music\.youtube\.com|soundcloud\.com|m\.soundcloud\.com)\//.test(String(x.url))) return null;
  return {
    source: x.source as Source,
    id: str(x.id, 200),
    title: str(x.title),
    artist: str(x.artist),
    duration: typeof x.duration === 'number' ? x.duration : null,
    url: str(x.url, 500),
    thumbnail: typeof x.thumbnail === 'string' ? x.thumbnail.slice(0, 500) : undefined,
    artists: Array.isArray(x.artists) ? x.artists.slice(0, 10).map((a) => ({ name: str(a?.name, 200), id: typeof a?.id === 'string' ? a.id.slice(0, 60) : undefined })) : undefined,
  };
}
const cleanRef = (ref: unknown): ArtistRef => {
  const r = ref as Partial<ArtistRef> | null;
  return {
    name: str(r?.name, 200),
    ytId: typeof r?.ytId === 'string' && /^UC[\w-]{10,40}$/.test(r.ytId) ? r.ytId : undefined,
  };
};

// ---------- поиск по источникам (как в ПК: кэш 10 минут, SoundCloud не дольше 20 с) ----------
const SEARCH_CACHE_MS = 10 * 60_000;
const searchCache = new Map<string, { at: number; items: Candidate[] }>();
async function searchSource(query: string, source: Source) {
  const q = query.trim().slice(0, 200);
  if (!q) return { items: [] };
  const key = `${source}|${q.toLowerCase()}`;
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.at < SEARCH_CACHE_MS) return { items: hit.items, cached: true };
  const provider = source === 'ytmusic' ? ytProvider : scProvider;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), source === 'soundcloud' ? 20_000 : 15_000);
  try {
    const items = await provider.search(q, 10, ctrl.signal);
    searchCache.set(key, { at: Date.now(), items });
    if (searchCache.size > 300) searchCache.delete(searchCache.keys().next().value!);
    return { items };
  } catch (e) {
    return { items: [], error: `${source === 'ytmusic' ? 'YouTube Music' : 'SoundCloud'}: ${ctrl.signal.aborted ? 'не ответил вовремя' : (e as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
}
const moreCache = new Map<string, { at: number; value: unknown }>();
async function searchMore(query: string) {
  const q = query.trim().slice(0, 200);
  if (!q) return { artists: [], albums: [] };
  const hit = moreCache.get(q.toLowerCase());
  if (hit && Date.now() - hit.at < SEARCH_CACHE_MS) return hit.value;
  try {
    const [found, albums] = await Promise.all([searchArtists(fetchFn, q), searchAlbums(fetchFn, q)]);
    const value = { artists: found.slice(0, 8), albums: albums.slice(0, 12) };
    moreCache.set(q.toLowerCase(), { at: Date.now(), value });
    if (moreCache.size > 200) moreCache.delete(moreCache.keys().next().value!);
    return value;
  } catch (e) {
    return { artists: [], albums: [], error: `YouTube Music: ${(e as Error).message}` };
  }
}

// ---------- звук ----------
const REASON_TEXT: Record<string, string> = {
  drm: 'защищён (DRM)',
  preview: 'только 30-секундный фрагмент',
  unavailable: 'недоступен в источнике',
  duration_mismatch: 'не совпала длительность',
  error: 'ошибка получения звука',
};

/** Ссылка для телефона: YouTube через этот сервер (подписанная), SoundCloud HLS напрямую. */
function playable(stream: StreamInfo, c: Candidate, base: string, owner?:string): string {
  if(owner&&stream.protocol==='hls')return base+accountAudio.register(owner,stream.url,Math.min(stream.expiresAt||Infinity,Date.now()+20*60000),true);
  if (stream.protocol === 'hls') return stream.url;
  const local = proxy.register(stream, async () => {
    console.log(`[proxy] беру свежую ссылку для "${c.title}"`);
    streams.forget(c);
    const r = await streams.get(c);
    return r.ok ? r.stream : null;
  });
  if(owner)return base+accountAudio.register(owner,local,Date.now()+3600000,false,true);
  const id = local.split('/s/')[1];
  localById.set(id, local);
  if (localById.size > 100) localById.delete(localById.keys().next().value!);
  return base + signStream(TOKEN, id, STREAM_TTL_MS);
}
const localById = new Map<string, string>();

async function prepare(c: Candidate, base: string,owner?:string,fresh=false,failedSource?:Source) {
  if(fresh)streams.forget(c);
  const r=await playbackFallback(c,{direct:x=>streams.get(x),providers:[ytProvider,scProvider],failedSource,timeoutMs:6000});
  if(!r.ok)return {ok:false,reason:'unavailable',message:r.message};
  return{ok:true,url:playable(r.stream,r.playing,base,owner),protocol:r.stream.protocol,duration:r.stream.duration??r.playing.duration,playing:r.playing,expiresAt:Date.now()+15*60000,...(r.fallback?{fallbackReason:'Источник временно недоступен'}:{})};
}

// ---------- волна (как в ПК; историю "звучавших за 3 часа" присылает телефон) ----------
async function youtubeIdFor(seed: Candidate): Promise<string | null> {
  if (seed.source === 'ytmusic') return seed.id;
  const wanted = wantedFromCandidate(seed);
  const found = await ytProvider.search(`${wanted.artist} ${wanted.title}`, 5);
  return match(found, wanted)?.candidate.id ?? null;
}
async function radio(seed: Candidate, exclude: Candidate[], recent: Candidate[]) {
  const skip = skipListOf([...exclude, ...recent]);
  let picked: Candidate[] = [];
  try {
    const vid = await youtubeIdFor(seed);
    if (vid) picked = pickRadio(seed, await getRadio(fetchFn, vid), skip);
    if (picked.length >= 5) return { ok: true, tracks: picked, from: 'radio' };
  } catch (e) {
    console.warn(`[radio] ${(e as Error).message}`);
  }
  try {
    const ref = artistRefsOf(seed)[0];
    const r = ref ? await artists.quick(ref) : null;
    if (r?.status === 'ok') {
      const pool = [...r.card.songs].sort(() => Math.random() - 0.5);
      const tracks = [...picked, ...pickRadio(seed, pool, skipListOf([...picked, ...exclude, ...recent]))].slice(0, 20);
      if (tracks.length) return { ok: true, tracks, from: picked.length ? 'radio' : 'artist' };
    }
  } catch (e) {
    console.warn(`[radio] ${(e as Error).message}`);
  }
  return picked.length ? { ok: true, tracks: picked, from: 'radio' } : { ok: false, message: 'Похожие песни не нашлись' };
}

/** Новинки избранных артистов: телефон сам решает, что новое (как в профиле ПК), сервер даёт релизы. */
async function releases(list: ArtistRef[]) {
  const out: { name: string; ytId?: string; thumbnail?: string; releases: AlbumRef[] }[] = [];
  for (let i = 0; i < list.length; i += 2) {
    const part = await Promise.all(
      list.slice(i, i + 2).map(async (ref) => {
        const r = await artists.quick(ref).catch(() => null);
        return r?.status === 'ok' ? { name: r.card.name, ytId: r.card.ytId, thumbnail: r.card.thumbnail, releases: r.card.albums } : { ...ref, releases: [] };
      }),
    );
    out.push(...part);
  }
  return out;
}

function ytdlpVersion(): string {
  try {
    return execFileSync(tools.ytdlp, ['--version'], { encoding: 'utf8', timeout: 15_000 }).trim();
  } catch {
    return '?';
  }
}

// ---------- HTTP ----------
/** Обычные запросы: 240 в минуту с адреса. Тяжёлые (звук, поиск, карточка, волна): 60 в минуту. */
const general = new RateLimit(240, 60_000);
const heavy = new RateLimit(60, 60_000);
/** Неверный ключ: после 20 попыток за 10 минут адрес получает отказ. */
const badKey = new RateLimit(20, 10 * 60_000);
const started = Date.now();

const json = (res: http.ServerResponse, status: number, body: unknown) => {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(data);
};

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const ch of req) {
    size += (ch as Buffer).length;
    if (size > 512 * 1024) throw new Error('слишком большой запрос');
    chunks.push(ch as Buffer);
  }
  return size ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

/** Адрес клиента: nginx на этом же сервере передаёт настоящий в X-Real-IP. */
const clientIp = (req: http.IncomingMessage) =>
  (req.socket.remoteAddress === '127.0.0.1' && typeof req.headers['x-real-ip'] === 'string' ? req.headers['x-real-ip'] : req.socket.remoteAddress) ?? '?';

/** Адрес этого сервиса снаружи (для ссылок на звук): из заголовков nginx. */
const baseUrl = (req: http.IncomingMessage) => env.MWAVE_PUBLIC_URL ?? `http://${req.headers.host}`;

type Handler = (body: Record<string, unknown>, req: http.IncomingMessage) => Promise<unknown> | unknown;
const HEAVY = true;
const routes: Record<string, [Handler, boolean?]> = {
  '/api/info': [() => ({ version: VERSION, ytdlp: ytdlpVersion(), uptimeSec: Math.round((Date.now() - started) / 1000), cache: streams.stats, ytdlpBusy: ytdlpSlots.busy, ytdlpWaiting: ytdlpSlots.waiting })],
  '/api/search': [(b) => searchSource(str(b.q, 200), b.source === 'soundcloud' ? 'soundcloud' : 'ytmusic'), HEAVY],
  '/api/search/more': [(b) => searchMore(str(b.q, 200)), HEAVY],
  '/api/prepare': [
    (b, req) => {
      const c = cleanCandidate(b.candidate);
      return c ? prepare(c, baseUrl(req),identities.get(req)?.kind==='account'?identities.get(req)!.id:undefined,b.fresh===true,SOURCES.has(String(b.failedSource))?b.failedSource as Source:undefined) : { ok: false, reason: 'error', message: 'неверная песня' };
    },
    HEAVY,
  ],
  '/api/prefetch': [
    (b) => {
      const list = (Array.isArray(b.list) ? b.list : []).slice(0, 6).map(cleanCandidate).filter((c): c is Candidate => !!c);
      streams.prefetch(list);
      return { ok: true, queued: list.length };
    },
  ],
  '/api/artist/quick': [(b) => artists.quick(cleanRef(b.ref)), HEAVY],
  '/api/artist/full': [(b) => artists.full(cleanRef(b.ref)), HEAVY],
  '/api/artist/more-songs': [(b) => artists.moreSongs(cleanRef(b.ref)), HEAVY],
  '/api/artist/all-albums': [(b) => artists.allAlbums(cleanRef(b.ref), b.kind === 'single' ? 'single' : 'album'), HEAVY],
  '/api/album': [(b) => (/^MPRE[\w-]{5,40}$/.test(str(b.id, 60)) ? artists.album(str(b.id, 60)) : { status: 'error', message: 'Неверный альбом' }), HEAVY],
  '/api/radio': [
    (b) => {
      const seed = cleanCandidate(b.seed);
      if (!seed) return { ok: false, message: 'нет песни' };
      const list = (v: unknown, n: number) => (Array.isArray(v) ? v.slice(0, n).map(cleanCandidate).filter((c): c is Candidate => !!c) : []);
      return radio(seed, list(b.exclude, 1000), list(b.recent, 300));
    },
    HEAVY,
  ],
  '/api/releases': [(b) => releases((Array.isArray(b.artists) ? b.artists : []).slice(0, 40).map(cleanRef).filter((r) => r.name)), HEAVY],
};

/** Звук: подписанная ссылка /s/<id> пересылается во внутренний прокси из ПК (повтор при 403, свежая ссылка). */
function streamAudio(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
  const id = url.pathname.slice(3);
  const local = allowLegacy?localById.get(id):undefined;
  if (!/^[0-9a-f]{24}$/.test(id) || !streamOk(TOKEN, id, url.searchParams.get('e'), url.searchParams.get('s')) || !local) {
    res.writeHead(403).end();
    return;
  }
  const up = http.request(local, { method: req.method, headers: req.headers.range ? { range: req.headers.range } : {} }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  up.on('error', () => res.headersSent || res.writeHead(502).end());
  res.on('close', () => up.destroy());
  up.end();
}

const server = http.createServer(async (req, res) => {
  const ip = clientIp(req);
  let url: URL;
  try {
    url = new URL(req.url ?? '/', 'http://x');
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (url.pathname === '/health') return json(res, 200, { ok: true });
  if(url.pathname.startsWith('/s/')&&(req.method==='GET'||req.method==='HEAD')){if(!general.take(ip))return json(res,429,{error:'Слишком много запросов'});return streamAudio(req,res,url);}
  const audio=url.pathname.startsWith('/account-s/')&&(req.method==='GET'||req.method==='HEAD');
  const route=routes[url.pathname];if(!audio&&(!route||req.method!=='POST'))return json(res,404,{error:'Нет такого адреса'});
  let identity:MusicIdentity|null;try{identity=await authenticate(req.headers.authorization);}catch(e){return json(res,503,{error:'Сервис входа временно недоступен'});}
  if(!identity){if(!badKey.take(ip))return json(res,429,{error:'Слишком много попыток'});return json(res,401,{error:'Войдите в аккаунт mwave'});}
  identities.set(req,identity);const who=identity.kind==='account'?'account:'+identity.id:ip;
  if(audio){if(identity.kind!=='account')return json(res,403,{error:'Нужен аккаунт'});if(!audioRate.take(who))return json(res,429,{error:'Слишком много запросов звука'});return accountAudio.serve(req,res,url.pathname.slice(11),identity.id);}
  if(!general.take(who)||route[1]&&!heavy.take(who))return json(res,429,{error:'Слишком много запросов, подожди минуту'});
  try {
    const body = (await readBody(req)) as Record<string, unknown>;
    json(res, 200, await route[0](body, req));
  } catch (e) {
    console.error(`[api] ${url.pathname}: ${(e as Error).message}`);
    json(res, 500, { error: 'Ошибка сервера' });
  }
});

await proxy.start();
server.listen(PORT, HOST, () => console.log(`[mwave] сервис ${VERSION} слушает http://${HOST}:${PORT}, yt-dlp ${ytdlpVersion()}`));
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    console.log(`[mwave] остановка (${sig})`);
    server.close();
    process.exit(0);
  });
}

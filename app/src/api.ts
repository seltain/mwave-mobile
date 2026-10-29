// Клиент сервиса mwave на сервере (mwave-mobile/server).
// Адрес сервера публичный и задан здесь (можно заменить при сборке переменной EXPO_PUBLIC_MWAVE_URL).
// Ключ в приложение НЕ вшит: его вводят один раз при первом запуске, он хранится в Связке ключей iPhone (key.ts).
import type { AlbumPage, AlbumRef, ArtistCard, ArtistOption, ArtistRef } from './pc/main/artist/types';
import type { AlbumHit } from './pc/main/artist/ytmArtist';
import type { Candidate } from './pc/main/resolver/types';
import {fixtureMode,fixturePost} from './fixtures';
import {authorization} from './transport';

export type { AlbumHit, AlbumPage, AlbumRef, ArtistCard, ArtistOption, ArtistRef, Candidate };

export const SERVER_URL = (process.env.EXPO_PUBLIC_MWAVE_URL || 'https://mwave.swiftsuper.online:8781').replace(/\/$/, '');
const BASE = SERVER_URL;
let KEY = '';

/** Ключ, введённый на телефоне (до этого запросы к сервису не идут). */
export function setApiKey(key: string): void {
  KEY = key.trim();
}
export const hasApiKey = () => !!KEY;

export class ApiError extends Error {}

async function post<T>(path: string, body: unknown, timeoutMs = 30_000): Promise<T> {
  if(fixtureMode)return fixturePost(path,body);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const send=async(force=false)=>fetch(BASE + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authorization(force)) },
      body: JSON.stringify(body ?? {}),
      signal: ctrl.signal,
    });
    let r=await send();if(r.status===401)r=await send(true);
    if (r.status === 401) throw new ApiError('Войдите в аккаунт mwave снова');
    if (r.status === 429) throw new ApiError('Слишком много запросов, подожди минуту');
    if (!r.ok) throw new ApiError(`Сервер ответил ${r.status}`);
    return (await r.json()) as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(ctrl.signal.aborted ? 'Сервер не ответил вовремя' : 'Нет связи с сервером. Проверь интернет.');
  } finally {
    clearTimeout(timer);
  }
}

export type SearchResponse = { items: Candidate[]; error?: string };
export type MoreResponse = { artists: ArtistOption[]; albums: AlbumHit[]; error?: string };
export type PrepareResponse =
  | { ok: true; url: string; protocol: 'http' | 'hls'; duration: number | null; playing: Candidate; fallbackReason?: string;expiresAt?:number }
  | { ok: false; reason: string; message: string };
export type ArtistResult =
  | { status: 'ok'; card: ArtistCard }
  | { status: 'choose'; options: ArtistOption[] }
  | { status: 'not_found' }
  | { status: 'error'; message: string };
export type RadioResponse = { ok: true; tracks: Candidate[]; from: string } | { ok: false; message: string };
export type ReleasesItem = { name: string; ytId?: string; thumbnail?: string; releases: AlbumRef[] };

/** Проверить ключ на сервере: true = подходит, false = сервер его не принял. Нет связи: ошибка. */
export async function checkKey(key: string): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const r = await fetch(`${BASE}/api/info`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key.trim()}` }, body: '{}', signal: ctrl.signal });
    if (r.status === 401) return false;
    if (r.status === 429) throw new ApiError('Слишком много неверных попыток, подожди 10 минут');
    if (!r.ok) throw new ApiError(`Сервер ответил ${r.status}`);
    return true;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError('Нет связи с сервером. Проверь интернет.');
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  search: (q: string, source: 'ytmusic' | 'soundcloud') => post<SearchResponse>('/api/search', { q, source }, source === 'soundcloud' ? 30_000 : 20_000),
  searchMore: (q: string) => post<MoreResponse>('/api/search/more', { q }),
  prepare: (candidate: Candidate,options:{fresh?:boolean;failedSource?:string}={}) => post<PrepareResponse>('/api/prepare', { candidate,...options }, 25_000),
  prefetch: (list: Candidate[]) => post<{ ok: boolean }>('/api/prefetch', { list: list.slice(0, 6) }).catch(() => undefined),
  artistQuick: (ref: ArtistRef) => post<ArtistResult>('/api/artist/quick', { ref }),
  artistFull: (ref: ArtistRef) => post<ArtistResult>('/api/artist/full', { ref }, 60_000),
  moreSongs: (ref: ArtistRef) => post<{ status: 'ok'; songs: Candidate[]; hasMore: boolean } | { status: 'error'; message: string }>('/api/artist/more-songs', { ref }),
  allAlbums: (ref: ArtistRef, kind: AlbumRef['kind']) => post<{ status: 'ok'; albums: AlbumRef[] } | { status: 'error'; message: string }>('/api/artist/all-albums', { ref, kind }),
  album: (id: string) => post<{ status: 'ok'; album: AlbumPage } | { status: 'error'; message: string }>('/api/album', { id }),
  radio: (seed: Candidate, exclude: Candidate[], recent: Candidate[]) => post<RadioResponse>('/api/radio', { seed, exclude, recent }, 60_000),
  releases: (artists: ArtistRef[]) => post<ReleasesItem[]>('/api/releases', { artists }, 120_000),
};

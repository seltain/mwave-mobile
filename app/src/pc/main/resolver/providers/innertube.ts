// Копия из проекта ПК: music-circle-v2/src/main/resolver/providers/innertube.ts (scripts/sync-pc.mjs). Не править здесь.
// Общие запросы к публичному веб-API music.youtube.com (тот же, что использует сайт
// и библиотека ytmusicapi). Без входа в аккаунт. Нужен и поиску, и карточке артиста.
import type { FetchFn } from '../types.js';

const BASE = 'https://music.youtube.com/youtubei/v1/';

/** Версия веб-клиента в формате, который ждёт сервер: 1.ГГГГММДД.01.00 */
function clientVersion(): string {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `1.${ymd}.01.00`;
}

/** Запрос к API: endpoint = "search" или "browse". Ответ: разобранный JSON. */
export async function ytmCall(
  fetchFn: FetchFn,
  endpoint: 'search' | 'browse' | 'next',
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await fetchFn(`${BASE}${endpoint}?alt=json&prettyPrint=false`, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      origin: 'https://music.youtube.com',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    },
    body: JSON.stringify({
      // hl: 'en', чтобы названия разделов ("Albums", "Singles") были предсказуемыми
      context: { client: { clientName: 'WEB_REMIX', clientVersion: clientVersion(), hl: 'en' } },
      ...body,
    }),
  });
  if (!res.ok) throw new Error(`YouTube Music: HTTP ${res.status}`);
  return res.json();
}

/** Все объекты с ключом key где угодно в ответе (структура ответа иногда меняется). */
export function findAll<T = Record<string, unknown>>(node: unknown, key: string, out: T[] = []): T[] {
  if (!node || typeof node !== 'object') return out;
  const obj = node as Record<string, unknown>;
  if (key in obj) out.push(obj[key] as T);
  for (const v of Object.values(obj)) findAll(v, key, out);
  return out;
}

/** "3:22" -> 202, "1:02:03" -> 3723 */
export function parseClock(s: string): number | null {
  const t = s.trim();
  if (!/^\d+(:\d{2}){1,2}$/.test(t)) return null;
  return t.split(':').reduce((acc, p) => acc * 60 + Number(p), 0);
}

/** "131M plays" / "133K subscribers" / "1.2B" -> число. null, если числа нет. */
export function parseCount(s: string | undefined | null): number | null {
  const m = /([\d.,]+)\s*([KMB])?/i.exec(String(s ?? ''));
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] ?? '').toUpperCase() as 'K' | 'M' | 'B'] ?? 1;
  return Math.round(n * mult);
}

// ---------- строки списков (песни в поиске, на странице артиста, в альбоме) ----------

export interface Run {
  text: string;
  navigationEndpoint?: {
    browseEndpoint?: {
      browseId?: string;
      browseEndpointContextSupportedConfigs?: { browseEndpointContextMusicConfig?: { pageType?: string } };
    };
    watchEndpoint?: { videoId?: string };
  };
}

export interface ListItemRenderer {
  playlistItemData?: { videoId?: string };
  navigationEndpoint?: { browseEndpoint?: { browseId?: string } };
  flexColumns?: { musicResponsiveListItemFlexColumnRenderer?: { text?: { runs?: Run[] } } }[];
  fixedColumns?: { musicResponsiveListItemFixedColumnRenderer?: { text?: { runs?: Run[] } } }[];
  thumbnail?: { musicThumbnailRenderer?: { thumbnail?: { thumbnails?: { url: string }[] } } };
}

export const pageTypeOf = (r: Run) =>
  r.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;

export const bestThumb = (t?: { thumbnails?: { url: string }[] }) => t?.thumbnails?.at(-1)?.url;

/** Колонки строки списка как массивы "кусочков" текста. */
export function columns(m: ListItemRenderer): { flex: Run[][]; fixed: Run[][] } {
  return {
    flex: m.flexColumns?.map((c) => c.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? []) ?? [],
    fixed: m.fixedColumns?.map((c) => c.musicResponsiveListItemFixedColumnRenderer?.text?.runs ?? []) ?? [],
  };
}

/** Артисты из "кусочков" текста: те, у которых есть ссылка на страницу артиста. */
export function artistsFromRuns(runs: Run[]): { name: string; id?: string }[] {
  return runs
    .filter((r) => pageTypeOf(r) === 'MUSIC_PAGE_TYPE_ARTIST' || pageTypeOf(r) === 'MUSIC_PAGE_TYPE_USER_CHANNEL')
    .map((r) => ({ name: r.text, id: r.navigationEndpoint?.browseEndpoint?.browseId }));
}

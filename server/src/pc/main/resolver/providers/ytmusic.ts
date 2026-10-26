// Копия из проекта ПК: music-circle-v2/src/main/resolver/providers/ytmusic.ts (scripts/sync-pc.mjs). Не править здесь.
// YouTube Music. Поиск идёт через публичный веб-API music.youtube.com
// (тот же, которым пользуется сайт и библиотека ytmusicapi), без входа в аккаунт.
// Поток получаем через yt-dlp. Этап 0 показал, что это работает.
import type { ToolPaths } from '../tools.js';
import { ytdlpGetStream } from '../ytdlpStream.js';
import type { Candidate, FetchFn, SearchProvider, StreamProvider, StreamResult } from '../types.js';
import { artistsFromRuns, bestThumb, columns, findAll, parseClock, ytmCall, type ListItemRenderer } from './innertube.js';

// Параметр фильтра "только песни" (Songs). Взят из ytmusicapi.
const SONGS_FILTER = 'EgWKAQIIAWoMEA4QChADEAQQCRAF';

/**
 * Быстрые настройки yt-dlp для YouTube (замер: 3,7 с вместо 6,1 с, 8 из 8 песен играют):
 * один способ доступа (visionos) вместо нескольких и без списка видеоформатов, нам нужен только звук.
 * Если YouTube это сломает, getStream сразу повторит запрос с обычными настройками.
 */
const FAST_ARGS = ['--extractor-args', 'youtube:player_client=visionos;skip=hls,dash'];

export class YouTubeMusicProvider implements SearchProvider, StreamProvider {
  readonly source = 'ytmusic' as const;

  constructor(
    private tools: ToolPaths,
    private fetchFn: FetchFn = fetch,
  ) {}

  async search(query: string, limit = 10, signal?: AbortSignal): Promise<Candidate[]> {
    const data = await ytmCall(this.fetchFn, 'search', { query, params: SONGS_FILTER }, signal);
    // Берём строки только из первого списка результатов (раздел "Songs")
    const shelf = findAll<{ contents?: { musicResponsiveListItemRenderer?: ListItemRenderer }[] }>(data, 'musicShelfRenderer')[0];
    const items = shelf?.contents ?? [];

    const out: Candidate[] = [];
    for (const it of items) {
      const m = it.musicResponsiveListItemRenderer;
      const videoId = m?.playlistItemData?.videoId;
      if (!m || !videoId) continue;
      const { flex } = columns(m);
      if (!flex[0]?.length) continue;
      const title = flex[0].map((r) => r.text).join('');
      // Вторая колонка: "Артист • Альбом • 3:22"
      const info = flex[1] ?? [];
      let artists = artistsFromRuns(info);
      if (!artists.length && info[0]) artists = [{ name: info[0].text }]; // артист без ссылки
      const duration = info.map((r) => parseClock(r.text)).find((d) => d !== null) ?? null;
      out.push({
        source: 'ytmusic',
        id: videoId,
        title,
        artist: artists.map((a) => a.name).join(', '),
        artists,
        duration,
        url: `https://music.youtube.com/watch?v=${videoId}`,
        thumbnail: bestThumb(m.thumbnail?.musicThumbnailRenderer?.thumbnail),
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  async getStream(candidate: Candidate): Promise<StreamResult> {
    const fast = await ytdlpGetStream(this.tools, candidate.url, FAST_ARGS);
    if (fast.ok || fast.reason === 'drm') return fast;
    console.warn(`[ytmusic] быстрый способ не сработал (${fast.message}), пробую обычный`);
    return ytdlpGetStream(this.tools, candidate.url);
  }
}

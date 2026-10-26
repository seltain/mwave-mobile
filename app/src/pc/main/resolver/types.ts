// Копия из проекта ПК: music-circle-v2/src/main/resolver/types.ts (scripts/sync-pc.mjs). Не править здесь.
// Общие типы резолвера. Резолвер отвечает за слои 2 и 3:
// поиск кандидатов (SearchProvider) и получение звука (StreamProvider).
// Метаданные (слой 1) и проигрывание (слой 4) сюда не входят.

/** Откуда взят кандидат. Spotify и Яндекс как источники звука не используются. */
export type Source = 'soundcloud' | 'ytmusic';

/** Трек, который хочет пользователь (из каталога, плейлиста или строки поиска). */
export interface WantedTrack {
  artist: string;
  title: string;
  /** Эталонная длительность в секундах, если известна. */
  duration?: number | null;
}

/** Один найденный вариант трека в каком-то источнике. */
export interface Candidate {
  source: Source;
  /** id внутри источника (у SoundCloud число, у YouTube videoId). */
  id: string;
  title: string;
  /** Артист. У SoundCloud это загрузивший пользователь, настоящий артист часто в названии. */
  artist: string;
  /** Длительность в секундах или null, если источник её не дал. */
  duration: number | null;
  /** Страница трека: по ней yt-dlp получает поток. */
  url: string;
  thumbnail?: string;
  /** Артисты со ссылками на их страницы в YouTube Music (если источник их дал). */
  artists?: { name: string; id?: string }[];
  /** Число прослушиваний, если источник его дал (для сортировки популярного). */
  plays?: number;
}

/** Готовый к проигрыванию поток. */
export interface StreamInfo {
  url: string;
  /** http = обычный файл (можно Range), hls = плейлист .m3u8 из кусочков. */
  protocol: 'http' | 'hls';
  /** Заголовки, с которыми yt-dlp советует открывать ссылку. */
  headers: Record<string, string>;
  /** Формат, например webm/opus или m4a/aac. */
  ext: string;
  codec: string;
  /** Длительность по данным потока, секунды. */
  duration: number | null;
  /** Когда ссылка протухнет (мс от 1970), если источник это сообщает. */
  expiresAt: number | null;
}

/** Почему поток не получен. */
export type UnavailableReason = 'drm' | 'preview' | 'unavailable' | 'duration_mismatch' | 'error';

export type StreamResult =
  | { ok: true; stream: StreamInfo }
  | { ok: false; reason: UnavailableReason; message: string };

/** Слой 2: поиск кандидатов. */
export interface SearchProvider {
  readonly source: Source;
  /** signal: отмена, если результат уже не нужен (человек ищет другое). */
  search(query: string, limit?: number, signal?: AbortSignal): Promise<Candidate[]>;
}

/** Слой 3: прямой поток для кандидата. */
export interface StreamProvider {
  readonly source: Source;
  getStream(candidate: Candidate): Promise<StreamResult>;
}

/** Функция для HTTP-запросов. Снаружи можно подставить net.fetch из Electron (он учитывает системный прокси). */
export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

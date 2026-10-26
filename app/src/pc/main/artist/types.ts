// Копия из проекта ПК: music-circle-v2/src/main/artist/types.ts (scripts/sync-pc.mjs). Не править здесь.
// Типы карточки артиста. Общие для главного процесса и окна.
import type { Candidate, Source } from '../resolver/types.js';

/** Чем открыть карточку: имя и, если известен, id страницы артиста в YouTube Music. */
export interface ArtistRef {
  name: string;
  ytId?: string;
}

/** Вариант для вопроса "Это тот артист?". */
export interface ArtistOption {
  ytId: string;
  name: string;
  thumbnail?: string;
  /** Текст вида "133K subscribers" (как его дал YouTube Music). */
  audience: string;
  audienceCount: number;
}

export interface AlbumRef {
  id: string;
  title: string;
  year?: string;
  thumbnail?: string;
  kind: 'album' | 'single';
}

export interface ArtistCard {
  name: string;
  ytId?: string;
  thumbnail?: string;
  audience?: string;
  /** Популярные песни одним общим списком (YouTube Music + SoundCloud, без дублей). */
  songs: Candidate[];
  /** Есть ли ещё популярные песни для кнопки "Показать ещё". */
  hasMoreSongs: boolean;
  /** Альбомы и синглы, видные на странице артиста (по 10). */
  albums: AlbumRef[];
  /** Есть ли полный список (больше, чем видно): для кнопок "Все альбомы" / "Все синглы". */
  albumsMore: Partial<Record<AlbumRef['kind'], boolean>>;
  /** Откуда реально пришли песни. */
  sources: Source[];
  /** Аккаунт артиста на SoundCloud, если найден. */
  soundcloudAccount?: string;
  /** Поиск на SoundCloud: ещё идёт / готов / не удался / не нужен. */
  scState: 'pending' | 'done' | 'failed';
}

export type ArtistResult =
  | { status: 'ok'; card: ArtistCard }
  | { status: 'choose'; options: ArtistOption[] }
  | { status: 'not_found' }
  | { status: 'error'; message: string };

export interface AlbumPage {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  year?: string;
  thumbnail?: string;
  tracks: Candidate[];
}

export type AlbumResult = { status: 'ok'; album: AlbumPage } | { status: 'error'; message: string };

export type MoreSongsResult = { status: 'ok'; songs: Candidate[]; hasMore: boolean } | { status: 'error'; message: string };

export type AllAlbumsResult = { status: 'ok'; albums: AlbumRef[] } | { status: 'error'; message: string };
